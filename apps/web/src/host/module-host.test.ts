import type { ProjectStore } from "@decisionator/plugin-sdk";
import { describe, expect, it } from "vitest";
import optionStatusManifest from "../../../../plugins/option-status/decisionator-plugin.json";
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

describe("validateManifest: option extension points (manifest 1.2)", () => {
  const base = {
    manifestVersion: 1,
    id: "org.example.props",
    name: "Props",
    version: "0.1.0",
    platform: { runtime: "^1.0.0", optionProperties: "^1.0.0", optionView: "^1.0.0" },
    main: "dist/index.js",
  };
  const cost = { key: "cost", label: "Cost per person", type: "number", scope: "shared" };
  const withProps = (optionProperties: unknown[], extra: Record<string, unknown> = {}) => ({
    ...base,
    provides: { optionProperties, ...extra },
  });

  it("provides optionProperties and optionView 1.0.0 and keeps projectStore 1.4.0", () => {
    expect(HOST_PLATFORM_VERSIONS.optionProperties).toBe("1.0.0");
    expect(HOST_PLATFORM_VERSIONS.optionView).toBe("1.0.0");
    expect(HOST_PLATFORM_VERSIONS.projectStore).toBe("1.4.0");
  });

  it("accepts the built-in option-status manifest", () => {
    const m = validateManifest(optionStatusManifest);
    expect(m.id).toBe("org.decisionator.option-status");
    expect(m.provides.optionView?.replaces).toEqual(["marker"]);
    expect(m.provides.exposure).toBe(true);
  });

  it("accepts properties, view places and exposure", () => {
    const m = validateManifest(
      withProps(
        [
          { ...cost, cardBadge: true },
          {
            key: "priority",
            label: "Priority",
            type: "choice",
            scope: "shared",
            choices: [
              { value: "low", label: "Low" },
              { value: "high", label: "High" },
            ],
            default: "low",
          },
        ],
        { optionView: { places: ["badges", "sections"], replaces: [] }, exposure: false }
      )
    );
    expect(m.provides.optionProperties).toHaveLength(2);
  });

  it("refuses duplicate property keys, naming the property", () => {
    expect(() => validateManifest(withProps([cost, { ...cost, label: "Other" }]))).toThrow(
      /Option property "cost" is declared more than once/
    );
  });

  it("refuses a choice property without choices, naming the property", () => {
    expect(() =>
      validateManifest(
        withProps([{ key: "level", label: "Level", type: "choice", scope: "shared" }])
      )
    ).toThrow(/Option property "level" is invalid: choices/);
  });

  it("refuses choices on a non-choice property", () => {
    expect(() =>
      validateManifest(withProps([{ ...cost, choices: [{ value: "a", label: "A" }] }]))
    ).toThrow(/Option property "cost" is invalid: choices/);
  });

  it("refuses duplicate choice values", () => {
    const choices = [
      { value: "a", label: "A" },
      { value: "a", label: "Again" },
    ];
    expect(() =>
      validateManifest(
        withProps([{ key: "pick", label: "Pick", type: "choice", scope: "person", choices }])
      )
    ).toThrow(/Option property "pick" is invalid: choices: choice values must be unique/);
  });

  it("refuses a default that does not fit the type", () => {
    expect(() => validateManifest(withProps([{ ...cost, default: "abc" }]))).toThrow(
      /Option property "cost" is invalid: default: Cost per person: enter a number/
    );
  });

  it("refuses a bad key or scope", () => {
    expect(() => validateManifest(withProps([{ ...cost, key: "Cost" }]))).toThrow(
      /Option property "Cost" is invalid: key/
    );
    expect(() => validateManifest(withProps([{ ...cost, scope: "everyone" }]))).toThrow(
      /Option property "cost" is invalid: scope/
    );
  });

  it("refuses more than 20 properties", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ ...cost, key: `p${i}` }));
    expect(() => validateManifest(withProps(many))).toThrow(/Manifest schema validation failed/);
  });

  it("refuses unknown view places and replacing places other than the marker", () => {
    expect(() =>
      validateManifest({ ...base, provides: { optionView: { places: ["title"] } } })
    ).toThrow(/Manifest schema validation failed/);
    expect(() =>
      validateManifest({ ...base, provides: { optionView: { replaces: ["badges"] } } })
    ).toThrow(/Manifest schema validation failed/);
  });

  it("refuses a manifest needing option properties from a host without them", () => {
    expect(() => validateManifest(withProps([cost]), { runtime: "1.0.0" })).toThrow(
      /not supported by this host/
    );
  });
});
