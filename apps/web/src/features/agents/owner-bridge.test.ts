import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OwnerBridgeError,
  createAgentGrant,
  getOwnerToken,
  ownerBridgeFetch,
  ownerTokenProblem,
  setOwnerToken,
} from "./owner-bridge.js";

const TOKEN = "a".repeat(64);

describe("owner bridge (F5)", () => {
  afterEach(() => setOwnerToken(null));

  it("sends nothing without an owner token", async () => {
    const fetchImpl = vi.fn();
    await expect(
      ownerBridgeFetch("/live-session/proposals?projectId=p", {}, { fetchImpl })
    ).rejects.toBeInstanceOf(OwnerBridgeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses malformed tokens and keeps a valid one", () => {
    expect(ownerTokenProblem("short")).toMatch(/at least 32/);
    expect(ownerTokenProblem(`${"a".repeat(40)} b`)).toMatch(/no spaces/);
    expect(() => setOwnerToken("short")).toThrow();
    setOwnerToken(TOKEN);
    expect(getOwnerToken()).toBe(TOKEN);
    setOwnerToken(null);
    expect(getOwnerToken()).toBeNull();
  });

  it("mints a grant with the owner token as bearer", async () => {
    setOwnerToken(TOKEN);
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "req_1",
            token: "b".repeat(64),
            projectId: "p",
            target: { kind: "project" },
            permissions: ["read"],
            expiresAt: "2026-10-28T00:00:00.000Z",
          }),
          { status: 201 }
        )
    ) as unknown as typeof fetch;
    const grant = await createAgentGrant(
      { projectId: "p", instruction: "x", target: { kind: "project" }, permissions: ["read"] },
      { fetchImpl, nodeUrl: "http://127.0.0.1:4178/" }
    );
    expect(grant.token).toBe("b".repeat(64));
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://127.0.0.1:4178/api/v1/grants");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.credentials).toBe("omit");
  });

  it("reports a refused owner token", async () => {
    setOwnerToken(TOKEN);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(
      ownerBridgeFetch("/grants", { method: "POST", body: {} }, { fetchImpl })
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe("no hardcoded bridge token (F5)", () => {
  const root = path.resolve(__dirname, "../../../../..");
  const forbidden = ["deci", "agent", "token", "local"].join("_");

  const scan = (dir: string, hits: string[]) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) scan(full, hits);
      else if (/\.(ts|tsx|js|mjs|json|md)$/.test(entry)) {
        if (readFileSync(full, "utf8").includes(forbidden)) hits.push(path.relative(root, full));
      }
    }
  };

  it("appears nowhere in the web app, the node or the contracts", () => {
    const hits: string[] = [];
    for (const dir of [
      "apps/web/src",
      "packages/node",
      "specs/001-decision-engine-core/contracts",
    ]) {
      scan(path.join(root, dir), hits);
    }
    expect(hits).toEqual([]);
  });
});
