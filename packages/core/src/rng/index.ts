import { sha256 } from "@noble/hashes/sha2.js";

export interface Rng {
  readonly seed: string;
  nextUint32(): number;
  int(maxExclusive: number): number;
  float(): number;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function createRng(seedHex: string): Rng {
  const seedBytes = hexToBytes(seedHex);
  let blockCounter = 0;
  const wordBuffer: number[] = [];

  function generateNextBlock(): void {
    const counterBytes = new Uint8Array(4);
    const view = new DataView(counterBytes.buffer);
    view.setUint32(0, blockCounter, false); // big-endian uint32
    blockCounter++;

    const input = new Uint8Array(seedBytes.length + 4);
    input.set(seedBytes, 0);
    input.set(counterBytes, seedBytes.length);

    const hash = sha256(input);
    const hashView = new DataView(hash.buffer, hash.byteOffset, hash.byteLength);

    for (let offset = 0; offset < 32; offset += 4) {
      wordBuffer.push(hashView.getUint32(offset, false)); // big-endian words
    }
  }

  function nextUint32(): number {
    if (wordBuffer.length === 0) {
      generateNextBlock();
    }
    const word = wordBuffer.shift();
    if (word === undefined) {
      throw new Error("Unexpected empty word buffer");
    }
    return word;
  }

  function int(maxExclusive: number): number {
    if (maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
      throw new Error(`Invalid range for int: ${maxExclusive}`);
    }
    const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
    let w = nextUint32();
    while (w >= limit) {
      w = nextUint32();
    }
    return w % maxExclusive;
  }

  function float(): number {
    const a = nextUint32();
    const b = nextUint32();
    return ((a >>> 5) * 67108864 + (b >>> 6)) / 9007199254740992; // 2^26 = 67108864, 2^53 = 9007199254740992
  }

  return {
    seed: seedHex,
    nextUint32,
    int,
    float,
  };
}
