import type { IdeaSourcePlugin, ProjectStore, StrategyPlugin } from "@decisionator/plugin-sdk";
import Ajv2020 from "ajv/dist/2020.js";
import semver from "semver";
import manifestSchema from "../../../../specs/001-decision-engine-core/contracts/plugin-manifest.schema.json";

export interface HostPlatformVersions {
  runtime: string;
  strategy?: string;
  ideaSource?: string;
  projectStore?: string;
  uiSlot?: string;
}

export const HOST_PLATFORM_VERSIONS: HostPlatformVersions = {
  runtime: "1.0.0",
  strategy: "1.1.0",
  ideaSource: "1.0.0",
  projectStore: "1.1.0",
  uiSlot: "1.0.0",
};

export interface PluginManifest {
  manifestVersion: number;
  id: string;
  name: string;
  version: string;
  platform: {
    runtime: string;
    strategy?: string;
    ideaSource?: string;
    projectStore?: string;
    uiSlot?: string;
  };
  main: string;
  provides: {
    strategy?: unknown;
    ideaSource?: unknown;
    projectStore?: unknown;
    uiSlots?: unknown[];
  };
  permissions?: string[];
  oauth?: Record<string, unknown>;
}

export class ModuleError extends Error {
  constructor(
    public readonly moduleId: string,
    message: string,
    public readonly cause?: unknown
  ) {
    super(`[Module ${moduleId}] ${message}`);
    this.name = "ModuleError";
  }
}

const ajv = new Ajv2020({ strict: false });
const validateManifestFn = ajv.compile(manifestSchema);

/**
 * Validates a plugin manifest and checks compatibility against host platform versions.
 */
export function validateManifest(
  manifest: unknown,
  hostVersions: HostPlatformVersions = HOST_PLATFORM_VERSIONS
): PluginManifest {
  const valid = validateManifestFn(manifest);
  if (!valid) {
    const errors = validateManifestFn.errors
      ?.map((e) => `${e.instancePath} ${e.message}`)
      .join(", ");
    throw new Error(`Manifest schema validation failed: ${errors}`);
  }

  const typedManifest = manifest as unknown as PluginManifest;

  // Verify platform range compatibility (Constitution §II)
  for (const [key, range] of Object.entries(typedManifest.platform)) {
    const hostVersion = hostVersions[key as keyof HostPlatformVersions];
    if (!hostVersion) {
      throw new Error(
        `Module "${typedManifest.id}" requires platform "${key}" which is not supported by this host`
      );
    }
    if (!semver.satisfies(hostVersion, range)) {
      throw new Error(
        `Module "${typedManifest.id}" requires ${key} version ${range}, but host provides ${hostVersion}`
      );
    }
  }

  return typedManifest;
}

/**
 * Executes an async or sync function with a timeout, attributing any error or timeout to the module.
 */
