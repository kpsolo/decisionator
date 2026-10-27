import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../module-host.js";
import { buildPluginCsp, parseNetPermission } from "./csp.js";
import { buildFrameSrcdoc, escapeHtml } from "./frame-manager.js";

describe("parseNetPermission (F12)", () => {
  it("accepts exact https origins", () => {
    expect(parseNetPermission("net:https://docs.googleapis.com")).toBe(
      "https://docs.googleapis.com"
    );
    expect(parseNetPermission("net:https://api.example.com:8443")).toBe(
      "https://api.example.com:8443"
    );
  });

  it.each([
    "net:*",
    "net:https://*",
    "net:https://*.example.com",
    "net:http://api.example.com",
    "net:wss://api.example.com",
    "net:https://api.example.com/",
    "net:https://api.example.com/path",
    "net:https://api.example.com?x=1",
    "net:https://user:pw@api.example.com",
    "net:https://api.example.com 'unsafe-inline'",
    "net:https://api.example.com; script-src *",
    'net:https://api.example.com"',
    "net:https://API.example.com",
    "net:https://a..example.com",
    "net:https://api.example.com:99999",
    "net:",
    "net: https://api.example.com",
    "project:read",
  ])("rejects %s", (permission) => {
    expect(parseNetPermission(permission)).toBeNull();
  });
});

describe("buildPluginCsp (F12)", () => {
  it("never turns net:* into connect-src *", () => {
    expect(buildPluginCsp(["net:*"]).connectSrc).toBe("'none'");
  });

  it("lists only valid origins, de-duplicated", () => {
    const { connectSrc, cspHeaderOrMeta } = buildPluginCsp([
      "net:https://a.example.com",
      "net:https://a.example.com",
      "net:https://b.example.com; script-src *",
      "net:http://c.example.com",
      "oauth:google",
    ]);
    expect(connectSrc).toBe("https://a.example.com");
    expect(cspHeaderOrMeta).toContain("connect-src https://a.example.com;");
    expect(cspHeaderOrMeta.match(/;/g)).toHaveLength(4);
  });

  it("uses 'none' without network permissions", () => {
    expect(buildPluginCsp([]).connectSrc).toBe("'none'");
  });
});

describe("buildFrameSrcdoc (F15/L1)", () => {
  const manifest = (name: string) =>
    ({
      manifestVersion: 1,
      id: "com.example.p",
      name,
      version: "1.0.0",
      platform: { runtime: "^1.0.0" },
      main: "index.js",
      provides: {},
    }) as PluginManifest;

  it("escapes the manifest name", () => {
    const name = '</title><meta http-equiv="Content-Security-Policy" content="connect-src *">';
    const doc = buildFrameSrcdoc({
      manifest: manifest(name),
      grantedPermissions: [],
      bundleCode: "",
    });
    expect(doc).not.toContain(name);
    expect(doc).toContain(`<title>Plugin Frame: ${escapeHtml(name)}</title>`);
    expect(doc.match(/<meta http-equiv/g)).toHaveLength(1);
  });

  it("builds the CSP meta only from validated origins", () => {
    const doc = buildFrameSrcdoc({
      manifest: manifest("P"),
      grantedPermissions: ['net:https://a.example.com" onload="x', "net:*"],
      bundleCode: "",
    });
    expect(doc).toContain("connect-src &#39;none&#39;;");
    expect(doc).not.toContain("onload");
  });
});
