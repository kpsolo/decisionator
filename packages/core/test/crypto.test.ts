import { describe, expect, it } from "vitest";
import {
  checkVerifier,
  decrypt,
  deriveKey,
  encrypt,
  generateSalt,
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

  it("produces output format enc:v1:<base64 iv>:<base64 ciphertext>", async () => {
    const salt = generateSalt();
    const key = await deriveKey(password, salt, 1000); // lower iterations for speed in this unit test
    const encrypted = await encrypt(plaintext, key);

    expect(encrypted.startsWith("enc:v1:")).toBe(true);
    const parts = encrypted.split(":");
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe("enc");
    expect(parts[1]).toBe("v1");

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
    // modify one character of ciphertext base64
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:A${(parts[3] ?? "").slice(1)}`;

    await expect(decrypt(tampered, key)).rejects.toThrow();
  });
});
