import { http, HttpResponse } from "msw";
import { type DriveFile, type SheetGrid, fakeGoogleState } from "./state.js";

function checkRateLimit() {
  if (fakeGoogleState.rateLimitNext) {
    fakeGoogleState.rateLimitNext = false;
    const status = fakeGoogleState.rateLimitCode;
    return HttpResponse.json(
      {
        error: {
          code: status,
          message: status === 429 ? "Too Many Requests" : "Rate Limit Exceeded",
          status: status === 429 ? "RESOURCE_EXHAUSTED" : "RATE_LIMIT_EXCEEDED",
        },
      },
      { status }
    );
  }
  return null;
}

/** A parsed A1 range; rows and columns are 0-based, an absent end is unbounded. */
interface A1Range {
  tab: string;
  startRow: number;
  startCol: number;
  endRow?: number;
  endCol?: number;
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const ch of letters.toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** Parses `tab`, `'my tab'!A:B`, `tab!B3`, `tab!A2:F9`, `tab!2:4` the way values.batchUpdate does. */
function parseA1Range(range: string): A1Range | undefined {
  const match = range.match(/^(?:'((?:[^']|'')+)'|([^!]+))(?:!(.+))?$/);
  if (!match) return undefined;
  const tab = match[1] !== undefined ? match[1].replace(/''/g, "'") : (match[2] ?? "");
  if (!match[3]) return { tab, startRow: 0, startCol: 0 };

  const parts = match[3].split(":");
  if (parts.length > 2) return undefined;
  const cells = parts.map((p) => p.match(/^([A-Za-z]*)(\d*)$/));
  if (cells.some((c) => !c || (!c[1] && !c[2]))) return undefined;
  const [start, end] = cells as RegExpMatchArray[];
  if (!start) return undefined;

  const col = (c: RegExpMatchArray | undefined) => (c?.[1] ? columnIndex(c[1]) : undefined);
  const row = (c: RegExpMatchArray | undefined) => (c?.[2] ? Number(c[2]) - 1 : undefined);
  // A single cell is bounded by itself; `A:B` and `2:4` leave rows or columns open.
  const last = end ?? start;
  return {
    tab,
    startRow: row(start) ?? 0,
    startCol: col(start) ?? 0,
    endRow: row(last),
    endCol: col(last),
  };
}

function checkFits(range: A1Range, values: string[][]): string | undefined {
  const width = Math.max(0, ...values.map((r) => r.length));
  if (range.endRow !== undefined && range.startRow + values.length - 1 > range.endRow) {
    return `Requested writing within range ${range.tab}, but tried writing to row ${range.startRow + values.length}`;
  }
  if (range.endCol !== undefined && range.startCol + width - 1 > range.endCol) {
    return `Requested writing within range ${range.tab}, but tried writing to column ${range.startCol + width}`;
  }
  return undefined;
}

/** Overwrites only the addressed cells; everything outside them keeps its value. */
function writeCells(rows: string[][], range: A1Range, values: string[][]): void {
  values.forEach((valueRow, i) => {
    const r = range.startRow + i;
    while (rows.length <= r) rows.push([]);
    const target = rows[r] ?? [];
    rows[r] = target;
    valueRow.forEach((value, j) => {
      const c = range.startCol + j;
      while (target.length < c) target.push("");
      target[c] = value;
    });
  });
}

/** Values inside `range`, trimmed of trailing empty cells and rows like the real API. */
function readCells(rows: string[][], range: A1Range): string[][] | undefined {
  const lastRow = Math.min(rows.length - 1, range.endRow ?? Number.POSITIVE_INFINITY);
  const out: string[][] = [];
  for (let r = range.startRow; r <= lastRow; r++) {
    const row = rows[r] ?? [];
    const cells = row.slice(
      range.startCol,
      range.endCol === undefined ? undefined : range.endCol + 1
    );
    while (cells.length > 0 && !cells[cells.length - 1]) cells.pop();
    out.push(cells);
  }
  while (out.length > 0 && out[out.length - 1]?.length === 0) out.pop();
  return out.length > 0 ? out : undefined;
}

