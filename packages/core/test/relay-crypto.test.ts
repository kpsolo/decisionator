import { describe, expect, it } from "vitest";
import {
  RequestReplayCache,
  decryptXChaCha20,
  encryptXChaCha20,
  generateEncryptionKeyPair,
  generateInviteSecret,
  generateRequestNonce,
  generateSigningKeyPair,
  hashInviteSecret,
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
    expect(headers["X-Dcg-Nonce"]).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(headers["X-Dcg-Signature"]).toBeTypeOf("string");

    const verify = (path: string, h: typeof headers, b: Uint8Array) =>
      verifyRequestSignature(
        "POST",
        path,
        h["X-Dcg-Timestamp"],
        h["X-Dcg-Nonce"],
        h["X-Dcg-Signature"],
        h["X-Dcg-Key"],
        b
      );

    // Verify valid signature
    expect(verify("/v1/docs/test-doc/changes", headers, body).valid).toBe(true);

    // Reject tampered body
    const tamperedBody = new TextEncoder().encode(JSON.stringify({ hello: "tampered" }));
    expect(verify("/v1/docs/test-doc/changes", headers, tamperedBody).valid).toBe(false);

    // Reject a different nonce than the one signed
    expect(
      verify(
        "/v1/docs/test-doc/changes",
        { ...headers, "X-Dcg-Nonce": generateRequestNonce() },
        body
      ).valid
    ).toBe(false);

    // Reject skew older than ±120s
    const oldHeaders = signRequest(
      "POST",
      "/v1/docs/test-doc/changes",
      now - 150_000,
      body,
      keyPair
    );
    const skewResult = verify("/v1/docs/test-doc/changes", oldHeaders, body);
    expect(skewResult.valid).toBe(false);
    expect(skewResult.error).toContain("skew");
  });

  it("covers the query string in the signature", () => {
    const keyPair = generateSigningKeyPair();
    const empty = new Uint8Array();
    const headers = signRequest(
      "GET",
      "/v1/docs/d/changes?after=5&limit=10",
      Date.now(),
      empty,
      keyPair
    );
    const check = (target: string) =>
      verifyRequestSignature(
        "GET",
        target,
        headers["X-Dcg-Timestamp"],
        headers["X-Dcg-Nonce"],
        headers["X-Dcg-Signature"],
        headers["X-Dcg-Key"],
        empty
      ).valid;
    expect(check("/v1/docs/d/changes?after=5&limit=10")).toBe(true);
    expect(check("/v1/docs/d/changes?after=0&limit=10")).toBe(false);
    expect(check("/v1/docs/d/changes")).toBe(false);
  });

  it("requires a well-formed nonce and rejects replays through the cache", () => {
    const keyPair = generateSigningKeyPair();
    const body = new Uint8Array();
    const headers = signRequest("DELETE", "/v1/docs/d", Date.now(), body, keyPair);
    const cache = new RequestReplayCache();
    const run = (nonce: string | undefined) =>
      verifyRequestSignature(
        "DELETE",
        "/v1/docs/d",
        headers["X-Dcg-Timestamp"],
        nonce,
        headers["X-Dcg-Signature"],
        headers["X-Dcg-Key"],
        body,
        { replayCache: cache }
      );

    expect(run(undefined).valid).toBe(false);
    expect(run("short").error).toContain("nonce");
    expect(cache.size).toBe(0);

    expect(run(headers["X-Dcg-Nonce"]).valid).toBe(true);
    const replay = run(headers["X-Dcg-Nonce"]);
    expect(replay.valid).toBe(false);
    expect(replay.error).toContain("Replayed");
  });

  it("keeps replay cache entries only until they expire and refuses when full", () => {
    const cache = new RequestReplayCache(2);
    expect(cache.remember("k", "n1", 1_000, 0)).toBe("ok");
    expect(cache.remember("k", "n1", 1_000, 500)).toBe("replay");
    expect(cache.remember("k", "n2", 1_000, 500)).toBe("ok");
    expect(cache.remember("k", "n3", 1_000, 500)).toBe("full");
    // After expiry the old entries are pruned and room frees up.
    expect(cache.remember("k", "n3", 5_000, 2_000)).toBe("ok");
  });

  it("generates 256-bit invite secrets with a hex SHA-256 hash", () => {
    const secret = generateInviteSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateInviteSecret()).not.toBe(secret);
    expect(hashInviteSecret(secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteSecret("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
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
