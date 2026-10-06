export class RateLimitedError extends Error {
  constructor(
    message = "Google API rate limit exceeded",
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "RateLimitedError";
  }
}

export class ProjectUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(`Project is unavailable: ${reason}`);
    this.name = "ProjectUnavailableError";
  }
}

/** HTTP 400, e.g. a range that names a tab the spreadsheet does not have. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  version: string;
  trashed?: boolean;
  appProperties?: Record<string, string>;
}

export interface GooglePermission {
  id: string;
  type: string;
  role: string;
  emailAddress?: string;
  allowFileDiscovery?: boolean;
}

export interface ValueRange {
  range: string;
  values?: string[][];
}

export interface GoogleSpreadsheet {
  spreadsheetId: string;
  properties?: { title?: string };
  sheets?: { properties?: { title?: string } }[];
}

export class GoogleApiClient {
  constructor(private getAuthToken: () => Promise<string>) {}

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const token = await this.getAuthToken();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(url, { ...init, headers });

    if (!res.ok) {
      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After");
        const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : undefined;
        throw new RateLimitedError("Google API 429 Too Many Requests", seconds);
      }

      if (res.status === 403) {
        const errJson = await res.json().catch(() => null);
        const reason =
          errJson?.error?.errors?.[0]?.reason ||
          errJson?.error?.status ||
          errJson?.error?.message ||
          "";
        if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
          throw new RateLimitedError("Google API 403 rateLimitExceeded");
        }
        throw new ProjectUnavailableError(`PERMISSION_DENIED: ${reason || "Forbidden"}`);
      }

      if (res.status === 404) {
        throw new ProjectUnavailableError("File not found or deleted");
      }

      if (res.status === 400) {
        const errJson = await res.json().catch(() => null);
        throw new BadRequestError(
          `Google API request failed [400]: ${errJson?.error?.message || res.statusText}`
        );
      }

      throw new Error(`Google API request failed [${res.status}]: ${res.statusText}`);
    }

    if (res.status === 204) {
      return null as unknown as T;
    }

    return (await res.json()) as T;
  }

  // Drive API
  async getFile(
    fileId: string,
    fields = "id,name,mimeType,version,trashed,appProperties"
  ): Promise<GoogleDriveFile> {
    return this.request<GoogleDriveFile>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}`
    );
  }

  async listFiles(
    query: string,
    fields = "files(id,name,mimeType,version,appProperties)"
  ): Promise<{ files: GoogleDriveFile[] }> {
    return this.request<{ files: GoogleDriveFile[] }>(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}`
    );
  }

  async createFile(file: {
    name: string;
    mimeType: string;
    appProperties?: Record<string, string>;
  }): Promise<GoogleDriveFile> {
    return this.request<GoogleDriveFile>("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      body: JSON.stringify(file),
    });
  }

  async updateFile(
    fileId: string,
    patch: { trashed?: boolean; name?: string; appProperties?: Record<string, string> }
  ): Promise<GoogleDriveFile> {
    return this.request<GoogleDriveFile>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(patch),
      }
    );
  }

  async createPermission(
    fileId: string,
    permission: Partial<GooglePermission>
  ): Promise<GooglePermission> {
    return this.request<GooglePermission>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`,
      {
        method: "POST",
        body: JSON.stringify(permission),
      }
    );
  }

  async listPermissions(fileId: string): Promise<{ permissions: GooglePermission[] }> {
    return this.request<{ permissions: GooglePermission[] }>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?fields=permissions(id,type,role,emailAddress,allowFileDiscovery)`
    );
  }

  async deletePermission(fileId: string, permissionId: string): Promise<void> {
    return this.request<void>(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`,
      {
        method: "DELETE",
      }
    );
  }

  // Sheets API
  async createSpreadsheet(title: string, sheetTitles: string[]): Promise<GoogleSpreadsheet> {
    return this.request<GoogleSpreadsheet>("https://sheets.googleapis.com/v4/spreadsheets", {
      method: "POST",
      body: JSON.stringify({
        properties: { title },
        sheets: sheetTitles.map((t) => ({ properties: { title: t } })),
      }),
    });
  }

  async getSheetTitles(spreadsheetId: string): Promise<string[]> {
    const res = await this.request<GoogleSpreadsheet>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`
    );
    return (res.sheets ?? []).flatMap((s) => (s.properties?.title ? [s.properties.title] : []));
  }

  async addSheets(spreadsheetId: string, titles: string[]): Promise<void> {
    await this.request(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: "POST",
        body: JSON.stringify({
          requests: titles.map((title) => ({ addSheet: { properties: { title } } })),
        }),
      }
    );
  }

  async batchGetValues(
    spreadsheetId: string,
    ranges: string[]
  ): Promise<{ valueRanges: ValueRange[] }> {
    const params = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
    return this.request<{ valueRanges: ValueRange[] }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params}`
    );
  }

  async appendValues(
    spreadsheetId: string,
    range: string,
    values: string[][]
  ): Promise<{ updates: unknown }> {
    return this.request<{ updates: unknown }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW`,
      {
        method: "POST",
        body: JSON.stringify({ values }),
      }
    );
  }

  async batchUpdateValues(
    spreadsheetId: string,
    data: { range: string; values: string[][] }[]
  ): Promise<{ totalUpdatedRows: number }> {
    return this.request<{ totalUpdatedRows: number }>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
      {
        method: "POST",
        body: JSON.stringify({
          valueInputOption: "RAW",
          data,
        }),
      }
    );
  }
}