export async function withTimeout<T>(
  moduleId: string,
  fn: () => Promise<T> | T,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, rej) => {
      timer = setTimeout(() => {
        rej(new ModuleError(moduleId, `Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    Promise.race([Promise.resolve().then(fn), timeoutPromise])
      .then((res) => {
        if (timer) clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        if (timer) clearTimeout(timer);
        if (err instanceof ModuleError) {
          reject(err);
        } else {
          reject(new ModuleError(moduleId, err?.message ?? String(err), err));
        }
      });
  });
}

/**
 * Module Host: loads and manages first-party plugins implementing plugin-sdk contracts.
 */
export class ModuleHost {
  private stores = new Map<string, { manifest: PluginManifest; store: ProjectStore }>();
  private strategies = new Map<string, { manifest: PluginManifest; strategy: StrategyPlugin }>();
  private ideaSources = new Map<string, { manifest: PluginManifest; source: IdeaSourcePlugin }>();

  constructor(private hostVersions: HostPlatformVersions = HOST_PLATFORM_VERSIONS) {}

  registerProjectStore(rawManifest: unknown, store: ProjectStore): void {
    const manifest = validateManifest(rawManifest, this.hostVersions);
    if (!manifest.provides.projectStore) {
      throw new Error(`Module ${manifest.id} does not declare provides.projectStore`);
    }

    // Wrap store methods with timeouts and error attribution
    const wrappedStore: ProjectStore = {
      id: manifest.id,
      signIn: (opts) => withTimeout(manifest.id, () => store.signIn(opts), 5000),
      listProjects: () => withTimeout(manifest.id, () => store.listProjects(), 5000),
      createProject: (input, opts) =>
        withTimeout(manifest.id, () => store.createProject(input, opts), 5000),
      openProject: (ref, opts) =>
        withTimeout(manifest.id, () => store.openProject(ref, opts), 5000),
      watch: (ref, onChange) => store.watch(ref, onChange),
      append: (ref, entries) => withTimeout(manifest.id, () => store.append(ref, entries), 5000),
      updateOptions: (ref, ops) =>
        withTimeout(manifest.id, () => store.updateOptions(ref, ops), 5000),
      updateMeta: (ref, patch) =>
        withTimeout(manifest.id, () => store.updateMeta(ref, patch), 5000),
      share: (ref, req) => withTimeout(manifest.id, () => store.share(ref, req), 5000),
      getShareState: (ref) => withTimeout(manifest.id, () => store.getShareState(ref), 5000),
      export: (ref) => withTimeout(manifest.id, () => store.export(ref), 5000),
      deleteProject: (ref) => withTimeout(manifest.id, () => store.deleteProject(ref), 5000),
      forgetProject: (ref) => withTimeout(manifest.id, () => store.forgetProject(ref), 5000),
    };

    this.stores.set(manifest.id, { manifest, store: wrappedStore });
  }

  registerStrategy(rawManifest: unknown, strategy: StrategyPlugin): void {
    const manifest = validateManifest(rawManifest, this.hostVersions);
    if (!manifest.provides.strategy) {
      throw new Error(`Module ${manifest.id} does not declare provides.strategy`);
    }

    const wrappedStrategy: StrategyPlugin = {
      check: (input) => {
        try {
          return strategy.check(input);
        } catch (err) {
          throw new ModuleError(manifest.id, err instanceof Error ? err.message : String(err), err);
        }
      },
      decide: (input, rng) => {
        try {
          return strategy.decide(input, rng);
        } catch (err) {
          throw new ModuleError(manifest.id, err instanceof Error ? err.message : String(err), err);
        }
      },
    };

    this.strategies.set(manifest.id, { manifest, strategy: wrappedStrategy });
  }

  registerIdeaSource(rawManifest: unknown, source: IdeaSourcePlugin): void {
    const manifest = validateManifest(rawManifest, this.hostVersions);
    if (!manifest.provides.ideaSource) {
      throw new Error(`Module ${manifest.id} does not declare provides.ideaSource`);
    }

    const wrappedSource: IdeaSourcePlugin = {
      fetch: (req) => withTimeout(manifest.id, () => source.fetch(req), 5000),
    };

    this.ideaSources.set(manifest.id, { manifest, source: wrappedSource });
  }

  getProjectStore(id: string): ProjectStore {
    const entry = this.stores.get(id);
    if (!entry) {
      throw new Error(`Project store module "${id}" is not registered`);
    }
    return entry.store;
  }

  getStrategy(id: string): StrategyPlugin {
    const entry = this.strategies.get(id);
    if (!entry) {
      throw new Error(`Strategy module "${id}" is not registered`);
    }
    return entry.strategy;
  }

  getIdeaSource(id: string): IdeaSourcePlugin {
    const entry = this.ideaSources.get(id);
    if (!entry) {
      throw new Error(`Idea source module "${id}" is not registered`);
    }
    return entry.source;
  }
}
