import {
  KDF_DEFAULT_ITERATIONS,
  type Option,
  type Project,
  ProjectSchema,
  type SealContext,
  type VotingState,
  VotingStateSchema,
  assertPasswordStrength,
  checkKdfIterations,
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
import { PROTECTED_FILE_NAME, TAB_HEADERS } from "./layout.js";
import { type FlushResult, WriteQueue } from "./queue.js";
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
import { projectLinkUrl } from "./share.js";
import { watchProjectChanges } from "./watch.js";

function downgradeError(): Error {
  return new Error(
    "PROTECTION_DOWNGRADE: this project is password protected, but its sheet now says it is not (the meta tab was edited). Nothing is written unencrypted; reopen the project after checking the sheet."
  );
}

function tamperedKdfError(): Error {
  return new Error(
    "PROTECTION_TAMPERED: the project's salt, verifier or KDF iteration count changed during this session (the meta tab was edited). The project is not opened with the changed values."
  );
}

/** Seal context (codec v2 additional data) of a meta value. */
function metaContext(name: string): SealContext {
  return ["meta", name];
}

/**
 * Seal context of a row's payload: the tab plus every column before the payload, so a payload
 * moved to another row, or a row whose id, author, time or option was edited, no longer decrypts.
 */
function rowContext(tab: string, columns: readonly (string | undefined)[]): SealContext {
  return ["row", tab, ...columns.map((c) => c ?? "")];
}

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
      const json = key ? await decrypt(raw, key, metaContext(name)) : raw;
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

/** Payload column of each tab. */
const PAYLOAD_COLUMN = new Map(PAYLOAD_TABS.map(([tab, , column]) => [tab, column]));

/** Tabs added after format v1 was released; a project may lack them until it is migrated. */
const LATER_TABS = ["contributions", "properties", "resets"];

/** Key derivation parameters of a protected project as first seen (and trusted) this session. */
interface KdfParams {
  salt: string;
  verifier: string;
  iterations: string;
}

export class GoogleSheetsProjectStore implements ProjectStore {
  readonly id = "org.decisionator.store.google-sheets";
  private client: GoogleApiClient;
  private queue: WriteQueue;
  /** Keys of protected projects unlocked in this session, by spreadsheet id. Memory only. */
  private keys = new Map<string, CryptoKey>();
  /**
   * Last known protection flag per spreadsheet, so `append` knows whether to encrypt. Once a
   * project is seen protected it stays protected for the session: the flag lives in the meta tab,
   * which every writer can edit, so a later "false" is a downgrade attempt (see `noteProtection`).
   */
  private protection = new Map<string, boolean>();
  /** Salt, verifier and iteration count per protected spreadsheet, pinned at first unlock. */
  private kdfParams = new Map<string, KdfParams>();
  /** Last known role per spreadsheet and when it was looked up, used when the lookup fails. */
  private roles = new Map<string, { role: ParticipantRole; at: number }>();
  /** Last known voting round per spreadsheet, used when meta cannot be read during `append`. */
  private rounds = new Map<string, number>();
  /** Option ids seen at the last open, so `append` can check property entries without a read. */
  private optionIds = new Map<string, Set<string>>();
  /**
   * Sheet row (1-based) of each option decoded at the last open, and the options tab's row count,
   * so `updateOptions` writes rows in place and never touches rows it could not decode.
   */
  private optionRows = new Map<string, { rowOf: Map<string, number>; rowCount: number }>();

  constructor(
    private auth: GoogleAuthService,
    client?: GoogleApiClient,
    queue?: WriteQueue
  ) {
    this.client =
      client ||
      new GoogleApiClient(
        () => this.auth.getValidToken(),
        (rejected) => this.auth.refreshToken(rejected)
      );
    this.queue = queue || new WriteQueue();
  }

  /** The write queue, e.g. for a sync banner (`budget`, `getQueuedCount`, `getFailed`). */
  get writeQueue(): WriteQueue {
    return this.queue;
  }

  /**
   * Sends queued rows now, without a new append. Call it when the browser comes back online or
   * the tab becomes visible (`startAutoFlush` does both). Rows Google refuses for good are parked
   * and listed in `failed`.
   */
  flushPending(): Promise<FlushResult> {
    return this.queue.flush(this.client);
  }

  /**
   * Flushes the write queue now and whenever the browser goes back online or the tab becomes
   * visible again. Returns a function that removes the listeners. No-op outside a browser.
   */
  startAutoFlush(): Unsubscribe {
    const flush = () => {
      this.flushPending().catch(() => undefined);
    };
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "hidden") flush();
    };
    const win = typeof window !== "undefined" ? window : undefined;
    const doc = typeof document !== "undefined" ? document : undefined;
    win?.addEventListener?.("online", flush);
    doc?.addEventListener?.("visibilitychange", onVisible);
    flush();
    return () => {
      win?.removeEventListener?.("online", flush);
      doc?.removeEventListener?.("visibilitychange", onVisible);
    };
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
    const password = opts?.password;
    // Checked before anything is created in Drive.
    if (password !== undefined) assertPasswordStrength(password);
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
    // A protected project's Drive file name must not reveal its title (same name as
    // `enablePassword` uses).
    const fileName = password !== undefined ? PROTECTED_FILE_NAME : input.title;
    const spreadsheet = await this.client.createSpreadsheet(fileName, sheetTitles);
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

    if (password !== undefined) {
      const salt = generateSalt();
      saltBase64 = bytesToBase64(salt);
      cryptoKey = await deriveKey(password, salt, KDF_DEFAULT_ITERATIONS);
      verifier = await makeVerifier(cryptoKey);
    }

    // Write meta rows
    const voting = input.voting ?? DEFAULT_VOTING;
    const metaRows: string[][] = [
      ["key", "value"],
      ["formatVersion", "2"],
      ["createdAt", new Date().toISOString()],
      ["owner", identity.participantId],
      ["protected", cryptoKey ? "true" : "false"],
      ["voting", JSON.stringify(voting)],
    ];

    if (cryptoKey) {
      metaRows.push(["kdf", "pbkdf2-sha256"]);
      metaRows.push(["kdfIterations", String(KDF_DEFAULT_ITERATIONS)]);
      metaRows.push(["salt", saltBase64]);
      metaRows.push(["verifier", verifier]);
      metaRows.push(["title", await encrypt(input.title, cryptoKey, metaContext("title"))]);
      if (input.description) {
        metaRows.push([
          "description",
          await encrypt(input.description, cryptoKey, metaContext("description")),
        ]);
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
        // The `by` column names the option's author, like the payload does (F3: they must agree).
        const columns = [
          opt.id,
          String(opt.order ?? 0),
          opt.status,
          opt.at || new Date().toISOString(),
          opt.by || identity.participantId,
        ];
        let payloadStr = JSON.stringify(opt);
        if (cryptoKey) {
          payloadStr = await encrypt(payloadStr, cryptoKey, rowContext("options", columns));
        }
        optionsRows.push([...columns, payloadStr]);
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

    this.protection.set(spreadsheetId, cryptoKey !== undefined);
    if (cryptoKey) {
      this.kdfParams.set(spreadsheetId, {
        salt: saltBase64,
        verifier,
        iterations: String(KDF_DEFAULT_ITERATIONS),
      });
    }
    this.roles.set(spreadsheetId, { role: "owner", at: Date.now() });
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
    // A protected project never turns plain mid-session (throws PROTECTION_DOWNGRADE).
    this.noteProtection(ref.id, isProtected);
    let cryptoKey: CryptoKey | undefined;

    if (isProtected) {
      const params: KdfParams = {
        salt: metaMap.get("salt") || "",
        verifier: metaMap.get("verifier") || "",
        iterations: metaMap.get("kdfIterations") || String(KDF_DEFAULT_ITERATIONS),
      };
      // Salt, verifier and iterations pinned earlier this session must not change.
      const pinned = this.kdfParams.get(ref.id);
      if (
        pinned &&
        (pinned.salt !== params.salt ||
          pinned.verifier !== params.verifier ||
          pinned.iterations !== params.iterations)
      ) {
        throw tamperedKdfError();
      }
      if (opts?.password) {
        // Bounded: the count comes from the sheet, which every writer can edit.
        const iterations = checkKdfIterations(params.iterations);
        cryptoKey = await deriveKey(opts.password, base64ToBytes(params.salt), iterations);
        const valid = await checkVerifier(params.verifier, cryptoKey);
        if (!valid) {
          throw new Error("Incorrect password");
        }
        this.keys.set(ref.id, cryptoKey);
      } else {
        // A project unlocked earlier in this session opens with the remembered key.
        const cached = this.keys.get(ref.id);
        if (!cached || !(await checkVerifier(params.verifier, cached))) {
          this.keys.delete(ref.id);
          throw new Error("Password required to decrypt project");
        }
        cryptoKey = cached;
      }
      this.kdfParams.set(ref.id, params);
    }

    let title = metaMap.get("title") || file.name;
    let description = metaMap.get("description") || "";
    if (isProtected && cryptoKey) {
      title = await decrypt(title, cryptoKey, metaContext("title"));
      if (description) {
        description = await decrypt(description, cryptoKey, metaContext("description"));
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
    /** Decrypts a row's payload, bound to the row's tab and leading columns. */
    const hookFor = (tab: string, row: string[]) =>
      key
        ? (payload: string) =>
            decrypt(payload, key, rowContext(tab, row.slice(0, PAYLOAD_COLUMN.get(tab))))
        : undefined;
    const decodeTab = async <T>(
      tab: string,
      decode: (
        row: string[],
        rowIndex: number,
        hook: ((payload: string) => Promise<string>) | undefined
      ) => Promise<RowDecodeResult<T>>,
      onEntity?: (entity: T, rowIndex: number) => void
    ): Promise<T[]> => {
      const entities: T[] = [];
      const rows = tabRows(tab).slice(1);
      // Append-only rows carry a unique id. The same row twice (e.g. two tabs flushed one write
      // queue, or a flush was interrupted before its rows were removed) counts once. Copies of an
      // id that differ are a conflict, e.g. a row inserted in the sheet to shadow someone's entry:
      // every copy is dropped with a warning, so neither the original nor the forgery wins.
      const copies = new Map<string, Set<string>>();
      if (tab !== "options") {
        for (const row of rows) {
          const rowId = row[0];
          if (!rowId || row.every((cell) => !cell)) continue;
          const set = copies.get(rowId) ?? new Set<string>();
          set.add(JSON.stringify(row));
          copies.set(rowId, set);
        }
      }
      const seenIds = new Set<string>();
      const reported = new Set<string>();
      for (const [i, row] of rows.entries()) {
        if (row.every((cell) => !cell)) continue;
        const rowId = row[0];
        if (tab !== "options" && rowId) {
          if ((copies.get(rowId)?.size ?? 0) > 1) {
            if (!reported.has(rowId)) {
              reported.add(rowId);
              warnings.push(
                `${tab} row ${i + 2}: id ${rowId} appears more than once with different content; every copy is ignored`
              );
            }
            continue;
          }
          if (seenIds.has(rowId)) continue;
          seenIds.add(rowId);
        }
        // Sheet row numbers are 1-based and row 1 is the header.
        const res = await decode(row, i + 2, hookFor(tab, row));
        if (res.entity) {
          entities.push(res.entity);
          onEntity?.(res.entity, i + 2);
        } else if (res.warning) warnings.push(res.warning);
      }
      return entities;
    };

    const owner = metaMap.get("owner");
    const optionRowOf = new Map<string, number>();
    const options = await decodeTab(
      "options",
      (row, n, hook) => decodeOptionRow(row, n, hook, owner),
      (option, n) => {
        if (!optionRowOf.has(option.id)) optionRowOf.set(option.id, n);
      }
    );
    this.optionIds.set(ref.id, new Set(options.map((o) => o.id)));
    this.optionRows.set(ref.id, { rowOf: optionRowOf, rowCount: tabRows("options").length });

    const grades = await decodeTab("grades", (row, n, hook) =>
      decodeGradeRow(row, n, undefined, hook)
    );

    const comments = await decodeTab("comments", (row, n, hook) =>
      decodeCommentRow(row, n, undefined, hook)
    );

    const rankings = await decodeTab("rankings", (row, n, hook) =>
      decodeRankingRow(row, n, undefined, hook)
    );

    const outcomes = await decodeTab("outcomes", (row, n, hook) => decodeOutcomeRow(row, n, hook));
    const contributions = await decodeTab("contributions", (row, n, hook) =>
      decodeContributionRow(row, n, hook)
    );
    const properties = await decodeTab("properties", (row, n, hook) =>
      decodePropertyRow(row, n, hook)
    );
    const resets = await decodeTab("resets", (row, n, hook) => decodeResetRow(row, n, hook));
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

  /**
   * Checks the Drive file `version` every 10 s while the tab is visible and reads the whole
   * project only when it changed, at most every 15 s (sheet-store contract, quota budget).
   */
  watch(ref: ProjectRef, onChange: (s: ProjectSnapshot) => void): Unsubscribe {
    return watchProjectChanges({
      client: this.client,
      ref,
      budget: this.queue.budget,
      onUpdate: () => this.openProject(ref),
      onChange,
    });
  }

  async append(ref: ProjectRef, entries: Entry[], opts?: AppendOptions): Promise<AppendResult> {
    const identity = await this.auth.getIdentity();

    let role: ParticipantRole;
    try {
      role = await this.resolveRole(ref.id, identity.participantId);
    } catch (err) {
      // Rate limited or offline: fall back to the role seen earlier in this session and still
      // enqueue the writes; Drive refuses them on flush if access was revoked since. Without a
      // known role nothing is written.
      const cached = this.roles.get(ref.id);
      if (!cached) throw err;
      role = cached.role;
    }
    if (role === "view") {
      throw new Error("PERMISSION_DENIED: View role cannot append entries");
    }
    // Validates the whole call before anything is written.
    const delegated = resolveDelegatedAuthor(entries, opts, role === "owner");
    // The outcomes tab is written by the owner only (sheet-store contract).
    if (role !== "owner" && entries.some((e) => e.kind === "outcome")) {
      throw new Error("PERMISSION_DENIED: Only the project owner may record outcomes");
    }
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

    // Protected projects keep every payload encrypted; never write plaintext into them. A key
    // loaded in this session always encrypts, whatever the (writable) meta tab says now.
    const key = await this.writeKey(ref.id);
    /** The row: its leading columns, then the payload sealed to them. */
    const sealRow = async (tab: string, columns: string[], payload: unknown): Promise<string[]> => {
      const json = JSON.stringify(payload);
      return [...columns, key ? await encrypt(json, key, rowContext(tab, columns)) : json];
    };

    const rows: { tab: string; row: string[] }[] = [];

    for (const entry of entries) {
      // Strictly increasing stamps keep "appended after a reset" decidable by time.
      const now = monotonicNow();
      const entryId = `entry_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      if (entry.kind === "grade") {
        rows.push({
          tab: "grades",
          row: await sealRow("grades", [entryId, now, by, entry.optionId], {
            value: entry.value,
            byName,
          }),
        });
      } else if (entry.kind === "comment") {
        rows.push({
          tab: "comments",
          row: await sealRow("comments", [entryId, now, by, entry.optionId], {
            body: entry.body,
            hidden: entry.hidden,
            replaces: entry.replaces,
            byName,
          }),
        });
      } else if (entry.kind === "ranking") {
        rows.push({
          tab: "rankings",
          row: await sealRow("rankings", [entryId, now, by], {
            ranking: entry.ranking,
            round: entry.round ?? currentRound,
            byName,
          }),
        });
      } else if (entry.kind === "outcome") {
        rows.push({
          tab: "outcomes",
          row: await sealRow("outcomes", [entryId, now, by], entry.outcome),
        });
      } else if (entry.kind === "property") {
        rows.push({
          tab: "properties",
          row: await sealRow("properties", [entryId, now, by, entry.optionId], {
            plugin: entry.plugin,
            key: entry.key,
            scope: entry.scope,
            value: entry.value,
            byName,
          }),
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
        rows.push({
          tab: "resets",
          row: await sealRow("resets", [entryId, now, by], { ...payload, byName }),
        });
      } else if (entry.kind === "contribution") {
        const c = entry.contribution;
        // Rule 1: the store stamps the author and time; caller-supplied `by`/`at` are ignored.
        // Contributions cannot be delegated (`resolveDelegatedAuthor` refused that above), so
        // the author is always the signed-in user.
        rows.push({
          tab: "contributions",
          row: await sealRow(
            "contributions",
            [c.id || entryId, now, identity.participantId, c.targetKind, c.targetId],
            {
              type: c.type,
              body: c.body,
              pros: c.pros,
              cons: c.cons,
              sources: c.sources,
              author: c.author,
              reviewStatus: c.reviewStatus,
            }
          ),
        });
      }
    }

    for (const { tab, row } of rows) {
      await this.queue.enqueue(ref.id, tab, row);
    }

    let result: FlushResult;
    try {
      result = await this.queue.flush(this.client);
    } catch {
      return { queued: await this.queue.getQueuedCount(ref.id), sent: 0 };
    }
    // Google refused this project's rows for good (access revoked, file deleted): say so instead
    // of reporting them as queued. Other projects' failures do not concern this call.
    const mine = result.failed?.find((f) => f.spreadsheetId === ref.id);
    if (mine) throw mine.error;
    return { queued: await this.queue.getQueuedCount(ref.id), sent: result.sent };
  }

  async updateOptions(ref: ProjectRef, ops: OptionOp[]): Promise<void> {
    const snap = await this.openProject(ref);
    if (snap.role !== "owner") {
      throw new Error("PERMISSION_DENIED: Only owner may update options");
    }
    // openProject succeeded, so a protected project has its key in this session.
    const key = await this.writeKey(ref.id);

    // Each option keeps its sheet row: changed options are written in place and added ones after
    // the last row. Rows that could not be decoded (direct edits) are never rewritten, so no
    // row shifts onto another option's.
    const layout = this.optionRows.get(ref.id) ?? { rowOf: new Map<string, number>(), rowCount: 0 };
    const rowOf = new Map(layout.rowOf);
    // Row 1 is the header, so data starts at row 2 even in an empty tab.
    let nextRow = Math.max(1, layout.rowCount) + 1;
    const current = new Map(snap.options.map((o) => [o.id, o]));
    const changed = new Set<string>();
    for (const op of ops) {
      if (op.op === "add") {
        if (!rowOf.has(op.option.id)) rowOf.set(op.option.id, nextRow++);
        current.set(op.option.id, op.option);
        changed.add(op.option.id);
      } else if (op.op === "update") {
        const existing = current.get(op.option.id);
        if (!existing) continue;
        current.set(op.option.id, { ...existing, ...op.option } as Option);
        changed.add(op.option.id);
      } else if (op.op === "remove") {
        const existing = current.get(op.id);
        if (!existing) continue;
        current.set(op.id, { ...existing, status: "removed" as const });
        changed.add(op.id);
      }
    }
    if (changed.size === 0) return;

    const identity = await this.auth.getIdentity();
    const updates: { range: string; values: string[][] }[] = [];
    if (layout.rowCount === 0) {
      // An empty tab gets its header back so data keeps starting at row 2.
      updates.push({ range: "options!A1:F1", values: [[...TAB_HEADERS.options]] });
    }
    for (const id of changed) {
      const opt = current.get(id);
      const row = rowOf.get(id);
      if (!opt || row === undefined) continue;
      const json = JSON.stringify(opt);
      // The `by` column names the option's author, like the payload does (F3: they must agree).
      const columns = [
        opt.id,
        String(opt.order ?? 0),
        opt.status,
        opt.at || "",
        opt.by || identity.participantId,
      ];
      updates.push({
        range: `options!A${row}:F${row}`,
        values: [
          [...columns, key ? await encrypt(json, key, rowContext("options", columns)) : json],
        ],
      });
    }

    await this.client.batchUpdateValues(ref.id, updates);
    this.optionRows.set(ref.id, { rowOf, rowCount: nextRow - 1 });
    this.optionIds.set(ref.id, new Set(current.keys()));
  }

  async updateMeta(ref: ProjectRef, patch: MetaPatch): Promise<void> {
    const snap = await this.openProject(ref);
    if (snap.role !== "owner") {
      throw new Error("PERMISSION_DENIED: Only owner may update meta");
    }
    const key = await this.writeKey(ref.id);
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
      set("title", key ? await encrypt(patch.title, key, metaContext("title")) : patch.title);
    }
    if (patch.description !== undefined) {
      set(
        "description",
        key ? await encrypt(patch.description, key, metaContext("description")) : patch.description
      );
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
      const sealJson = (name: string, value: unknown) => {
        const json = JSON.stringify(value);
        return key ? encrypt(json, key, metaContext(name)) : json;
      };
      set("strategy", await sealJson("strategy", next.strategy));
      set("strategyChanges", await sealJson("strategyChanges", next.strategyChanges));
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
        url: projectLinkUrl(ref.id),
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
    this.kdfParams.delete(ref.id);
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
    assertPasswordStrength(password);

    const salt = generateSalt();
    const saltBase64 = bytesToBase64(salt);
    const cryptoKey = await deriveKey(password, salt, KDF_DEFAULT_ITERATIONS);
    const verifier = await makeVerifier(cryptoKey);

    // 1. Rename the file so its name no longer reveals the title.
    await this.client.updateFile(ref.id, {
      name: PROTECTED_FILE_NAME,
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
    setMeta("kdfIterations", String(KDF_DEFAULT_ITERATIONS));
    setMeta("salt", saltBase64);
    setMeta("verifier", verifier);
    setMeta("title", await encrypt(snap.project.title, cryptoKey, metaContext("title")));
    if (snap.project.description) {
      setMeta(
        "description",
        await encrypt(snap.project.description, cryptoKey, metaContext("description"))
      );
    }
    if (snap.project.strategy) {
      setMeta(
        "strategy",
        await encrypt(JSON.stringify(snap.project.strategy), cryptoKey, metaContext("strategy"))
      );
    }
    if (snap.project.strategyChanges) {
      setMeta(
        "strategyChanges",
        await encrypt(
          JSON.stringify(snap.project.strategyChanges),
          cryptoKey,
          metaContext("strategyChanges")
        )
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
          copy[payloadColumn] = await encrypt(
            payload,
            cryptoKey,
            rowContext(tab, copy.slice(0, payloadColumn))
          );
        }
        rows.push(copy);
      }
      if (rows.length > 0) updates.push({ range: `${tab}!${columns}`, values: rows });
    }
    await this.client.batchUpdateValues(ref.id, updates);
    // The owner just chose the password, so later writes in this session encrypt with it.
    this.protection.set(ref.id, true);
    this.keys.set(ref.id, cryptoKey);
    this.kdfParams.set(ref.id, {
      salt: saltBase64,
      verifier,
      iterations: String(KDF_DEFAULT_ITERATIONS),
    });
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
    this.roles.set(spreadsheetId, { role, at: Date.now() });
    return role;
  }

  /**
   * Records what the meta tab says about protection. Once a project is known protected in this
   * session (seen protected, or its key loaded) a "not protected" meta is a downgrade attempt by
   * someone who can edit the sheet, and is refused instead of believed.
   */
  private noteProtection(spreadsheetId: string, sheetSaysProtected: boolean): void {
    if (sheetSaysProtected) {
      this.protection.set(spreadsheetId, true);
      return;
    }
    if (this.protection.get(spreadsheetId) === true || this.keys.has(spreadsheetId)) {
      throw downgradeError();
    }
    this.protection.set(spreadsheetId, false);
  }

  /**
   * The key every write to the project is sealed with, or `undefined` for a plain project. A key
   * loaded in this session is always used: nothing is written in plaintext once the project was
   * unlocked, whatever the meta tab says now.
   */
  private async writeKey(spreadsheetId: string): Promise<CryptoKey | undefined> {
    const key = this.keys.get(spreadsheetId);
    if (key) return key;
    if (await this.isProtected(spreadsheetId)) {
      throw new Error("Password required to write to a protected project");
    }
    return undefined;
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
      if (err instanceof Error && err.message.startsWith("PROTECTION_DOWNGRADE")) throw err;
      const known = this.rounds.get(spreadsheetId);
      if (known === undefined) throw err;
      return known;
    }
  }

  private async readMeta(spreadsheetId: string): Promise<Map<string, string>> {
    const data = await this.client.batchGetValues(spreadsheetId, ["meta!A:B"]);
    const meta = readMetaRows(data.valueRanges[0]?.values ?? []).values;
    this.noteProtection(spreadsheetId, meta.get("protected") === "true");
    this.rounds.set(spreadsheetId, parseVoting(meta.get("voting")).state.round);
    return meta;
  }
}
