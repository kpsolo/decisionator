import { describe, expect, it } from "vitest";
import { createRng } from "../src/rng/index.js";

describe("Normative SHA-256 counter-mode RNG (contracts/strategy.md)", () => {
  it("matches nextUint32() x3 for seed 000102030405060708090a0b0c0d0e0f", () => {
    const rng = createRng("000102030405060708090a0b0c0d0e0f");

    expect(rng.nextUint32()).toBe(2237479810);
    expect(rng.nextUint32()).toBe(1432266169);
    expect(rng.nextUint32()).toBe(209670291);
  });

  it("matches int(4) x5 for seed 000102030405060708090a0b0c0d0e0f", () => {
    const rng = createRng("000102030405060708090a0b0c0d0e0f");

    expect(rng.int(4)).toBe(2);
    expect(rng.int(4)).toBe(1);
    expect(rng.int(4)).toBe(3);
    expect(rng.int(4)).toBe(2);
    expect(rng.int(4)).toBe(0);
  });

  it("matches int(10) x5 for seed ffffffffffffffffffffffffffffffff", () => {
    const rng = createRng("ffffffffffffffffffffffffffffffff");

    expect(rng.int(10)).toBe(3);
    expect(rng.int(10)).toBe(8);
    expect(rng.int(10)).toBe(9);
    expect(rng.int(10)).toBe(1);
    expect(rng.int(10)).toBe(4);
  });

  it("matches float() x1 for seed ffffffffffffffffffffffffffffffff", () => {
    const rng = createRng("ffffffffffffffffffffffffffffffff");

    expect(rng.float()).toBeCloseTo(0.060539633583655994, 15);
  });
});
