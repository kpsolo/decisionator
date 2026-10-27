import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Verifiable draw seeds (strategy contract v1.2.0 § Draw seed).
 *
 * The seed of a recorded outcome is not chosen by anyone: it is derived from data that the
 * outcome itself records, so anyone can recompute it and the owner cannot grind seeds.
 *
 *   seed = hex( SHA-256( utf8(DRAW_SEED_DOMAIN) ‖ 0x00 ‖ utf8(canonicalJson(material)) ) )[0..32)
 *
 * where `material` is `{ round, strategy: { id, version }, options: [{ id, weight? }], ballots,
 * grades, settings, runInput }` taken from the outcome's `round`, `strategy` and `inputs`.
 * Option titles are left out: they do not change the decision, and sealed projects may store
 * them differently. Arrays keep their recorded order (the order is an input to the draw).
 */
export const DRAW_SEED_DOMAIN = "decisionator/draw-seed/v1";

export interface DrawSeedSource {
  round?: number;
  strategy: { id: string; version: string };
  inputs: {
    options: { id: string; title?: string; weight?: number }[];
    ballots?: { by: string; ranking: string[] }[];
    grades?: { optionId: string; average: number; count: number }[];
    settings?: unknown;
    runInput?: unknown;
  };
}

/**
 * Deterministic JSON: object keys sorted by UTF-16 code unit order, `undefined` members dropped,
 * arrays kept in order, numbers as ECMAScript `Number#toString` (via JSON.stringify).
 * Non-finite numbers are rejected so that two serializations can never disagree on them.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
      return JSON.stringify(value);
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof value}`);
  }
}

/** The canonical text hashed into a draw seed (exposed so third parties can audit it). */
export function drawSeedMaterial(source: DrawSeedSource): string {
  const { inputs } = source;
  return canonicalJson({
    round: source.round ?? 1,
    strategy: { id: source.strategy.id, version: source.strategy.version },
    options: inputs.options.map((o) => ({ id: o.id, weight: o.weight })),
    ballots: inputs.ballots?.map((b) => ({ by: b.by, ranking: b.ranking })),
    grades: inputs.grades?.map((g) => ({
      optionId: g.optionId,
      average: g.average,
      count: g.count,
    })),
    settings: inputs.settings,
    runInput: inputs.runInput,
  });
}

/** The 128-bit draw seed (32 lowercase hex chars) for an outcome's round, strategy and inputs. */
export function deriveDrawSeed(source: DrawSeedSource): string {
  const encoder = new TextEncoder();
  const domain = encoder.encode(DRAW_SEED_DOMAIN);
  const body = encoder.encode(drawSeedMaterial(source));
  const bytes = new Uint8Array(domain.length + 1 + body.length);
  bytes.set(domain, 0);
  bytes[domain.length] = 0;
  bytes.set(body, domain.length + 1);
  return Array.from(sha256(bytes).subarray(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type OutcomeSeedCheck =
  /** The outcome records no seed: no draw took part in it. */
  | { status: "no-draw" }
  /** The recorded seed equals the public derivation. */
  | { status: "verified"; seed: string }
  /**
   * The recorded seed is not the public derivation: the outcome was recorded before verifiable
   * draws (a CSPRNG seed) or its seed or inputs were altered. Either way the draw cannot be shown
   * to be fair. Displayed as "legacy / unverifiable"; never an error.
   */
  | { status: "unverifiable"; recorded: string; expected: string | null };

/** Checks an outcome's recorded seed against {@link deriveDrawSeed}. Never throws. */
export function verifyOutcomeSeed(outcome: DrawSeedSource & { seed?: string }): OutcomeSeedCheck {
  if (!outcome.seed) return { status: "no-draw" };
  let expected: string | null;
  try {
    expected = deriveDrawSeed(outcome);
  } catch {
    expected = null;
  }
  if (expected !== null && expected === outcome.seed.toLowerCase()) {
    return { status: "verified", seed: expected };
  }
  return { status: "unverifiable", recorded: outcome.seed, expected };
}
