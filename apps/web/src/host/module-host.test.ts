import type { ProjectStore } from "@decisionator/plugin-sdk";
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

  it("forwards append options (delegated append, contract v1.2.0) to the store", async () => {
    const calls: unknown[][] = [];
    const store = {
      id: "org.decisionator.store.google-sheets",
      append: async (...args: unknown[]) => {
        calls.push(args);
        return { queued: 0, sent: 1 };
      },
    } as unknown as ProjectStore;
    const host = new ModuleHost();
    host.registerProjectStore(storeManifest, store);

    const ref = { store: "google-sheets", id: "sheet_1" };
    const entries = [{ kind: "grade" as const, optionId: "opt_1", value: 4 as const }];
    const opts = { onBehalfOf: { participantId: "peer:a", displayName: "Ann" } };
    await host.getProjectStore("org.decisionator.store.google-sheets").append(ref, entries, opts);

    expect(calls).toEqual([[ref, entries, opts]]);
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
