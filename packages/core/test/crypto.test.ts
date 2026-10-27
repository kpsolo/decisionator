import { describe, expect, it } from "vitest";
import {
  KDF_MAX_ITERATIONS,
  KDF_MIN_ITERATIONS,
  MIN_PASSWORD_LENGTH,
  assertPasswordStrength,
  checkKdfIterations,
  checkVerifier,
  decrypt,
  deriveKey,
  encrypt,
  generateSalt,
  isSealed,
  makeVerifier,
} from "../src/crypto/payload-codec.js";

describe("WebCrypto Password Codec", () => {
  const password = "correct-horse-battery-staple";
  const plaintext = JSON.stringify({ title: "Super Secret Project", round: 1 });

  it("handles KDF parameters: pbkdf2-sha256, 600 000 iterations, 16-byte salt", async () => {
    const salt = generateSalt();
    expect(salt.byteLength).toBe(16);

    const key = await deriveKey(password, salt, 600_000);
    expect(key.algorithm.name).toBe("AES-GCM");
    // Verify it is a 256-bit AES key
    // @ts-expect-error length exists on AesKeyAlgorithm
    expect(key.algorithm.length).toBe(256);
  });

  it("produces output format enc:v2:<base64 iv>:<base64 ciphertext>", async () => {
    const salt = generateSalt();
    const key = await deriveKey(password, salt, 1000); // lower iterations for speed in this unit test
    const encrypted = await encrypt(plaintext, key);

    expect(encrypted.startsWith("enc:v2:")).toBe(true);
    const parts = encrypted.split(":");
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe("enc");
    expect(parts[1]).toBe("v2");

    // Base64 decode IV to verify 12 bytes
    const ivBase64 = parts[2] ?? "";
    const ivBytes = Buffer.from(ivBase64, "base64");
    expect(ivBytes.byteLength).toBe(12);

    // Ciphertext should not be empty
    const cipherBase64 = parts[3] ?? "";
    const cipherBytes = Buffer.from(cipherBase64, "base64");
    expect(cipherBytes.byteLength).toBeGreaterThan(0);
  });

  it("generates a unique 12-byte IV per call for the same plaintext", async () => {
    const salt = generateSalt();
    const key = await deriveKey(password, salt, 1000);

    const enc1 = await encrypt(plaintext, key);
    const enc2 = await encrypt(plaintext, key);

    expect(enc1).not.toBe(enc2);
    const iv1 = enc1.split(":")[2];
    const iv2 = enc2.split(":")[2];
    expect(iv1).not.toBe(iv2);
  });

  it("round-trips encryption and decryption accurately", async () => {
    const salt = generateSalt();
    const key = await deriveKey(password, salt, 1000);

    const encrypted = await encrypt(plaintext, key);
    const decrypted = await decrypt(encrypted, key);

    expect(decrypted).toBe(plaintext);
    expect(JSON.parse(decrypted)).toEqual({ title: "Super Secret Project", round: 1 });
  });

  it("fails verifier when wrong password is supplied", async () => {
    const salt = generateSalt();
    const correctKey = await deriveKey(password, salt, 1000);
    const wrongKey = await deriveKey("wrong-password", salt, 1000);

    const verifier = await makeVerifier(correctKey);
    const okCorrect = await checkVerifier(verifier, correctKey);
    expect(okCorrect).toBe(true);

    const okWrong = await checkVerifier(verifier, wrongKey);
    expect(okWrong).toBe(false);
  });

  it("fails decryption if ciphertext is tampered", async () => {
    const salt = generateSalt();
    const key = await deriveKey(password, salt, 1000);

    const encrypted = await encrypt(plaintext, key);
    const parts = encrypted.split(":");
    // modify first character of ciphertext base64 deterministically
    const cipherText = parts[3] ?? "";
    const firstChar = cipherText[0] ?? "A";
    const flippedChar = firstChar === "A" ? "B" : "A";
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${flippedChar}${cipherText.slice(1)}`;

    await expect(decrypt(tampered, key)).rejects.toThrow();
  });
});

/** A v1 ciphertext as written before context binding: AES-GCM without additional data. */
async function legacyEncrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return `enc:v1:${Buffer.from(iv).toString("base64")}:${Buffer.from(ct).toString("base64")}`;
}

describe("Codec v2 context binding (AAD)", () => {
  const password = "correct-horse-battery-staple";

  it("a value sealed for one option does not decrypt as another option's (swap)", async () => {
    const key = await deriveKey(password, generateSalt(), 1000);
    const a = await encrypt("Option A", key, ["option", "opt-a", "title"]);
    const b = await encrypt("Option B", key, ["option", "opt-b", "title"]);

    expect(await decrypt(a, key, ["option", "opt-a", "title"])).toBe("Option A");
    expect(await decrypt(b, key, ["option", "opt-b", "title"])).toBe("Option B");
    // Swapped between records, or moved to another field of the same record: refused.
    await expect(decrypt(a, key, ["option", "opt-b", "title"])).rejects.toThrow();
    await expect(decrypt(b, key, ["option", "opt-a", "title"])).rejects.toThrow();
    await expect(decrypt(a, key, ["option", "opt-a", "description"])).rejects.toThrow();
    // Context parts are encoded unambiguously.
    const joined = await encrypt("x", key, ["a:b", "c"]);
    await expect(decrypt(joined, key, ["a", "b:c"])).rejects.toThrow();
  });

  it("still decrypts legacy v1 ciphertexts (no AAD), whatever the context", async () => {
    const key = await deriveKey(password, generateSalt(), 1000);
    const legacy = await legacyEncrypt("Old title", key);
    expect(isSealed(legacy)).toBe(true);
    expect(await decrypt(legacy, key)).toBe("Old title");
    expect(await decrypt(legacy, key, ["meta", "title"])).toBe("Old title");
  });

  it("accepts a legacy v1 verifier and writes v2 verifiers", async () => {
    const key = await deriveKey(password, generateSalt(), 1000);
    const legacy = await legacyEncrypt("decisionator:verifier:v1", key);
    expect(await checkVerifier(legacy, key)).toBe(true);
    const fresh = await makeVerifier(key);
    expect(fresh.startsWith("enc:v2:")).toBe(true);
    expect(await checkVerifier(fresh, key)).toBe(true);
  });

  it("rejects unknown codec versions", async () => {
    const key = await deriveKey(password, generateSalt(), 1000);
    const sealed = await encrypt("x", key);
    await expect(decrypt(sealed.replace("enc:v2:", "enc:v9:"), key)).rejects.toThrow(
      /Invalid encrypted payload/
    );
    expect(isSealed("plain text")).toBe(false);
  });
});

describe("KDF iteration bounds and password length", () => {
  it("accepts iteration counts within [100k, 5M], as numbers or digit strings", () => {
    expect(checkKdfIterations(600_000)).toBe(600_000);
    expect(checkKdfIterations("600000")).toBe(600_000);
    expect(checkKdfIterations(KDF_MIN_ITERATIONS)).toBe(KDF_MIN_ITERATIONS);
    expect(checkKdfIterations(KDF_MAX_ITERATIONS)).toBe(KDF_MAX_ITERATIONS);
  });

  it("rejects iteration counts outside the range or not integers", () => {
    for (const bad of [0, 1, 99_999, 5_000_001, 1e12, 600_000.5, "abc", "", null, undefined]) {
      expect(() => checkKdfIterations(bad)).toThrow(/INVALID_KDF/);
    }
  });

  it("rejects passwords shorter than 12 characters", () => {
    expect(() => assertPasswordStrength("short")).toThrow(/at least 12/);
    expect(() => assertPasswordStrength("12345678901")).toThrow(/at least 12/);
    expect(() => assertPasswordStrength("123456789012")).not.toThrow();
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });
});
