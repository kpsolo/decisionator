import { describe, expect, it } from "vitest";
import storeManifest from "../../../../plugins/store-google-sheets/decisionator-plugin.json";
import strategyManifest from "../../../../plugins/strategy-borda/decisionator-plugin.json";
import {
  HOST_PLATFORM_VERSIONS,
  ModuleError,
  ModuleHost,
  validateManifest,
  withTimeout,
} from "./module-host.js";

describe("ModuleHost", () => {
  it("validates first-party manifests successfully", () => {
    const validatedStore = validateManifest(storeManifest);
    expect(validatedStore.id).toBe("org.decisionator.store.google-sheets");

    const validatedStrat = validateManifest(strategyManifest);
    expect(validatedStrat.id).toBe("org.decisionator.strategy.borda");
  });

  it("refuses module when platform range is unsatisfied", () => {
    const incompatibleManifest = {
      ...strategyManifest,
      platform: {
        runtime: "^2.0.0", // Host provides 1.0.0
      },
    };

    expect(() => validateManifest(incompatibleManifest)).toThrow(/requires runtime version/);
  });

  it("refuses module when required platform feature is missing from host", () => {
    const limitedHostVersions = {
      runtime: "1.0.0",
      // projectStore is omitted
    };

    expect(() => validateManifest(storeManifest, limitedHostVersions)).toThrow(
      /not supported by this host/
    );
  });

  it("enforces timeout on slow module calls", async () => {
    await expect(
      withTimeout("test.module", () => new Promise((resolve) => setTimeout(resolve, 50)), 10)
    ).rejects.toThrowError(ModuleError);
  });

  it("attributes module errors with ModuleError", async () => {
    await expect(
      withTimeout(
        "test.module",
        () => {
          throw new Error("Internal explosion");
        },
        100
      )
    ).rejects.toThrow(/\[Module test.module\] Internal explosion/);
  });
});
