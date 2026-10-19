import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleAuthService } from "../src/auth.js";
import { GoogleApiClient, UnauthorizedError } from "../src/google-api.js";

interface TokenClientConfig {
  callback: (resp: unknown) => void;
  error_callback?: (err: { type: string; message?: string }) => void;
}

function stubGis(onRequest: (config: TokenClientConfig) => void) {
  vi.stubGlobal("window", {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (config: TokenClientConfig) => ({
            requestAccessToken: () => onRequest(config),
          }),
        },
      },
    },
  });
}

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("GoogleAuthService", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects when the GIS popup fails instead of hanging", async () => {
    stubGis((config) => config.error_callback?.({ type: "popup_failed_to_open" }));
    const auth = new GoogleAuthService({ clientId: "test-client" });
    await expect(auth.requestToken(true)).rejects.toThrow(/popup_failed_to_open/);
  });

  it("drops a token the API rejected so the next call requests a fresh one", async () => {
    let issued = 0;
    stubGis((config) =>
      config.callback({
        access_token: `fresh-${++issued}`,
        expires_in: 3600,
        scope: "",
        token_type: "Bearer",
      })
    );
    const auth = new GoogleAuthService({ clientId: "test-client" });
    auth.setTokenInMemory("stale");
    auth.invalidateToken("stale");
    expect(await auth.getValidToken()).toBe("fresh-1");
  });
});

describe("GoogleApiClient on 401", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refreshes the token once and retries the request", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const auth = new Headers(init.headers).get("Authorization") ?? "";
        seen.push(auth);
        return auth === "Bearer new" ? json(200, { id: "f", version: "3" }) : json(401);
      })
    );
    let token = "old";
    const refresh = vi.fn(async () => {
      token = "new";
      return token;
    });
    const client = new GoogleApiClient(async () => token, refresh);

    const file = await client.getFile("f");
    expect(file.version).toBe("3");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["Bearer old", "Bearer new"]);
  });

  it("gives up after one retry with an UnauthorizedError", async () => {
    const fetchMock = vi.fn(async () => json(401));
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn(async () => "still-bad");
    const client = new GoogleApiClient(async () => "bad", refresh);

    await expect(client.getFile("f")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
