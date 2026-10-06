import {
  type Comment,
  type Contribution,
  type Grade,
  type Option,
  type OutcomeRecord,
  type Project,
  type Ranking,
  checkVerifier,
  decrypt,
  deriveKey,
  encrypt,
  generateSalt,
  makeVerifier,
} from "@decisionator/core";
import {
  type AppendOptions,
  type AppendResult,
  type Entry,
  type ExportBundle,
  type Identity,
  type MetaPatch,
  type NewProject,
  type OptionOp,
  type ParticipantRole,
  type ProjectRef,
  type ProjectSnapshot,
  type ProjectStore,
  type ProjectSummary,
  type ShareRequest,
  type ShareState,
  type Unsubscribe,
  resolveDelegatedAuthor,
} from "@decisionator/plugin-sdk";
import type { GoogleAuthService } from "./auth.js";
import { GoogleApiClient } from "./google-api.js";
import { WriteQueue } from "./queue.js";
import { byNameField } from "./rows.js";

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    const b = bytes[i];
    if (b !== undefined) binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(base64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class GoogleSheetsProjectStore implements ProjectStore {
  readonly id = "org.decisionator.store.google-sheets";
  private client: GoogleApiClient;
  private queue: WriteQueue;
  /** Keys of protected projects unlocked in this session, by spreadsheet id. Memory only. */
  private keys = new Map<string, CryptoKey>();
  /** Last known protection flag per spreadsheet, so `append` knows whether to encrypt. */
  private protection = new Map<string, boolean>();
  /** Last known role per spreadsheet, used when the permission lookup is rate limited. */
  private roles = new Map<string, ParticipantRole>();

  constructor(
    private auth: GoogleAuthService,
    client?: GoogleApiClient,
    queue?: WriteQueue
  ) {
    this.client = client || new GoogleApiClient(() => this.auth.getValidToken());
    this.queue = queue || new WriteQueue();
  }

  async signIn(opts?: { interactive: boolean }): Promise<Identity> {
    if (opts?.interactive) {
      await this.auth.requestToken(true);
    }
    return this.auth.getIdentity();
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const res = await this.client.listFiles(
      "appProperties has { key='decisionator' and value='project' } and trashed = false"
    );
    return res.files.map((f) => ({
      ref: { store: "google-sheets", id: f.id },
      title: f.name,
      owner: "",
      updatedAt: undefined,
    }));
  }

  async createProject(input: NewProject, opts?: { password?: string }): Promise<ProjectRef> {
    const identity = await this.auth.getIdentity();
    const sheetTitles = [
      "meta",
      "options",
      "grades",
      "comments",
      "rankings",
      "outcomes",
      "contributions",
    ];
    const spreadsheet = await this.client.createSpreadsheet(input.title, sheetTitles);
    const spreadsheetId = spreadsheet.spreadsheetId;

    // Tag file in Drive
    await this.client.updateFile(spreadsheetId, {
      appProperties: {
        decisionator: "project",
        formatVersion: "2",
      },
    });

    let cryptoKey: CryptoKey | undefined;
    let saltBase64 = "";
    let verifier = "";

    if (opts?.password) {
      const salt = generateSalt();
      saltBase64 = bytesToBase64(salt);
      cryptoKey = await deriveKey(opts.password, salt, 600_000);
      verifier = await makeVerifier(cryptoKey);
    }

    // Write meta rows
    const metaRows: string[][] = [
      ["key", "value"],
      ["formatVersion", "2"],
      ["createdAt", new Date().toISOString()],
      ["owner", identity.participantId],
      ["protected", opts?.password ? "true" : "false"],
      [
        "voting",
        JSON.stringify(input.voting ?? { state: "open", round: 1, topN: 3, liveResults: true }),
      ],
    ];

    if (opts?.password && cryptoKey) {
      metaRows.push(["kdf", "pbkdf2-sha256"]);
      metaRows.push(["kdfIterations", "600000"]);
      metaRows.push(["salt", saltBase64]);
      metaRows.push(["verifier", verifier]);
      metaRows.push(["title", await encrypt(input.title, cryptoKey)]);
      if (input.description) {
        metaRows.push(["description", await encrypt(input.description, cryptoKey)]);
      }
    } else {
      metaRows.push(["title", input.title]);
      if (input.description) {
        metaRows.push(["description", input.description]);
      }
    }

    const optionsRows: string[][] = [["id", "order", "status", "at", "by", "payload"]];
    if (input.options) {
      for (const opt of input.options) {
        let payloadStr = JSON.stringify(opt);
        if (cryptoKey) {
          payloadStr = await encrypt(payloadStr, cryptoKey);
        }
        optionsRows.push([
          opt.id,
          String(opt.order ?? 0),
          opt.status,
          opt.at || new Date().toISOString(),
          identity.participantId,
          payloadStr,
        ]);
      }
    }

    await this.client.batchUpdateValues(spreadsheetId, [
      { range: "meta!A:B", values: metaRows },
      { range: "options!A:F", values: optionsRows },
      { range: "grades!A:E", values: [["id", "at", "by", "optionId", "payload"]] },
      { range: "comments!A:E", values: [["id", "at", "by", "optionId", "payload"]] },
      { range: "rankings!A:D", values: [["id", "at", "by", "payload"]] },
      { range: "outcomes!A:D", values: [["id", "at", "by", "payload"]] },
      {
        range: "contributions!A:F",
        values: [["id", "at", "by", "targetKind", "targetId", "payload"]],
      },
    ]);

    this.protection.set(spreadsheetId, Boolean(opts?.password));
    this.roles.set(spreadsheetId, "owner");
    return { store: "google-sheets", id: spreadsheetId };
  }

  async openProject(ref: ProjectRef, opts?: { password?: string }): Promise<ProjectSnapshot> {
    const identity = await this.auth.getIdentity();
    const file = await this.client.getFile(ref.id);
    if (file.trashed) {
      throw new Error("Project is unavailable (trashed)");
    }

    const role = await this.resolveRole(ref.id, identity.participantId);

    const data = await this.client.batchGetValues(ref.id, [
      "meta!A:B",
      "options!A:F",
      "grades!A:E",
      "comments!A:E",
      "rankings!A:D",
      "outcomes!A:D",
      "contributions!A:F",
    ]);

    const metaMap = new Map<string, string>();
    const metaRange = data.valueRanges.find((r) => r.range.startsWith("meta"));
    if (metaRange?.values) {
      for (const row of metaRange.values.slice(1)) {
        if (row[0] && row[1]) metaMap.set(row[0], row[1]);
      }
    }

    const isProtected = metaMap.get("protected") === "true";
    this.protection.set(ref.id, isProtected);
    let cryptoKey: CryptoKey | undefined;

    if (isProtected) {
      const verifierStr = metaMap.get("verifier") || "";
      if (opts?.password) {
        const saltStr = metaMap.get("salt") || "";
        const iterations = Number.parseInt(metaMap.get("kdfIterations") || "600000", 10);
        const salt = base64ToBytes(saltStr);

        cryptoKey = await deriveKey(opts.password, salt, iterations);
        const valid = await checkVerifier(verifierStr, cryptoKey);
        if (!valid) {
          throw new Error("Incorrect password");
        }
        this.keys.set(ref.id, cryptoKey);
      } else {
        // A project unlocked earlier in this session opens with the remembered key.
        const cached = this.keys.get(ref.id);
        if (!cached || !(await checkVerifier(verifierStr, cached))) {
          this.keys.delete(ref.id);
          throw new Error("Password required to decrypt project");
        }
        cryptoKey = cached;
      }
    }

    let title = metaMap.get("title") || file.name;
    let description = metaMap.get("description") || "";
    if (isProtected && cryptoKey) {
      title = await decrypt(title, cryptoKey);
      if (description) {
        description = await decrypt(description, cryptoKey);
      }
    }

    const rawVoting = metaMap.get("voting");
    const votingParsed = rawVoting
      ? JSON.parse(rawVoting)
      : { state: "open", round: 1, topN: 3, liveResults: true };

    const formatVersion = (metaMap.get("formatVersion") === "2" ? 2 : 1) as 1 | 2;

    const project: Project = {
      title,
      description,
      protected: isProtected,
      voting: votingParsed,
      formatVersion,
    };

    // Format v1 to v2 migration
    if (formatVersion === 1 && (role === "owner" || role === "contribute")) {
      const contribsRange = data.valueRanges.find((r) => r.range.startsWith("contributions"));
      if (!contribsRange?.values) {
        try {
          await this.client.batchUpdateValues(ref.id, [
            {
              range: "contributions!A:F",
              values: [["id", "at", "by", "targetKind", "targetId", "payload"]],
            },
            {
              range: "meta!A:B",
              values: [["formatVersion", "2"]],
            },
          ]);
          project.formatVersion = 2;
        } catch {
          // If update fails (e.g. view role or network), keep going
        }
      }
    }

    // Parse options
    const options: Option[] = [];
    const optionsRange = data.valueRanges.find((r) => r.range.startsWith("options"));
    if (optionsRange?.values) {
      for (const row of optionsRange.values.slice(1)) {
        const payloadStr = row[5];
        if (!payloadStr) continue;
        const decryptedPayload =
          isProtected && cryptoKey ? await decrypt(payloadStr, cryptoKey) : payloadStr;
        const opt = JSON.parse(decryptedPayload) as Option;
        options.push(opt);
      }
    }

    // Parse grades (latest wins per by, optionId)
    const gradesMap = new Map<string, Grade>();
    const gradesRange = data.valueRanges.find((r) => r.range.startsWith("grades"));
    if (gradesRange?.values) {
      for (const row of gradesRange.values.slice(1)) {
        const [id, at, by, optionId, payloadStr] = row;
        if (!payloadStr) continue;
        const decPayload =
          isProtected && cryptoKey ? await decrypt(payloadStr, cryptoKey) : payloadStr;
        const parsed = JSON.parse(decPayload);
        const grade: Grade = {
          id: id || "grade",
          at: at || "",
          by: by || "",
          optionId: optionId || "",
          value: parsed.value,
          ...byNameField(parsed),
        };
        gradesMap.set(JSON.stringify([by, optionId]), grade);
      }
    }

    // Parse comments
    const comments: Comment[] = [];
    const commentsRange = data.valueRanges.find((r) => r.range.startsWith("comments"));
    if (commentsRange?.values) {
      for (const row of commentsRange.values.slice(1)) {
        const [id, at, by, optionId, payloadStr] = row;
        if (!payloadStr) continue;
        const decPayload =
          isProtected && cryptoKey ? await decrypt(payloadStr, cryptoKey) : payloadStr;
        const parsed = JSON.parse(decPayload);
        comments.push({
          id: id || "comment",
          at: at || "",
          by: by || "",
          optionId: optionId || "",
          body: parsed.body,
          replaces: parsed.replaces,
          hidden: parsed.hidden,
          ...byNameField(parsed),
        });
      }
    }

    // Parse rankings (latest wins per by, round)
    const rankingsMap = new Map<string, Ranking>();
    const rankingsRange = data.valueRanges.find((r) => r.range.startsWith("rankings"));
    if (rankingsRange?.values) {
      for (const row of rankingsRange.values.slice(1)) {
        const [id, at, by, payloadStr] = row;
        if (!payloadStr) continue;
        const decPayload =
          isProtected && cryptoKey ? await decrypt(payloadStr, cryptoKey) : payloadStr;
        const parsed = JSON.parse(decPayload);
        const round = parsed.round || 1;
        rankingsMap.set(JSON.stringify([by, round]), {
          id: id || "ranking",
          at: at || "",
          by: by || "",
          round,
          ranking: parsed.ranking,
          ...byNameField(parsed),
        });
      }
    }

    // Parse outcomes
    const outcomes: OutcomeRecord[] = [];
    const outcomesRange = data.valueRanges.find((r) => r.range.startsWith("outcomes"));
    if (outcomesRange?.values) {
      for (const row of outcomesRange.values.slice(1)) {
        const [, , , payloadStr] = row;
        if (!payloadStr) continue;
        const decPayload =
          isProtected && cryptoKey ? await decrypt(payloadStr, cryptoKey) : payloadStr;
        outcomes.push(JSON.parse(decPayload) as OutcomeRecord);
      }
    }

    // Parse contributions
    const contributions: Contribution[] = [];
    const contribsRange = data.valueRanges.find((r) => r.range.startsWith("contributions"));
    if (contribsRange?.values) {
      for (const row of contribsRange.values.slice(1)) {
        const [id, at, by, targetKind, targetId, payloadStr] = row;
        if (!payloadStr) continue;
        const decPayload =
          isProtected && cryptoKey ? await decrypt(payloadStr, cryptoKey) : payloadStr;
        const parsed = JSON.parse(decPayload);
        contributions.push({
          id: id || "contrib",
          at: at || "",
          by: by || "",
          targetKind: (targetKind as "project" | "option" | "idea") || "project",
          targetId: targetId || "",
          type: parsed.type,
          body: parsed.body,
          pros: parsed.pros,
          cons: parsed.cons,
          sources: parsed.sources,
          author: parsed.author || { kind: "human" },
          reviewStatus: parsed.reviewStatus || "pending",
        });
      }
    }

    return {
      project,
      options,
      grades: Array.from(gradesMap.values()),
      comments,
      rankings: Array.from(rankingsMap.values()),
      outcomes,
      contributions,
      role,
    };
  }

  watch(ref: ProjectRef, onChange: (s: ProjectSnapshot) => void): Unsubscribe {
    let active = true;
    const interval = setInterval(async () => {
      if (!active) return;
      try {
        const snap = await this.openProject(ref);
        onChange(snap);
      } catch {
        // Ignored in background poll
      }
    }, 10_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }

  async append(ref: ProjectRef, entries: Entry[], opts?: AppendOptions): Promise<AppendResult> {
    const identity = await this.auth.getIdentity();

    let role: ParticipantRole | undefined;
    try {
      role = await this.resolveRole(ref.id, identity.participantId);
    } catch (err) {
      // Rate limited or offline: fall back to the role seen earlier in this session and still
      // enqueue the writes for later sync. Delegation is never granted on an unverified role.
      role = this.roles.get(ref.id);
      if (role === undefined && opts?.onBehalfOf !== undefined) throw err;
    }
    if (role === "view") {
      throw new Error("PERMISSION_DENIED: View role cannot append entries");
    }
    // Validates the whole call before anything is written.
    const delegated = resolveDelegatedAuthor(entries, opts, role === "owner");
    const by = delegated?.by ?? identity.participantId;
    const byName = delegated?.byName;

    // Protected projects keep every payload encrypted; never write plaintext into them.
    const isProtected = await this.isProtected(ref.id);
    const key = isProtected ? this.keys.get(ref.id) : undefined;
    if (isProtected && !key) {
      throw new Error("Password required to append to a protected project");
    }
    const seal = async (payload: unknown): Promise<string> => {
      const json = JSON.stringify(payload);
      return key ? encrypt(json, key) : json;
    };

    const now = new Date().toISOString();
    const rows: { tab: string; row: string[] }[] = [];

    for (const entry of entries) {
      const entryId = `entry_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      if (entry.kind === "grade") {
        rows.push({
          tab: "grades",
          row: [entryId, now, by, entry.optionId, await seal({ value: entry.value, byName })],
        });
      } else if (entry.kind === "comment") {
        rows.push({
          tab: "comments",
          row: [
            entryId,
            now,
            by,
            entry.optionId,
            await seal({
              body: entry.body,
              hidden: entry.hidden,
              replaces: entry.replaces,
              byName,
            }),
          ],
        });
      } else if (entry.kind === "ranking") {
        rows.push({
          tab: "rankings",
          row: [
            entryId,
            now,
            by,
            await seal({ ranking: entry.ranking, round: entry.round ?? 1, byName }),
          ],
        });
      } else if (entry.kind === "outcome") {
        rows.push({ tab: "outcomes", row: [entryId, now, by, await seal(entry.outcome)] });
      } else if (entry.kind === "contribution") {
        const c = entry.contribution;
        rows.push({
          tab: "contributions",
          row: [
            c.id || entryId,
            c.at || now,
            c.by || identity.participantId,
            c.targetKind,
            c.targetId,
            await seal({
              type: c.type,
              body: c.body,
              pros: c.pros,
              cons: c.cons,
              sources: c.sources,
              author: c.author,
              reviewStatus: c.reviewStatus,
            }),
          ],
        });
      }
    }

    for (const { tab, row } of rows) {
      await this.queue.enqueue(ref.id, tab, row);
    }

    try {
      return await this.queue.flush(this.client);
    } catch {
      const remaining = await this.queue.getQueuedCount(ref.id);
      return { queued: remaining, sent: 0 };
    }
  }

  async updateOptions(ref: ProjectRef, ops: OptionOp[]): Promise<void> {
    const snap = await this.openProject(ref);
    if (snap.role !== "owner") {
      throw new Error("PERMISSION_DENIED: Only owner may update options");
    }
    // openProject succeeded, so a protected project has its key in this session.
    const key = snap.project.protected ? this.keys.get(ref.id) : undefined;
    if (snap.project.protected && !key) {
      throw new Error("Password required to decrypt project");
    }

    let updatedOptions = [...snap.options];
    for (const op of ops) {
      if (op.op === "add") {
        updatedOptions.push(op.option);
      } else if (op.op === "update") {
        updatedOptions = updatedOptions.map((o) =>
          o.id === op.option.id ? ({ ...o, ...op.option } as Option) : o
        );
      } else if (op.op === "remove") {
        updatedOptions = updatedOptions.map((o) =>
          o.id === op.id ? { ...o, status: "removed" as const } : o
        );
      }
    }

    const rows: string[][] = [["id", "order", "status", "at", "by", "payload"]];
    const identity = await this.auth.getIdentity();
    for (const opt of updatedOptions) {
      const json = JSON.stringify(opt);
      rows.push([
        opt.id,
        String(opt.order ?? 0),
        opt.status,
        opt.at || "",
        identity.participantId,
        key ? await encrypt(json, key) : json,
      ]);
    }

    await this.client.batchUpdateValues(ref.id, [{ range: "options!A:F", values: rows }]);
  }

  async updateMeta(ref: ProjectRef, patch: MetaPatch): Promise<void> {
    const snap = await this.openProject(ref);
    if (snap.role !== "owner") {
      throw new Error("PERMISSION_DENIED: Only owner may update meta");
    }
    const key = snap.project.protected ? this.keys.get(ref.id) : undefined;
    if (snap.project.protected && !key) {
      throw new Error("Password required to decrypt project");
    }
    if (patch.title === undefined && patch.description === undefined && !patch.voting) return;

    // Rows are addressed by key: their position differs between plain and protected projects.
    const data = await this.client.batchGetValues(ref.id, ["meta!A:B"]);
    const rows = (data.valueRanges[0]?.values ?? [["key", "value"]]).map((r) => [...r]);
    const set = (name: string, value: string) => {
      const row = rows.find((r, i) => i > 0 && r[0] === name);
      if (row) {
        row[1] = value;
      } else {
        rows.push([name, value]);
      }
    };

    if (patch.title !== undefined) {
      set("title", key ? await encrypt(patch.title, key) : patch.title);
    }
    if (patch.description !== undefined) {
      set("description", key ? await encrypt(patch.description, key) : patch.description);
    }
    if (patch.voting) {
      set("voting", JSON.stringify({ ...snap.project.voting, ...patch.voting }));
    }

    await this.client.batchUpdateValues(ref.id, [{ range: "meta!A:B", values: rows }]);
  }

  async share(ref: ProjectRef, req: ShareRequest): Promise<ShareState> {
    const snap = await this.openProject(ref);
    if (snap.role !== "owner") {
      throw new Error("PERMISSION_DENIED: Only owner may configure sharing");
    }

    // Drive cannot exclude one person from an "anyone with the link" permission (research R21),
    // so individual removal needs the link to end up off. Checked before anything is written.
    const removeUsers = req.removeUsers ?? [];
    if (removeUsers.length > 0) {
      const linkOn =
        req.linkSharing?.enabled ??
        (await this.client.listPermissions(ref.id)).permissions.some((p) => p.type === "anyone");
      if (linkOn) {
        throw new Error(
          "NOT_SUPPORTED: Anyone with the link keeps access. Turn off link sharing to remove individual collaborators."
        );
      }
    }

    if (req.linkSharing) {
      if (req.linkSharing.enabled) {
        await this.client.createPermission(ref.id, {
          type: "anyone",
          role: req.linkSharing.role === "contribute" ? "writer" : "reader",
          allowFileDiscovery: false,
        });
      } else {
        const perms = await this.client.listPermissions(ref.id);
        const linkPerm = perms.permissions.find((p) => p.type === "anyone");
        if (linkPerm?.id) {
          await this.client.deletePermission(ref.id, linkPerm.id);
        }
      }
    }

    if (req.inviteUsers) {
      for (const inv of req.inviteUsers) {
        await this.client.createPermission(ref.id, {
          type: "user",
          emailAddress: inv.email,
          role: inv.role === "contribute" ? "writer" : "reader",
        });
      }
    }

    if (removeUsers.length > 0) {
      // Listed after the invites above so a permission they replaced is not targeted by a stale id.
      const perms = await this.client.listPermissions(ref.id);
      for (const email of removeUsers) {
        const target = perms.permissions.find(
          (p) => p.type === "user" && p.role !== "owner" && p.emailAddress === email
        );
        if (target?.id) await this.client.deletePermission(ref.id, target.id);
      }
    }

    return this.getShareState(ref);
  }

  async getShareState(ref: ProjectRef): Promise<ShareState> {
    const perms = await this.client.listPermissions(ref.id);
    const linkPerm = perms.permissions.find((p) => p.type === "anyone");
    const userPerms = perms.permissions.filter((p) => p.type === "user");

    return {
      linkSharing: {
        enabled: !!linkPerm,
        role: linkPerm?.role === "writer" ? "contribute" : "view",
        url: `https://kpsolo.github.io/decisionator/#/p/${ref.id}`,
      },
      collaborators: userPerms.map((p) => ({
        email: p.emailAddress || "",
        role: p.role === "owner" ? "owner" : p.role === "writer" ? "contribute" : "view",
      })),
    };
  }

  async export(ref: ProjectRef): Promise<ExportBundle> {
    const snap = await this.openProject(ref);
    return {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      snapshot: snap,
    };
  }

  async deleteProject(ref: ProjectRef): Promise<void> {
    const snap = await this.openProject(ref);
    if (snap.role !== "owner") {
      throw new Error("PERMISSION_DENIED: Only owner may delete project");
    }
    await this.client.updateFile(ref.id, { trashed: true });
    this.keys.delete(ref.id);
  }

  async forgetProject(ref: ProjectRef): Promise<void> {
    // Participant side: drops local cache
    this.keys.delete(ref.id);
    this.protection.delete(ref.id);
    this.roles.delete(ref.id);
  }

  /**
   * Upgrades an existing plaintext project to password protection (T067, FR-017).
   */
  async enablePassword(ref: ProjectRef, password: string): Promise<void> {
    const snap = await this.openProject(ref);
    if (snap.role !== "owner") {
      throw new Error("PERMISSION_DENIED: Only owner may enable password protection");
    }
    if (password.length < 12) {
      throw new Error("Password must be at least 12 characters long");
    }

    const salt = generateSalt();
    const saltBase64 = bytesToBase64(salt);
    const cryptoKey = await deriveKey(password, salt, 600_000);
    const verifier = await makeVerifier(cryptoKey);

    // 1. Rename Sheet to "Deci project (protected)"
    await this.client.updateFile(ref.id, {
      name: "Deci project (protected)",
    });

    // 2. Read all existing data to encrypt
    const data = await this.client.batchGetValues(ref.id, [
      "meta!A:B",
      "options!A:F",
      "grades!A:E",
      "comments!A:E",
      "rankings!A:D",
      "outcomes!A:D",
    ]);

    const metaMap = new Map<string, string>();
    const metaRange = data.valueRanges.find((r) => r.range.startsWith("meta"));
    if (metaRange?.values) {
      for (const row of metaRange.values.slice(1)) {
        if (row[0] && row[1]) metaMap.set(row[0], row[1]);
      }
    }

    const title = metaMap.get("title") || snap.project.title;
    const desc = metaMap.get("description") || snap.project.description || "";

    const encryptedTitle = await encrypt(title, cryptoKey);
    const encryptedDesc = desc ? await encrypt(desc, cryptoKey) : "";

    const updatedMetaRows: string[][] = [
      ["key", "value"],
      ["formatVersion", metaMap.get("formatVersion") || "1"],
      ["createdAt", metaMap.get("createdAt") || new Date().toISOString()],
      ["owner", metaMap.get("owner") || ""],
      ["protected", "true"],
      ["voting", metaMap.get("voting") || JSON.stringify(snap.project.voting)],
      ["kdf", "pbkdf2-sha256"],
      ["kdfIterations", "600000"],
      ["salt", saltBase64],
      ["verifier", verifier],
      ["title", encryptedTitle],
    ];
    if (encryptedDesc) {
      updatedMetaRows.push(["description", encryptedDesc]);
    }

    // Encrypt options payloads
    const optionsRows: string[][] = [["id", "order", "status", "at", "by", "payload"]];
    const optionsRange = data.valueRanges.find((r) => r.range.startsWith("options"));
    if (optionsRange?.values) {
      for (const row of optionsRange.values.slice(1)) {
        const [id, order, status, at, by, payloadStr] = row;
        if (!payloadStr) continue;
        const encPayload = await encrypt(payloadStr, cryptoKey);
        optionsRows.push([
          id || "",
          order || "0",
          status || "active",
          at || "",
          by || "",
          encPayload,
        ]);
      }
    }

    // Encrypt grades payloads
    const gradesRows: string[][] = [["id", "at", "by", "optionId", "payload"]];
    const gradesRange = data.valueRanges.find((r) => r.range.startsWith("grades"));
    if (gradesRange?.values) {
      for (const row of gradesRange.values.slice(1)) {
        const [id, at, by, optionId, payloadStr] = row;
        if (!payloadStr) continue;
        const encPayload = await encrypt(payloadStr, cryptoKey);
        gradesRows.push([id || "", at || "", by || "", optionId || "", encPayload]);
      }
    }

    // Encrypt comments payloads
    const commentsRows: string[][] = [["id", "at", "by", "optionId", "payload"]];
    const commentsRange = data.valueRanges.find((r) => r.range.startsWith("comments"));
    if (commentsRange?.values) {
      for (const row of commentsRange.values.slice(1)) {
        const [id, at, by, optionId, payloadStr] = row;
        if (!payloadStr) continue;
        const encPayload = await encrypt(payloadStr, cryptoKey);
        commentsRows.push([id || "", at || "", by || "", optionId || "", encPayload]);
      }
    }

    // Encrypt rankings payloads
    const rankingsRows: string[][] = [["id", "at", "by", "payload"]];
    const rankingsRange = data.valueRanges.find((r) => r.range.startsWith("rankings"));
    if (rankingsRange?.values) {
      for (const row of rankingsRange.values.slice(1)) {
        const [id, at, by, payloadStr] = row;
        if (!payloadStr) continue;
        const encPayload = await encrypt(payloadStr, cryptoKey);
        rankingsRows.push([id || "", at || "", by || "", encPayload]);
      }
    }

    // Encrypt outcomes payloads
    const outcomesRows: string[][] = [["id", "at", "by", "payload"]];
    const outcomesRange = data.valueRanges.find((r) => r.range.startsWith("outcomes"));
    if (outcomesRange?.values) {
      for (const row of outcomesRange.values.slice(1)) {
        const [id, at, by, payloadStr] = row;
        if (!payloadStr) continue;
        const encPayload = await encrypt(payloadStr, cryptoKey);
        outcomesRows.push([id || "", at || "", by || "", encPayload]);
      }
    }

    await this.client.batchUpdateValues(ref.id, [
      { range: "meta!A:B", values: updatedMetaRows },
      { range: "options!A:F", values: optionsRows },
      { range: "grades!A:E", values: gradesRows },
      { range: "comments!A:E", values: commentsRows },
      { range: "rankings!A:D", values: rankingsRows },
      { range: "outcomes!A:D", values: outcomesRows },
    ]);
    // The owner just chose the password, so later writes in this session encrypt with it.
    this.protection.set(ref.id, true);
    this.keys.set(ref.id, cryptoKey);
  }

  /** Role of `participantId` from the Drive permissions; remembered for rate-limited appends. */
  private async resolveRole(
    spreadsheetId: string,
    participantId: string
  ): Promise<ParticipantRole> {
    const perms = await this.client.listPermissions(spreadsheetId);
    const isOwner = perms.permissions.some(
      (p) => p.role === "owner" && p.emailAddress === participantId
    );
    const isWriter = perms.permissions.some(
      (p) => p.role === "writer" && (p.emailAddress === participantId || p.type === "anyone")
    );
    const role: ParticipantRole = isOwner ? "owner" : isWriter ? "contribute" : "view";
    this.roles.set(spreadsheetId, role);
    return role;
  }

  private async isProtected(spreadsheetId: string): Promise<boolean> {
    const known = this.protection.get(spreadsheetId);
    if (known !== undefined) return known;
    const data = await this.client.batchGetValues(spreadsheetId, ["meta!A:B"]);
    const row = data.valueRanges[0]?.values?.find((r) => r[0] === "protected");
    const isProtected = row?.[1] === "true";
    this.protection.set(spreadsheetId, isProtected);
    return isProtected;
  }
}
