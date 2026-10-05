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

      const valueRanges = ranges.map((r) => {
        // range could be "meta!A:B" or just "meta"
        const tabName = (r.split("!")[0] ?? r).replace(/'/g, "");
        const rows = grid.tabs.get(tabName) || [];
        return {
          range: r,
          values: rows,
        };
      });

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
      const tabName = (rangeStr.split("!")[0] ?? rangeStr).replace(/'/g, "");

      let rows = grid.tabs.get(tabName);
      if (!rows) {
        rows = [];
        grid.tabs.set(tabName, rows);
      }

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

      if (body.data) {
        for (const item of body.data) {
          const tabName = (item.range.split("!")[0] ?? item.range).replace(/'/g, "");
          grid.tabs.set(tabName, item.values);
        }
      }
      file.version++;

      return HttpResponse.json({
        spreadsheetId: id,
        totalUpdatedRows: body.data?.reduce((acc, d) => acc + (d.values?.length || 0), 0) || 0,
      });
    }
  ),
];
