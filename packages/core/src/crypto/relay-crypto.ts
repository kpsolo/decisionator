import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { ed25519, x25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    const b = bytes[i];
    if (b !== undefined) {
      binary += String.fromCharCode(b);
    }
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(base64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyBase64: string;
}

/**
 * Generate Ed25519 signing keypair
 */
export function generateSigningKeyPair(): KeyPair {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    publicKey,
    privateKey,
    publicKeyBase64: bytesToBase64(publicKey),
  };
}

/**
 * Generate X25519 Diffie-Hellman / encryption keypair
 */
export function generateEncryptionKeyPair(): KeyPair {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return {
    publicKey,
    privateKey,
    publicKeyBase64: bytesToBase64(publicKey),
  };
}

/**
 * Signs message with Ed25519 private key
 */
export function signEd25519(message: Uint8Array, privateKey: Uint8Array): string {
  const sig = ed25519.sign(message, privateKey);
  return bytesToBase64(sig);
}

/**
 * Verifies Ed25519 signature
 */
export function verifyEd25519(
  signatureBase64: string,
  message: Uint8Array,
  publicKey: Uint8Array | string
): boolean {
  try {
    const pub = typeof publicKey === "string" ? base64ToBytes(publicKey) : publicKey;
    const sig = base64ToBytes(signatureBase64);
    return ed25519.verify(sig, message, pub);
  } catch {
    return false;
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Allowed request nonce: 16–128 base64url / hex characters (≥ 96 bits when random). */
const REQUEST_NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** A fresh 128-bit request nonce, base64url without padding (22 chars). */
export function generateRequestNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * Computes the canonical request signature string (relay protocol v2):
 * "METHOD\nPATH_AND_QUERY\nTIMESTAMP\nNONCE\nSHA256_HEX(body)"
 *
 * `pathAndQuery` is the request target exactly as sent (path plus `?query`, if any), so a
 * query parameter cannot be altered without breaking the signature.
 */
export function computeRequestSignaturePayload(
  method: string,
  pathAndQuery: string,
  timestampMs: number | string,
  nonce: string,
  bodyBytes: Uint8Array
): Uint8Array {
  const bodyHashHex = toHex(sha256(bodyBytes));
  const text = `${method.toUpperCase()}\n${pathAndQuery}\n${timestampMs}\n${nonce}\n${bodyHashHex}`;
  return new TextEncoder().encode(text);
}

// A type alias (not an interface) so it stays assignable to `HeadersInit`.
export type SignedRequestHeaders = {
  "X-Dcg-Key": string;
  "X-Dcg-Timestamp": string;
  "X-Dcg-Nonce": string;
  "X-Dcg-Signature": string;
};

/**
 * Sign an HTTP or WS request using Ed25519. `pathAndQuery` must include the query string when
 * the request has one. A fresh random nonce is generated unless one is given.
 */
export function signRequest(
  method: string,
  pathAndQuery: string,
  timestampMs: number,
  bodyBytes: Uint8Array,
  signingKey: KeyPair,
  nonce: string = generateRequestNonce()
): SignedRequestHeaders {
  const payload = computeRequestSignaturePayload(
    method,
    pathAndQuery,
    timestampMs,
    nonce,
    bodyBytes
  );
  const sig = signEd25519(payload, signingKey.privateKey);
  return {
    "X-Dcg-Key": signingKey.publicKeyBase64,
    "X-Dcg-Timestamp": String(timestampMs),
    "X-Dcg-Nonce": nonce,
    "X-Dcg-Signature": sig,
  };
}

/**
 * Remembers `(key, nonce)` pairs of verified requests until their timestamp leaves the freshness
 * window, so a captured signed request cannot be replayed within it. In-memory and bounded: when
 * full (after pruning expired entries), new requests are refused rather than evicting live entries.
 */
export class RequestReplayCache {
  private readonly seen = new Map<string, number>();
  private lastPrune = 0;

  constructor(readonly maxEntries = 100_000) {}

  get size(): number {
    return this.seen.size;
  }

  /**
   * Records the pair. Returns `"ok"` when it is new, `"replay"` when it was already seen and
   * `"full"` when the cache cannot take more entries.
   */
  remember(
    key: string,
    nonce: string,
    expiresAtMs: number,
    nowMs = Date.now()
  ): "ok" | "replay" | "full" {
    const id = `${key}\n${nonce}`;
    const existing = this.seen.get(id);
    if (existing !== undefined && existing >= nowMs) return "replay";
    if (this.seen.size >= this.maxEntries || nowMs - this.lastPrune > 10_000) {
      this.prune(nowMs);
    }
    if (this.seen.size >= this.maxEntries) return "full";
    this.seen.set(id, expiresAtMs);
    return "ok";
  }

  prune(nowMs = Date.now()): void {
    this.lastPrune = nowMs;
    for (const [id, expiresAt] of this.seen) {
      if (expiresAt < nowMs) this.seen.delete(id);
    }
  }
}

export interface VerifyRequestOptions {
  /** Allowed clock skew in either direction (default 120 000 ms). */
  maxSkewMs?: number;
  /** When given, a `(key, nonce)` pair is accepted only once within the freshness window. */
  replayCache?: RequestReplayCache;
}

/**
 * Verify a request signature (relay protocol v2). `pathAndQuery` is the request target as
 * received (path plus `?query`). The nonce is mandatory; with a `replayCache`, each
 * `(key, nonce)` pair is accepted only once while its timestamp is fresh.
 */
export function verifyRequestSignature(
  method: string,
  pathAndQuery: string,
  timestampMsStr: string | undefined,
  nonce: string | undefined,
  signatureBase64: string | undefined,
  publicKeyBase64: string | undefined,
  bodyBytes: Uint8Array,
  options: VerifyRequestOptions = {}
): { valid: boolean; error?: string } {
  const maxSkewMs = options.maxSkewMs ?? 120_000;
  if (!timestampMsStr || !nonce || !signatureBase64 || !publicKeyBase64) {
    return { valid: false, error: "Missing authentication headers" };
  }
  if (!/^\d{1,16}$/.test(timestampMsStr)) {
    return { valid: false, error: "Invalid timestamp header" };
  }
  if (!REQUEST_NONCE_PATTERN.test(nonce)) {
    return { valid: false, error: "Invalid nonce header" };
  }
  const timestampMs = Number.parseInt(timestampMsStr, 10);
  const now = Date.now();
  if (Math.abs(now - timestampMs) > maxSkewMs) {
    return { valid: false, error: `Timestamp skew exceeded ±${Math.round(maxSkewMs / 1000)}s` };
  }

  const payload = computeRequestSignaturePayload(
    method,
    pathAndQuery,
    timestampMs,
    nonce,
    bodyBytes
  );
  const isValid = verifyEd25519(signatureBase64, payload, publicKeyBase64);
  if (!isValid) {
    return { valid: false, error: "Signature verification failed" };
  }
  // Only verified requests enter the cache, so forged requests cannot poison it.
  if (options.replayCache) {
    const outcome = options.replayCache.remember(
      publicKeyBase64,
      nonce,
      timestampMs + maxSkewMs,
      now
    );
    if (outcome === "replay") return { valid: false, error: "Replayed request nonce" };
    if (outcome === "full") return { valid: false, error: "Replay cache full, retry later" };
  }
  return { valid: true };
}

/** A fresh 256-bit out-of-band invite secret, base64url without padding (43 chars). */
export function generateInviteSecret(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** SHA-256 (lowercase hex) of the UTF-8 invite secret, as registered with the relay. */
export function hashInviteSecret(secret: string): string {
  return toHex(sha256(new TextEncoder().encode(secret)));
}

/**
 * Encrypt bytes with XChaCha20-Poly1305 (256-bit key, 24-byte nonce)
 */
export function encryptXChaCha20(
  plaintext: Uint8Array,
  key: Uint8Array
): { nonceBase64: string; ciphertextBase64: string } {
  const nonce = new Uint8Array(24);
  globalThis.crypto.getRandomValues(nonce);
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(plaintext);
  return {
    nonceBase64: bytesToBase64(nonce),
    ciphertextBase64: bytesToBase64(ciphertext),
  };
}

/**
 * Decrypt bytes with XChaCha20-Poly1305
 */
export function decryptXChaCha20(
  ciphertextBase64: string,
  nonceBase64: string,
  key: Uint8Array
): Uint8Array {
  const nonce = base64ToBytes(nonceBase64);
  const ciphertext = base64ToBytes(ciphertextBase64);
  const cipher = xchacha20poly1305(key, nonce);
  return cipher.decrypt(ciphertext);
}

/**
 * Sealed Box using X25519 + XChaCha20-Poly1305:
 * Sender generates ephemeral X25519 keypair, derives shared secret,
 * encrypts plaintext, and returns ephemeral public key + nonce + ciphertext.
 */
export function sealBox(plaintext: Uint8Array, recipientPublicKey: Uint8Array | string): string {
  const recPubKey =
    typeof recipientPublicKey === "string" ? base64ToBytes(recipientPublicKey) : recipientPublicKey;
  const ephemeralPrivate = x25519.utils.randomPrivateKey();
  const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivate, recPubKey);

  // Derive symmetric key via SHA-256(sharedSecret)
  const symKey = sha256(sharedSecret);
  const { nonceBase64, ciphertextBase64 } = encryptXChaCha20(plaintext, symKey);

  // Return formatted JSON string
  return JSON.stringify({
    ephemeralPublicKey: bytesToBase64(ephemeralPublic),
    nonce: nonceBase64,
    ciphertext: ciphertextBase64,
  });
}

/**
 * Unseal Box using recipient's X25519 private key
 */
export function unsealBox(sealedBoxJson: string, recipientPrivateKey: Uint8Array): Uint8Array {
  const parsed = JSON.parse(sealedBoxJson);
  const ephemeralPublic = base64ToBytes(parsed.ephemeralPublicKey);
  const sharedSecret = x25519.getSharedSecret(recipientPrivateKey, ephemeralPublic);
  const symKey = sha256(sharedSecret);
  return decryptXChaCha20(parsed.ciphertext, parsed.nonce, symKey);
}
