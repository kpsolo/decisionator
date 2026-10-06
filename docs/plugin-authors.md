# Plugin Authoring Guide (v0.1)

Deci is built around an open, extensible architecture where storage backends, decision strategies, and idea sources are modular plugins implementing standardized contracts.

All extension points are managed and validated via `@decisionator/plugin-sdk`.

---

## Architecture & Extension Points

| Extension Point | Contract Document | Interface | Purpose |
|---|---|---|---|
| **Project Store** | [contracts/project-store.md](../specs/001-decision-engine-core/contracts/project-store.md) | `ProjectStore` | Manages project storage, persistence, access roles, and append log. |
| **Strategy** | [contracts/strategy.md](../specs/001-decision-engine-core/contracts/strategy.md) | `StrategyPlugin` | Runs deterministic tallies and decision algorithms. |
| **Idea Source** | [contracts/idea-source.md](../specs/001-decision-engine-core/contracts/idea-source.md) | `IdeaSourcePlugin` | Imports candidate options from clipboard, documents, or external databases. |

---

## 1. Implementing a Project Store

A `ProjectStore` handles the persistence lifecycle of projects and snapshots.

```typescript
import type {
  ProjectStore,
  NewProject,
  ProjectRef,
  ProjectSnapshot,
  Entry,
  AppendResult,
  OptionOp
} from "@decisionator/plugin-sdk";

export class MemoryProjectStore implements ProjectStore {
  readonly id = "org.example.store.memory";

  async signIn() {
    return { participantId: "user@example.com", displayName: "User", email: "user@example.com" };
  }

  async listProjects() { /* ... */ }
  async createProject(input: NewProject) { /* ... */ }
  async openProject(ref: ProjectRef) { /* ... */ }
  async append(ref: ProjectRef, entries: Entry[]): Promise<AppendResult> { /* ... */ }
  async updateOptions(ref: ProjectRef, ops: OptionOp[]) { /* ... */ }
  async updateMeta(ref: ProjectRef, patch: any) { /* ... */ }
  async deleteProject(ref: ProjectRef) { /* ... */ }
  async export(ref: ProjectRef) { /* ... */ }
}
```

### Testing your ProjectStore
The SDK provides a compliance test kit to verify that your implementation satisfies all append-only, role resolution, and delete semantics:

```typescript
import { runProjectStoreContractTests } from "@decisionator/plugin-sdk/testing";

describe("MyProjectStore Contract", () => {
  runProjectStoreContractTests(async () => {
    return new MyProjectStore();
  });
});
```

---

## 2. Implementing a Strategy Plugin

A `StrategyPlugin` implements a decision algorithm (such as Borda count, approval voting, or randomized selection).

### Contract Rules
1. **Determinism**: Given identical inputs and RNG seed, `decide()` must produce the identical `chosen` array and `explanation`.
2. **Forbidden Ambient Randomness**: Strategies MUST NOT call `Math.random()` or `crypto.getRandomValues()`. Any randomness required must be derived exclusively from the provided `rng` parameter.
3. **Precondition Checks**: Implement `check(input)` to validate minimum options, ballots, or prerequisite data before execution.

```typescript
import type { StrategyPlugin, StrategyInput, StrategyCheckResult, StrategyResult } from "@decisionator/plugin-sdk";
import type { Rng } from "@decisionator/core";

export class SimplePickStrategy implements StrategyPlugin {
  readonly id = "org.example.strategy.first";
  readonly version = "1.0.0";

  check(input: StrategyInput): StrategyCheckResult {
    if (input.options.length < 2) {
      return { ok: false, reason: "Requires at least 2 options" };
    }
    return { ok: true };
  }

  decide(input: StrategyInput, rng: Rng): StrategyResult {
    const chosen = [input.options[0]!.id];
    return {
      chosen,
      order: input.options.map(o => o.id),
      explanation: "Chose the first candidate option.",
      audit: { ballotsCounted: 0 }
    };
  }
}
```

### Testing your Strategy
Run the SDK strategy test kit to automatically verify determinism across 100 runs and detect illegal ambient randomness calls:

```typescript
import { runStrategyContractTests } from "@decisionator/plugin-sdk/testing";

describe("SimplePickStrategy Compliance", () => {
  runStrategyContractTests(new SimplePickStrategy(), { minOptions: 2 });
});
```

---

## 3. Implementing an Idea Source Plugin

An `IdeaSourcePlugin` converts raw inputs into candidate options for preview and formatting.

```typescript
import type { IdeaSourcePlugin, IdeaSourceRequest, IdeaSourceResult } from "@decisionator/plugin-sdk";

export class SimpleListIdeaSource implements IdeaSourcePlugin {
  async fetch(req: IdeaSourceRequest): Promise<IdeaSourceResult> {
    const text = req.input?.clipboardText || "";
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

    const candidates = lines.map(line => ({
      title: line,
      source: {
        sourceType: "clipboard",
        locator: "",
        itemKey: line.toLowerCase().replace(/\s+/g, "-"),
      }
    }));

    return { candidates };
  }
}
```

### Testing your IdeaSource
Test title bounds, stability across refreshes, and uniqueness using the SDK idea source test kit:

```typescript
import { runIdeaSourceContractTests } from "@decisionator/plugin-sdk/testing";

describe("SimpleListIdeaSource Compliance", () => {
  runIdeaSourceContractTests(new SimpleListIdeaSource());
});
```