function badRange(range: string) {
  return HttpResponse.json(
    {
      error: { code: 400, message: `Unable to parse range: ${range}`, status: "INVALID_ARGUMENT" },
    },
    { status: 400 }
  );
}

function canWrite(file: DriveFile): boolean {
  const user = fakeGoogleState.getCurrentUser();
  const perm = file.permissions.find((p) => p.emailAddress === user.email || p.type === "anyone");
  return file.ownerEmail === user.email || perm?.role === "writer" || perm?.role === "owner";
}

export const googleHandlers = [
  // Drive: about.get
  http.get("https://www.googleapis.com/drive/v3/about", () => {
    const rl = checkRateLimit();
    if (rl) return rl;

    const user = fakeGoogleState.getCurrentUser();
    return HttpResponse.json({
      user: {
        displayName: user.displayName,
        emailAddress: user.email,
        permissionId: user.email,
      },
    });
  }),

  // Drive: files.list
  http.get("https://www.googleapis.com/drive/v3/files", ({ request }) => {
    const rl = checkRateLimit();
    if (rl) return rl;

    const url = new URL(request.url);
    const q = url.searchParams.get("q") || "";
    const user = fakeGoogleState.getCurrentUser();

    let files = Array.from(fakeGoogleState.files.values()).filter((f) => !f.trashed);

    // check user permissions
    files = files.filter((f) => {
      if (f.ownerEmail === user.email) return true;
      const perm = f.permissions.find((p) => p.emailAddress === user.email || p.type === "anyone");
      return !!perm;
    });

    // filter appProperties if present
    if (q.includes("appProperties has")) {
      const matchKey = q.match(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/);
      if (matchKey?.[1] && matchKey[2]) {
        const key = matchKey[1];
        const val = matchKey[2];
        files = files.filter((f) => f.appProperties[key] === val);
      }
    }

    return HttpResponse.json({
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        appProperties: f.appProperties,
        version: String(f.version),
      })),
    });
  }),

  // Drive: files.create
  http.post("https://www.googleapis.com/drive/v3/files", async ({ request }) => {
    const rl = checkRateLimit();
    if (rl) return rl;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const user = fakeGoogleState.getCurrentUser();
    const id = `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const newFile: DriveFile = {
      id,
      name: (body.name as string) || "Untitled",
      mimeType: (body.mimeType as string) || "application/octet-stream",
      trashed: false,
      version: 1,
      appProperties: (body.appProperties as Record<string, string>) || {},
      ownerEmail: user.email,
      permissions: [
        {
          id: `perm_owner_${user.email}`,
          type: "user",
          role: "owner",
          emailAddress: user.email,
        },
      ],
    };

    fakeGoogleState.files.set(id, newFile);

    // If it's a spreadsheet, initialize sheets grid
    if (newFile.mimeType === "application/vnd.google-apps.spreadsheet") {
      const grid: SheetGrid = { tabs: new Map() };
      fakeGoogleState.sheets.set(id, grid);
    }

    return HttpResponse.json(newFile);
  }),

  // Drive: files.get
  http.get("https://www.googleapis.com/drive/v3/files/:fileId", ({ params, request }) => {
    const rl = checkRateLimit();
    if (rl) return rl;

    const file = fakeGoogleState.files.get(params.fileId as string);
    if (!file || file.trashed) {
      return HttpResponse.json(
        { error: { code: 404, message: "File not found" } },
        { status: 404 }
      );
    }

    const user = fakeGoogleState.getCurrentUser();
    const isOwner = file.ownerEmail === user.email;
    const perm = file.permissions.find((p) => p.emailAddress === user.email || p.type === "anyone");
    if (!isOwner && !perm) {
      return HttpResponse.json(
        { error: { code: 403, message: "Permission denied" } },
        { status: 403 }
      );
    }

    return HttpResponse.json({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      trashed: file.trashed,
      version: String(file.version),
      appProperties: file.appProperties,
    });
  }),

  // Drive: files.update (e.g. trashed = true)
  http.patch("https://www.googleapis.com/drive/v3/files/:fileId", async ({ params, request }) => {
    const rl = checkRateLimit();
    if (rl) return rl;

    const file = fakeGoogleState.files.get(params.fileId as string);
    if (!file) {
      return HttpResponse.json(
        { error: { code: 404, message: "File not found" } },
        { status: 404 }
      );
    }

    const user = fakeGoogleState.getCurrentUser();
    if (file.ownerEmail !== user.email) {
      return HttpResponse.json(
        { error: { code: 403, message: "Permission denied: owner only" } },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.trashed !== undefined) {
      file.trashed = Boolean(body.trashed);
    }
    if (body.appProperties !== undefined) {
      file.appProperties = {
        ...file.appProperties,
        ...(body.appProperties as Record<string, string>),
      };
    }
    file.version++;

    return HttpResponse.json({
      id: file.id,
      trashed: file.trashed,
      version: String(file.version),
    });
  }),

  // Drive: permissions.create
  http.post(
    "https://www.googleapis.com/drive/v3/files/:fileId/permissions",
    async ({ params, request }) => {
      const rl = checkRateLimit();
      if (rl) return rl;

      const file = fakeGoogleState.files.get(params.fileId as string);
      if (!file || file.trashed) {
        return HttpResponse.json(
          { error: { code: 404, message: "File not found" } },
          { status: 404 }
        );
      }

      const user = fakeGoogleState.getCurrentUser();
      if (file.ownerEmail !== user.email) {
        return HttpResponse.json(
          { error: { code: 403, message: "Permission denied" } },
          { status: 403 }
        );
      }

      const body = (await request.json()) as Partial<DriveFile["permissions"][0]>;
      const permId = `perm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const newPerm = {
        id: permId,
        type: body.type || "user",
        role: body.role || "reader",
        emailAddress: body.emailAddress,
        allowFileDiscovery: body.allowFileDiscovery,
      };

      // Remove existing if matching user or anyone
      file.permissions = file.permissions.filter((p) => {
        if (newPerm.type === "anyone" && p.type === "anyone") return false;
        if (newPerm.type === "user" && p.emailAddress === newPerm.emailAddress) return false;
        return true;
      });
      file.permissions.push(newPerm);

      return HttpResponse.json(newPerm);
    }
  ),

  // Drive: permissions.list
  http.get("https://www.googleapis.com/drive/v3/files/:fileId/permissions", ({ params }) => {
    const rl = checkRateLimit();
    if (rl) return rl;

    const file = fakeGoogleState.files.get(params.fileId as string);
    if (!file || file.trashed) {
      return HttpResponse.json(
        { error: { code: 404, message: "File not found" } },
        { status: 404 }
      );
    }

    return HttpResponse.json({ permissions: file.permissions });
  }),

  // Drive: permissions.delete
  http.delete(
    "https://www.googleapis.com/drive/v3/files/:fileId/permissions/:permissionId",
    ({ params }) => {
      const rl = checkRateLimit();
      if (rl) return rl;

      const file = fakeGoogleState.files.get(params.fileId as string);
      if (!file || file.trashed) {
        return HttpResponse.json(
          { error: { code: 404, message: "File not found" } },
          { status: 404 }
        );
      }

      const user = fakeGoogleState.getCurrentUser();
      if (file.ownerEmail !== user.email) {
        return HttpResponse.json(
          { error: { code: 403, message: "Permission denied" } },
          { status: 403 }
        );
      }

      file.permissions = file.permissions.filter((p) => p.id !== params.permissionId);
      return new HttpResponse(null, { status: 204 });
    }
  ),

  // Sheets: spreadsheets.create
  http.post("https://sheets.googleapis.com/v4/spreadsheets", async ({ request }) => {
    const rl = checkRateLimit();
    if (rl) return rl;

    const user = fakeGoogleState.getCurrentUser();
    const body = (await request.json().catch(() => ({}))) as {
      properties?: { title?: string };
      sheets?: { properties?: { title?: string } }[];
    };

    const id = `sheet_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const title = body.properties?.title || "Untitled Spreadsheet";

    const driveFile: DriveFile = {
      id,
      name: title,
      mimeType: "application/vnd.google-apps.spreadsheet",
      trashed: false,
      version: 1,
      appProperties: {},
      ownerEmail: user.email,
      permissions: [
        {
          id: `perm_owner_${user.email}`,
          type: "user",
          role: "owner",
          emailAddress: user.email,
        },
      ],
    };
    fakeGoogleState.files.set(id, driveFile);

    const grid: SheetGrid = { tabs: new Map() };
    if (body.sheets) {
      for (const s of body.sheets) {
        if (s.properties?.title) {
          grid.tabs.set(s.properties.title, []);
        }
      }
    }
    fakeGoogleState.sheets.set(id, grid);

    return HttpResponse.json({
      spreadsheetId: id,
      properties: { title },
      sheets: Array.from(grid.tabs.keys()).map((tabTitle) => ({
        properties: { title: tabTitle },
      })),
    });
  }),

  // Sheets: spreadsheets.get (tab titles only)
  http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId", ({ params }) => {
    const rl = checkRateLimit();
    if (rl) return rl;

    const id = params.spreadsheetId as string;
    const file = fakeGoogleState.files.get(id);
    const grid = fakeGoogleState.sheets.get(id);
    if (!file || file.trashed || !grid) {
      return HttpResponse.json(
        { error: { code: 404, message: "Spreadsheet not found" } },
        { status: 404 }
      );
    }
    return HttpResponse.json({
      spreadsheetId: id,
      sheets: Array.from(grid.tabs.keys()).map((title) => ({ properties: { title } })),
    });
  }),

  // Sheets: spreadsheets.batchUpdate (addSheet only)
  http.post(
    /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/([^/:]+):batchUpdate$/,
    async ({ request }) => {
      const rl = checkRateLimit();
      if (rl) return rl;

      const id = decodeURIComponent(
        request.url.match(/spreadsheets\/([^/:]+):batchUpdate/)?.[1] ?? ""
      );
      const file = fakeGoogleState.files.get(id);
      const grid = fakeGoogleState.sheets.get(id);
      if (!file || file.trashed || !grid) {
        return HttpResponse.json(
          { error: { code: 404, message: "Spreadsheet not found" } },
          { status: 404 }
        );
      }
      if (!canWrite(file)) {
        return HttpResponse.json(
          { error: { code: 403, message: "Permission denied: write required" } },
          { status: 403 }
        );
      }

      const body = (await request.json()) as {
        requests?: { addSheet?: { properties?: { title?: string } } }[];
      };
      const titles = (body.requests ?? []).map((r) => r.addSheet?.properties?.title);
      for (const title of titles) {
        if (!title || grid.tabs.has(title)) {
          return HttpResponse.json(
            {
              error: {
                code: 400,
                message: `Invalid requests[0].addSheet: A sheet with the name "${title}" already exists.`,
                status: "INVALID_ARGUMENT",
              },
            },
            { status: 400 }
          );
        }
      }
      for (const title of titles) {
        if (title) grid.tabs.set(title, []);
      }
      file.version++;
      return HttpResponse.json({
        spreadsheetId: id,
        replies: titles.map((title) => ({ addSheet: { properties: { title } } })),
      });
    }
  ),

  // Sheets: values.batchGet
  http.get(
    "https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values:batchGet",
    ({ params, request }) => {
      const rl = checkRateLimit();
      if (rl) return rl;

      const id = params.spreadsheetId as string;
      const file = fakeGoogleState.files.get(id);
      if (!file || file.trashed) {
        return HttpResponse.json(
          { error: { code: 404, message: "Spreadsheet not found" } },
          { status: 404 }
        );
      }

      const grid = fakeGoogleState.sheets.get(id);
      if (!grid) {
        return HttpResponse.json(
          { error: { code: 404, message: "Spreadsheet grid not found" } },
          { status: 404 }
        );
      }

      const url = new URL(request.url);
      const ranges = url.searchParams.getAll("ranges");

      const valueRanges: { range: string; values?: string[][] }[] = [];
      for (const r of ranges) {
        const range = parseA1Range(r);
        const rows = range ? grid.tabs.get(range.tab) : undefined;
        // Like the real API, one unknown tab fails the whole request.
        if (!range || !rows) return badRange(r);
        valueRanges.push({ range: r, values: readCells(rows, range) });
      }

      return HttpResponse.json({
        spreadsheetId: id,
        valueRanges,
      });
    }
  ),

  // Sheets: values.append (e.g. values/{range}:append)
  http.post(
    /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/([^/]+)\/values\/(.+):append$/,
    async ({ request }) => {
      const rl = checkRateLimit();
      if (rl) return rl;

      const match = request.url.match(
        /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/([^/]+)\/values\/(.+):append/
      );
      if (!match || !match[1] || !match[2]) {
        return HttpResponse.json({ error: { code: 400, message: "Invalid URL" } }, { status: 400 });
      }
      const id = match[1];
      const rangeParam = match[2];

      const file = fakeGoogleState.files.get(id);
      if (!file || file.trashed) {
        return HttpResponse.json(
          { error: { code: 404, message: "Spreadsheet not found" } },
          { status: 404 }
        );
      }

      const user = fakeGoogleState.getCurrentUser();
      const isOwner = file.ownerEmail === user.email;
      const perm = file.permissions.find(
        (p) => p.emailAddress === user.email || p.type === "anyone"
      );
      const canWrite = isOwner || perm?.role === "writer" || perm?.role === "owner";
      if (!canWrite) {
        return HttpResponse.json(
          { error: { code: 403, message: "Permission denied: write required" } },
          { status: 403 }
        );
      }

      const grid = fakeGoogleState.sheets.get(id);
      if (!grid) {
        return HttpResponse.json(
          { error: { code: 404, message: "Spreadsheet grid not found" } },
          { status: 404 }
        );
      }

      const rangeStr = decodeURIComponent(rangeParam);
      const tabName = parseA1Range(rangeStr)?.tab ?? "";
      const rows = grid.tabs.get(tabName);
      if (!rows) return badRange(rangeStr);

      const body = (await request.json()) as { values?: string[][] };
      const appendedRows = body.values || [];
      for (const r of appendedRows) {
        rows.push(r);
      }
      file.version++;

      return HttpResponse.json({
        spreadsheetId: id,
        updates: {
          updatedRange: `${tabName}!A${rows.length - appendedRows.length + 1}`,
          updatedRows: appendedRows.length,
        },
      });
    }
  ),

  // Sheets: values.batchUpdate
  http.post(
    "https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values:batchUpdate",
    async ({ params, request }) => {
      const rl = checkRateLimit();
      if (rl) return rl;

      const id = params.spreadsheetId as string;
      const file = fakeGoogleState.files.get(id);
      if (!file || file.trashed) {
        return HttpResponse.json(
          { error: { code: 404, message: "Spreadsheet not found" } },
          { status: 404 }
        );
      }

      const user = fakeGoogleState.getCurrentUser();
      const isOwner = file.ownerEmail === user.email;
      const perm = file.permissions.find(
        (p) => p.emailAddress === user.email || p.type === "anyone"
      );
      const canWrite = isOwner || perm?.role === "writer" || perm?.role === "owner";
      if (!canWrite) {
        return HttpResponse.json(
          { error: { code: 403, message: "Permission denied: write required" } },
          { status: 403 }
        );
      }

      const grid = fakeGoogleState.sheets.get(id);
      if (!grid) {
        return HttpResponse.json(
          { error: { code: 404, message: "Spreadsheet grid not found" } },
          { status: 404 }
        );
      }

      const body = (await request.json()) as {
        data?: { range: string; values: string[][] }[];
      };

      // Validate every range first: like the real API, a bad item rejects the whole batch.
      const writes: { range: A1Range; values: string[][] }[] = [];
      for (const item of body.data ?? []) {
        const range = parseA1Range(item.range);
        if (!range || !grid.tabs.has(range.tab)) return badRange(item.range);
        const values = item.values ?? [];
        const problem = checkFits(range, values);
        if (problem) {
          return HttpResponse.json(
            { error: { code: 400, message: problem, status: "INVALID_ARGUMENT" } },
            { status: 400 }
          );
        }
        writes.push({ range, values });
      }
      for (const { range, values } of writes) {
        writeCells(grid.tabs.get(range.tab) ?? [], range, values);
      }
      file.version++;

      return HttpResponse.json({
        spreadsheetId: id,
        totalUpdatedRows: body.data?.reduce((acc, d) => acc + (d.values?.length || 0), 0) || 0,
      });
    }
  ),
];
