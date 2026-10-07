import {
  type Option,
  type Project,
  ProjectSchema,
  type VotingState,
  VotingStateSchema,
  checkVerifier,
  decrypt,
  deriveKey,
  effectiveEntries,
  encrypt,
  generateSalt,
  makeVerifier,
  monotonicNow,
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
  applyStrategyPatch,
  checkPropertyEntries,
  checkResetEntries,
  resetRecord,
  resolveDelegatedAuthor,
} from "@decisionator/plugin-sdk";
import type { GoogleAuthService } from "./auth.js";
import { BadRequestError, GoogleApiClient } from "./google-api.js";
import { TAB_HEADERS } from "./layout.js";
import { WriteQueue } from "./queue.js";
import {
  type RowDecodeResult,
  decodeCommentRow,
  decodeContributionRow,
  decodeGradeRow,
  decodeOptionRow,
  decodeOutcomeRow,
  decodePropertyRow,
  decodeRankingRow,
  decodeResetRow,
} from "./rows.js";

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

const DEFAULT_VOTING: VotingState = { state: "open", round: 1, topN: 3, liveResults: true };

/** Meta key/value rows, plus the 1-based sheet row of each key so it can be written in place. */
function readMetaRows(rows: string[][]): {
  values: Map<string, string>;
  rowOf: Map<string, number>;
  rowCount: number;
} {
  const values = new Map<string, string>();
  const rowOf = new Map<string, number>();
  rows.forEach((row, i) => {
    if (i === 0 || !row[0]) return;
    rowOf.set(row[0], i + 1);
    if (row[1]) values.set(row[0], row[1]);
  });
  return { values, rowOf, rowCount: rows.length };
}

function parseVoting(raw: string | undefined): { state: VotingState; warning?: string } {
  if (!raw) return { state: DEFAULT_VOTING };
  try {
    const parsed = VotingStateSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { state: parsed.data };
    return {
      state: DEFAULT_VOTING,
      warning: `invalid voting value (${parsed.error.issues.map((i) => i.message).join(", ")})`,
    };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    return { state: DEFAULT_VOTING, warning: `invalid voting JSON (${reason})` };
  }
}

type StrategyMeta = Pick<Project, "strategy" | "strategyChanges">;

/**
 * Reads the `strategy` and `strategyChanges` meta values (JSON, encrypted in password mode like
 * the title). An invalid value is skipped with a warning.
 */
async function readStrategyMeta(
  meta: { values: Map<string, string>; rowOf: Map<string, number> },
  key: CryptoKey | undefined,
  warnings: string[]
): Promise<StrategyMeta> {
  const out: StrategyMeta = {};
  for (const name of ["strategy", "strategyChanges"] as const) {
    const raw = meta.values.get(name);
    if (!raw) continue;
    try {
      const json = key ? await decrypt(raw, key) : raw;
      const parsed = ProjectSchema.shape[name].safeParse(JSON.parse(json));
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((i) => i.message).join(", "));
      }
      if (name === "strategy") out.strategy = parsed.data as StrategyMeta["strategy"];
      else out.strategyChanges = parsed.data as StrategyMeta["strategyChanges"];
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      warnings.push(`meta row ${meta.rowOf.get(name)}: invalid ${name} value (${reason})`);
    }
  }
  return out;
}

/** Tabs whose payload column is encrypted in password mode: [tab, columns, payload column]. */
const PAYLOAD_TABS: [string, string, number][] = [
  ["options", "A:F", 5],
  ["grades", "A:E", 4],
  ["comments", "A:E", 4],
  ["rankings", "A:D", 3],
  ["outcomes", "A:D", 3],
  ["contributions", "A:F", 5],
  ["properties", "A:E", 4],
  ["resets", "A:D", 3],
];

