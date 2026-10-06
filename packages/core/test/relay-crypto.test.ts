import { describe, expect, it } from "vitest";
import {
  decryptXChaCha20,
  encryptXChaCha20,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  sealBox,
  signRequest,
  unsealBox,
  verifyRequestSignature,
} from "../src/crypto/relay-crypto.js";

describe("Relay Cryptography Suite", () => {
  it("signs and verifies HTTP requests using Ed25519 with timestamp skew checks", () => {
    const keyPair = generateSigningKeyPair();
    const body = new TextEncoder().encode(JSON.stringify({ hello: "world" }));
    const now = Date.now();

    const headers = signRequest("POST", "/v1/docs/test-doc/changes", now, body, keyPair);

    expect(headers["X-Dcg-Key"]).toBe(keyPair.publicKeyBase64);
    expect(headers["X-Dcg-Timestamp"]).toBe(String(now));
    expect(headers["X-Dcg-Signature"]).toBeTypeOf("string");

    // Verify valid signature
    const verified = verifyRequestSignature(
      "POST",
      "/v1/docs/test-doc/changes",
      headers["X-Dcg-Timestamp"],
      headers["X-Dcg-Signature"],
      headers["X-Dcg-Key"],
      body
    );
    expect(verified.valid).toBe(true);

    // Reject tampered body
    const tamperedBody = new TextEncoder().encode(JSON.stringify({ hello: "tampered" }));
    const tamperedResult = verifyRequestSignature(
      "POST",
      "/v1/docs/test-doc/changes",
      headers["X-Dcg-Timestamp"],
      headers["X-Dcg-Signature"],
      headers["X-Dcg-Key"],
      tamperedBody
    );
    expect(tamperedResult.valid).toBe(false);

    // Reject skew older than ±120s
    const oldTimestamp = now - 150_000;
    const oldHeaders = signRequest(
      "POST",
      "/v1/docs/test-doc/changes",
      oldTimestamp,
      body,
      keyPair
    );
    const skewResult = verifyRequestSignature(
      "POST",
      "/v1/docs/test-doc/changes",
      oldHeaders["X-Dcg-Timestamp"],
      oldHeaders["X-Dcg-Signature"],
      oldHeaders["X-Dcg-Key"],
      body
    );
    expect(skewResult.valid).toBe(false);
    expect(skewResult.error).toContain("skew");
  });

  it("encrypts and decrypts change payload with XChaCha20-Poly1305", () => {
    const key = new Uint8Array(32);
    globalThis.crypto.getRandomValues(key);

    const plaintext = new TextEncoder().encode("sensitive automerge change bytes");
    const { nonceBase64, ciphertextBase64 } = encryptXChaCha20(plaintext, key);

    const decrypted = decryptXChaCha20(ciphertextBase64, nonceBase64, key);
    expect(new TextDecoder().decode(decrypted)).toBe("sensitive automerge change bytes");
  });

  it("seals and unseals project keys for two-step invites using X25519", () => {
    const recipientKey = generateEncryptionKeyPair();
    const projectKey = new Uint8Array(32);
    globalThis.crypto.getRandomValues(projectKey);

    const sealed = sealBox(projectKey, recipientKey.publicKey);
    const unsealed = unsealBox(sealed, recipientKey.privateKey);

    expect(unsealed).toEqual(projectKey);
  });
});
