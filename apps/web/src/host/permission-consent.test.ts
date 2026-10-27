import type { StrategyPlugin } from "@decisionator/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import sheetsManifest from "../../../../plugins/store-google-sheets/decisionator-plugin.json";
import strategyManifest from "../../../../plugins/strategy-borda/decisionator-plugin.json";
import { ModuleHost } from "./module-host.js";
import {
  PermissionConsent,
  type PermissionRequest,
  consentKey,
  memoryConsentStore,
  normalizePermissions,
} from "./permission-consent.js";

const thirdParty = {
  ...strategyManifest,
  id: "com.example.strategy.fancy",
  name: "Fancy",
  version: "1.0.0",
  permissions: ["net:https://api.example.com", "project:read"],
};

const strategy: StrategyPlugin = {
  check: () => ({ ok: true }),
  decide: () => ({ ranking: [] }) as unknown as ReturnType<StrategyPlugin["decide"]>,
};

describe("PermissionConsent (F12)", () => {
  it("denies un-consented permissions by default", () => {
    const consent = new PermissionConsent({ store: memoryConsentStore(), prompt: () => true });
    expect(consent.granted(thirdParty)).toEqual([]);
  });

  it("grants after the person approves, per id, version and permission set", async () => {
    const prompt = vi.fn((_request: PermissionRequest) => true);
    const consent = new PermissionConsent({ store: memoryConsentStore(), prompt });
    expect(await consent.request(thirdParty)).toEqual([
      "net:https://api.example.com",
      "project:read",
    ]);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0]?.[0]).toMatchObject({
      pluginId: "com.example.strategy.fancy",
      permissions: ["net:https://api.example.com", "project:read"],
    });
    // Remembered: no second prompt.
    expect(await consent.request(thirdParty)).toHaveLength(2);
    expect(prompt).toHaveBeenCalledTimes(1);
    // A new version or a wider set asks again and is not granted meanwhile.
    expect(consent.granted({ ...thirdParty, version: "1.0.1" })).toEqual([]);
    expect(
      consent.granted({ ...thirdParty, permissions: [...thirdParty.permissions, "clipboard:read"] })
    ).toEqual([]);
    consent.revoke(thirdParty);
    expect(consent.granted(thirdParty)).toEqual([]);
  });

  it("grants nothing when the person refuses", async () => {
    const consent = new PermissionConsent({ store: memoryConsentStore(), prompt: () => false });
    expect(await consent.request(thirdParty)).toEqual([]);
    expect(consent.granted(thirdParty)).toEqual([]);
  });

  it("pre-approves listed first-party built-ins only within their listed set", () => {
    const consent = new PermissionConsent({ store: memoryConsentStore(), prompt: () => false });
    expect(consent.granted(sheetsManifest)).toEqual(
      normalizePermissions(sheetsManifest.permissions)
    );
    // A manifest that claims a first-party id but asks for more is not pre-approved.
    const spoof = {
      ...sheetsManifest,
      permissions: [...sheetsManifest.permissions, "net:https://evil.example"],
    };
    expect(consent.isPreapproved(spoof)).toBe(false);
    expect(consent.granted(spoof)).toEqual([]);
  });

  it("never grants malformed permissions, even when approved", async () => {
    const bad = {
      ...thirdParty,
      permissions: [
        "net:*",
        "net:https://*.example.com",
        "net:http://api.example.com",
        "net:https://api.example.com/path",
        "net:https://a.example.com; script-src *",
        "project:read",
      ],
    };
    const consent = new PermissionConsent({ store: memoryConsentStore(), prompt: () => true });
    expect(await consent.request(bad)).toEqual(["project:read"]);
    expect(consentKey(bad.id, bad.version, ["project:read"])).toBe(
      "com.example.strategy.fancy@1.0.0#project:read"
    );
  });
});

describe("ModuleHost permissions (F12)", () => {
  it("does not grant manifest permissions without consent", () => {
    const host = new ModuleHost(
      undefined,
      new PermissionConsent({ store: memoryConsentStore(), prompt: () => true })
    );
    host.registerStrategy(thirdParty, strategy);
    const instance = host.sandboxHost.getInstance(thirdParty.id);
    expect(instance && [...instance.grantedPermissions]).toEqual([]);
  });

  it("grants what the person approved through requestPermissions", async () => {
    const host = new ModuleHost(
      undefined,
      new PermissionConsent({ store: memoryConsentStore(), prompt: () => true })
    );
    expect(await host.requestPermissions(thirdParty)).toHaveLength(2);
    host.registerStrategy(thirdParty, strategy);
    const instance = host.sandboxHost.getInstance(thirdParty.id);
    expect(instance && [...instance.grantedPermissions].sort()).toEqual([
      "net:https://api.example.com",
      "project:read",
    ]);
  });
});