/** Tabs added after format v1 was released; a project may lack them until it is migrated. */
const LATER_TABS = ["contributions", "properties", "resets"];

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
  /** Last known voting round per spreadsheet, used when meta cannot be read during `append`. */
  private rounds = new Map<string, number>();
  /** Option ids seen at the last open, so `append` can check property entries without a read. */
  private optionIds = new Map<string, Set<string>>();

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
      "properties",
      "resets",
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
    const voting = input.voting ?? DEFAULT_VOTING;
    const metaRows: string[][] = [
      ["key", "value"],
      ["formatVersion", "2"],
      ["createdAt", new Date().toISOString()],
      ["owner", identity.participantId],
      ["protected", opts?.password ? "true" : "false"],
      ["voting", JSON.stringify(voting)],
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
      { range: "properties!A:E", values: [[...TAB_HEADERS.properties]] },
      { range: "resets!A:D", values: [[...TAB_HEADERS.resets]] },
    ]);

    this.protection.set(spreadsheetId, Boolean(opts?.password));
    this.roles.set(spreadsheetId, "owner");
    this.rounds.set(spreadsheetId, voting.round);
    this.optionIds.set(spreadsheetId, new Set((input.options ?? []).map((o) => o.id)));
    return { store: "google-sheets", id: spreadsheetId };
  }

  async openProject(ref: ProjectRef, opts?: { password?: string }): Promise<ProjectSnapshot> {
    const identity = await this.auth.getIdentity();
    const file = await this.client.getFile(ref.id);
    if (file.trashed) {
      throw new Error("Project is unavailable (trashed)");
    }

    const role = await this.resolveRole(ref.id, identity.participantId);

    const ranges = ["meta!A:B", ...PAYLOAD_TABS.map(([tab, columns]) => `${tab}!${columns}`)];
    let data: Awaited<ReturnType<GoogleApiClient["batchGetValues"]>>;
    let missingTabs: string[] = [];
    try {
      data = await this.client.batchGetValues(ref.id, ranges);
    } catch (err) {
      // An older project lacks the tabs added since (a format v1 project has no contributions
      // tab, a project from before sheet layout 2.3.0 no properties or resets tab), and a read
      // naming a missing tab fails as a whole.
      if (!(err instanceof BadRequestError)) throw err;
      const titles = await this.client.getSheetTitles(ref.id);
      missingTabs = LATER_TABS.filter((tab) => !titles.includes(tab));
      if (missingTabs.length === 0) throw err;
      data = await this.client.batchGetValues(
        ref.id,
        ranges.filter((r) => !missingTabs.some((tab) => r.startsWith(`${tab}!`)))
      );
    }

    const warnings: string[] = [];
    const tabRows = (tab: string) =>
      data.valueRanges.find((r) => r.range.startsWith(tab))?.values ?? [];
    const meta = readMetaRows(tabRows("meta"));
    const metaMap = meta.values;

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

    const voting = parseVoting(metaMap.get("voting"));
    if (voting.warning) {
      warnings.push(`meta row ${meta.rowOf.get("voting")}: ${voting.warning}`);
    }
    this.rounds.set(ref.id, voting.state.round);

    const formatVersion = (metaMap.get("formatVersion") === "2" ? 2 : 1) as 1 | 2;

    const project: Project = {
      title,
      description,
      protected: isProtected,
      voting: voting.state,
      ...(await readStrategyMeta(meta, cryptoKey, warnings)),
      formatVersion,
    };

    // Migrations. Viewers cannot migrate and see no contributions or properties until the
    // owner or a contributor opens the project.
    if (role === "owner" || role === "contribute") {
      const addTabs: string[] = [];
      const updates: { range: string; values: string[][] }[] = [];
      // Format v1 to v2.
      if (formatVersion === 1) {
        // Address the formatVersion row itself: a write to `meta!A:B` starts at the header.
        const versionRow = meta.rowOf.get("formatVersion") ?? meta.rowCount + 1;
        updates.push({
          range: `meta!A${versionRow}:B${versionRow}`,
          values: [["formatVersion", "2"]],
        });
        if (tabRows("contributions").length === 0) {
          updates.push({ range: "contributions!A1:F1", values: [[...TAB_HEADERS.contributions]] });
        }
        if (missingTabs.includes("contributions")) addTabs.push("contributions");
      }
      // Sheet layout 2.3.0 adds the properties and resets tabs (additive: formatVersion
      // stays 2).
      if (missingTabs.includes("properties")) {
        addTabs.push("properties");
        updates.push({ range: "properties!A1:E1", values: [[...TAB_HEADERS.properties]] });
      }
      if (missingTabs.includes("resets")) {
        addTabs.push("resets");
        updates.push({ range: "resets!A1:D1", values: [[...TAB_HEADERS.resets]] });
      }
      if (updates.length > 0) {
        try {
          if (addTabs.length > 0) await this.client.addSheets(ref.id, addTabs);
          await this.client.batchUpdateValues(ref.id, updates);
          if (formatVersion === 1) project.formatVersion = 2;
        } catch {
          // If update fails (e.g. a revoked write permission or network), keep going
        }
      }
    }

    // Every row is validated on its own: a row that fails (e.g. after a direct edit in Google
    // Sheets) is skipped and reported instead of making the whole project unavailable.
    const key = cryptoKey;
    const hook = key ? (payload: string) => decrypt(payload, key) : undefined;
    const decodeTab = async <T>(
      tab: string,
      decode: (row: string[], rowIndex: number) => Promise<RowDecodeResult<T>>
    ): Promise<T[]> => {
      const entities: T[] = [];
      for (const [i, row] of tabRows(tab).slice(1).entries()) {
        if (row.every((cell) => !cell)) continue;
        // Sheet row numbers are 1-based and row 1 is the header.
        const res = await decode(row, i + 2);
        if (res.entity) entities.push(res.entity);
        else if (res.warning) warnings.push(res.warning);
      }
      return entities;
    };

    const options = await decodeTab("options", (row, n) => decodeOptionRow(row, n, hook));
    this.optionIds.set(ref.id, new Set(options.map((o) => o.id)));

    const grades = await decodeTab("grades", (row, n) => decodeGradeRow(row, n, undefined, hook));

    const comments = await decodeTab("comments", (row, n) =>
      decodeCommentRow(row, n, undefined, hook)
    );

    const rankings = await decodeTab("rankings", (row, n) =>
      decodeRankingRow(row, n, undefined, hook)
    );

    const outcomes = await decodeTab("outcomes", (row, n) => decodeOutcomeRow(row, n, hook));
    const contributions = await decodeTab("contributions", (row, n) =>
      decodeContributionRow(row, n, hook)
    );
    const properties = await decodeTab("properties", (row, n) => decodePropertyRow(row, n, hook));
    const resets = await decodeTab("resets", (row, n) => decodeResetRow(row, n, hook));
    // Latest-wins and resets. Rows of every tab are in append order, so a later row wins on an
    // equal timestamp.
    const effective = effectiveEntries({ grades, rankings, properties, resets });

    return {
      project,
      options,
      grades: effective.grades,
      comments,
      rankings: effective.rankings,
      outcomes,
      contributions,
      properties: effective.properties,
      history: effective.history,
      role,
      ...(warnings.length > 0 ? { warnings } : {}),
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
    if (entries.some((e) => e.kind === "property")) {
      checkPropertyEntries(entries, {
        optionIds: await this.knownOptionIds(ref.id, entries),
        isOwner: role === "owner",
      });
    }
    checkResetEntries(entries, { isOwner: role === "owner" && !delegated, self: by });

    // A ranking without a round counts for the round the project is voting in now.
    const needsRound = entries.some((e) => e.kind === "ranking" && e.round === undefined);
    const currentRound = needsRound ? await this.currentRound(ref.id) : 1;

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

    const rows: { tab: string; row: string[] }[] = [];

    for (const entry of entries) {
      // Strictly increasing stamps keep "appended after a reset" decidable by time.
      const now = monotonicNow();
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
            await seal({ ranking: entry.ranking, round: entry.round ?? currentRound, byName }),
          ],
        });
      } else if (entry.kind === "outcome") {
        rows.push({ tab: "outcomes", row: [entryId, now, by, await seal(entry.outcome)] });
      } else if (entry.kind === "property") {
        rows.push({
          tab: "properties",
          row: [
            entryId,
            now,
            by,
            entry.optionId,
            await seal({
              plugin: entry.plugin,
              key: entry.key,
              scope: entry.scope,
              value: entry.value,
              byName,
            }),
          ],
        });
      } else if (entry.kind === "reset") {
        const {
          id: _id,
          at: _at,
          by: _by,
          ...payload
        } = resetRecord(entry, {
          id: entryId,
          at: now,
          by,
        });
        rows.push({ tab: "resets", row: [entryId, now, by, await seal({ ...payload, byName })] });
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
    if (
      patch.title === undefined &&
      patch.description === undefined &&
      !patch.voting &&
      !patch.strategy
    ) {
      return;
    }

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
    const voting = patch.voting ? { ...snap.project.voting, ...patch.voting } : undefined;
    if (voting) {
      set("voting", JSON.stringify(voting));
    }
    if (patch.strategy) {
      const identity = await this.auth.getIdentity();
      const next = applyStrategyPatch(
        { strategy: snap.project.strategy, strategyChanges: snap.project.strategyChanges },
        patch.strategy,
        identity.participantId,
        monotonicNow()
      );
      const sealJson = (value: unknown) => {
        const json = JSON.stringify(value);
        return key ? encrypt(json, key) : json;
      };
      set("strategy", await sealJson(next.strategy));
      set("strategyChanges", await sealJson(next.strategyChanges));
    }

    await this.client.batchUpdateValues(ref.id, [{ range: "meta!A:B", values: rows }]);
    if (voting) this.rounds.set(ref.id, voting.round);
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
    this.optionIds.delete(ref.id);
  }

  /**
   * Upgrades an existing plaintext project to password protection (T067, FR-017).
   */
  async enablePassword(ref: ProjectRef, password: string): Promise<void> {
    const snap = await this.openProject(ref);
    if (snap.role !== "owner") {
      throw new Error("PERMISSION_DENIED: Only owner may enable password protection");
    }
    if (snap.project.protected) {
      throw new Error("Project is already password protected");
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
      ...PAYLOAD_TABS.map(([tab, columns]) => `${tab}!${columns}`),
    ]);
    const tabRows = (tab: string) =>
      data.valueRanges.find((r) => r.range.startsWith(tab))?.values ?? [];

    // 3. Set the protection keys in place: rows keep their positions, so no stale row is left
    // behind and keys this code does not know about survive.
    const metaRows = tabRows("meta").map((r) => [...r]);
    if (metaRows.length === 0) metaRows.push(["key", "value"]);
    const setMeta = (name: string, value: string) => {
      const row = metaRows.find((r, i) => i > 0 && r[0] === name);
      if (row) {
        row[1] = value;
      } else {
        metaRows.push([name, value]);
      }
    };
    setMeta("protected", "true");
    setMeta("kdf", "pbkdf2-sha256");
    setMeta("kdfIterations", "600000");
    setMeta("salt", saltBase64);
    setMeta("verifier", verifier);
    setMeta("title", await encrypt(snap.project.title, cryptoKey));
    if (snap.project.description) {
      setMeta("description", await encrypt(snap.project.description, cryptoKey));
    }
    if (snap.project.strategy) {
      setMeta("strategy", await encrypt(JSON.stringify(snap.project.strategy), cryptoKey));
    }
    if (snap.project.strategyChanges) {
      setMeta(
        "strategyChanges",
        await encrypt(JSON.stringify(snap.project.strategyChanges), cryptoKey)
      );
    }

    // 4. Encrypt the payload column of every row of every content tab, in place.
    const updates = [{ range: "meta!A:B", values: metaRows }];
    for (const [tab, columns, payloadColumn] of PAYLOAD_TABS) {
      const rows: string[][] = [];
      for (const row of tabRows(tab)) {
        const copy = [...row];
        const payload = copy[payloadColumn];
        // Row 1 is the header; rows without a payload have nothing to protect.
        if (rows.length > 0 && payload) {
          copy[payloadColumn] = await encrypt(payload, cryptoKey);
        }
        rows.push(copy);
      }
      if (rows.length > 0) updates.push({ range: `${tab}!${columns}`, values: rows });
    }
    await this.client.batchUpdateValues(ref.id, updates);
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

  /**
   * Option ids for checking property entries: those seen at the last open, re-read from the
   * options tab's id column only when an entry names an option not seen yet.
   */
  private async knownOptionIds(spreadsheetId: string, entries: Entry[]): Promise<Set<string>> {
    const known = this.optionIds.get(spreadsheetId);
    const wanted = entries.flatMap((e) => (e.kind === "property" ? [e.optionId] : []));
    if (known && wanted.every((id) => known.has(id))) return known;
    const data = await this.client.batchGetValues(spreadsheetId, ["options!A:A"]);
    const ids = new Set(
      (data.valueRanges[0]?.values ?? []).slice(1).flatMap((r) => (r[0] ? [r[0]] : []))
    );
    this.optionIds.set(spreadsheetId, ids);
    return ids;
  }

  private async isProtected(spreadsheetId: string): Promise<boolean> {
    const known = this.protection.get(spreadsheetId);
    if (known !== undefined) return known;
    return (await this.readMeta(spreadsheetId)).get("protected") === "true";
  }

  /**
   * The voting round from a fresh meta read, so rounds the owner started on another device count.
   * When meta cannot be read (rate limited, offline) the round seen last in this session is used.
   */
  private async currentRound(spreadsheetId: string): Promise<number> {
    try {
      return parseVoting((await this.readMeta(spreadsheetId)).get("voting")).state.round;
    } catch (err) {
      const known = this.rounds.get(spreadsheetId);
      if (known === undefined) throw err;
      return known;
    }
  }

  private async readMeta(spreadsheetId: string): Promise<Map<string, string>> {
    const data = await this.client.batchGetValues(spreadsheetId, ["meta!A:B"]);
    const meta = readMetaRows(data.valueRanges[0]?.values ?? []).values;
    this.protection.set(spreadsheetId, meta.get("protected") === "true");
    this.rounds.set(spreadsheetId, parseVoting(meta.get("voting")).state.round);
    return meta;
  }
}
