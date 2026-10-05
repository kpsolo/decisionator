import {
  type Comment,
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
import type {
  AppendResult,
  Entry,
  ExportBundle,
  Identity,
  MetaPatch,
  NewProject,
  OptionOp,
  ParticipantRole,
  ProjectRef,
  ProjectSnapshot,
  ProjectStore,
  ProjectSummary,
  ShareRequest,
  ShareState,
  Unsubscribe,
} from "@decisionator/plugin-sdk";
import type { GoogleAuthService } from "./auth.js";
import { GoogleApiClient } from "./google-api.js";
import { WriteQueue } from "./queue.js";

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
    const sheetTitles = ["meta", "options", "grades", "comments", "rankings", "outcomes"];
    const spreadsheet = await this.client.createSpreadsheet(input.title, sheetTitles);
    const spreadsheetId = spreadsheet.spreadsheetId;

    // Tag file in Drive
    await this.client.updateFile(spreadsheetId, {
      appProperties: {
        decisionator: "project",
        formatVersion: "1",
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
      ["formatVersion", "1"],
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
    ]);

    return { store: "google-sheets", id: spreadsheetId };
  }

  async openProject(ref: ProjectRef, opts?: { password?: string }): Promise<ProjectSnapshot> {
    const identity = await this.auth.getIdentity();
    const file = await this.client.getFile(ref.id);
    if (file.trashed) {
      throw new Error("Project is unavailable (trashed)");
    }

    const perms = await this.client.listPermissions(ref.id);
    const isOwner = perms.permissions.some(
      (p) => p.role === "owner" && p.emailAddress === identity.participantId
    );
    const isWriter = perms.permissions.some(
      (p) =>
        p.role === "writer" && (p.emailAddress === identity.participantId || p.type === "anyone")
    );
    const role: ParticipantRole = isOwner ? "owner" : isWriter ? "contribute" : "view";

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

    const isProtected = metaMap.get("protected") === "true";
    let cryptoKey: CryptoKey | undefined;

    if (isProtected) {
      if (!opts?.password) {
        throw new Error("Password required to decrypt project");
      }
      const saltStr = metaMap.get("salt") || "";
      const verifierStr = metaMap.get("verifier") || "";
      const iterations = Number.parseInt(metaMap.get("kdfIterations") || "600000", 10);
      const salt = base64ToBytes(saltStr);

      cryptoKey = await deriveKey(opts.password, salt, iterations);
      const valid = await checkVerifier(verifierStr, cryptoKey);
      if (!valid) {
        throw new Error("Incorrect password");
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

    const project: Project = {
      title,
      description,
      protected: isProtected,
      voting: votingParsed,
      formatVersion: 1,
    };

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
        };
        gradesMap.set(`${by}:${optionId}`, grade);
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
        rankingsMap.set(`${by}:${round}`, {
          id: id || "ranking",
          at: at || "",
          by: by || "",
          round,
          ranking: parsed.ranking,
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

    return {
      project,
      options,
      grades: Array.from(gradesMap.values()),
      comments,
      rankings: Array.from(rankingsMap.values()),
      outcomes,
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

  async append(ref: ProjectRef, entries: Entry[]): Promise<AppendResult> {
    const identity = await this.auth.getIdentity();
    try {
      const snap = await this.openProject(ref);
      if (snap.role === "view") {
        throw new Error("PERMISSION_DENIED: View role cannot append entries");
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("PERMISSION_DENIED")) {
        throw err;
      }
      // If network/429 fails openProject, we still enqueue writes for later sync
    }

    const now = new Date().toISOString();

    for (const entry of entries) {
      const entryId = `entry_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      let tab = "";
      let row: string[] = [];

      if (entry.kind === "grade") {
        tab = "grades";
        row = [
          entryId,
          now,
          identity.participantId,
          entry.optionId,
          JSON.stringify({ value: entry.value }),
        ];
      } else if (entry.kind === "comment") {
        tab = "comments";
        row = [
          entryId,
          now,
          identity.participantId,
          entry.optionId,
          JSON.stringify({ body: entry.body, hidden: entry.hidden, replaces: entry.replaces }),
        ];
      } else if (entry.kind === "ranking") {
        tab = "rankings";
        row = [
          entryId,
          now,
          identity.participantId,
          JSON.stringify({ ranking: entry.ranking, round: entry.round ?? 1 }),
        ];
      } else if (entry.kind === "outcome") {
        tab = "outcomes";
        row = [entryId, now, identity.participantId, JSON.stringify(entry.outcome)];
      }

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
      rows.push([
        opt.id,
        String(opt.order ?? 0),
        opt.status,
        opt.at || "",
        identity.participantId,
        JSON.stringify(opt),
      ]);
    }

    await this.client.batchUpdateValues(ref.id, [{ range: "options!A:F", values: rows }]);
  }

  async updateMeta(ref: ProjectRef, patch: MetaPatch): Promise<void> {
    const snap = await this.openProject(ref);
    if (snap.role !== "owner") {
      throw new Error("PERMISSION_DENIED: Only owner may update meta");
    }

    const updates: { range: string; values: string[][] }[] = [];
    if (patch.title) {
      updates.push({ range: "meta!B8", values: [[patch.title]] });
    }
    if (patch.voting) {
      updates.push({ range: "meta!B6", values: [[JSON.stringify(patch.voting)]] });
    }
    if (updates.length > 0) {
      await this.client.batchUpdateValues(ref.id, updates);
    }
  }

  async share(ref: ProjectRef, req: ShareRequest): Promise<ShareState> {
    const snap = await this.openProject(ref);
    if (snap.role !== "owner") {
      throw new Error("PERMISSION_DENIED: Only owner may configure sharing");
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
        if (linkPerm && linkPerm.id) {
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
  }

  async forgetProject(_ref: ProjectRef): Promise<void> {
    // Participant side: drops local cache
  }
}
