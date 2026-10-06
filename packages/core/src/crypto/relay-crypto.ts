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

/**
 * Computes canonical request signature string:
 * "METHOD\nPATH\nTIMESTAMP\nSHA256(body)"
 */
export function computeRequestSignaturePayload(
  method: string,
  path: string,
  timestampMs: number | string,
  bodyBytes: Uint8Array
): Uint8Array {
  const bodyHash = sha256(bodyBytes);
  const bodyHashHex = Array.from(bodyHash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const text = `${method.toUpperCase()}\n${path}\n${timestampMs}\n${bodyHashHex}`;
  return new TextEncoder().encode(text);
}

/**
 * Sign an HTTP or WS request using Ed25519
 */
export function signRequest(
  method: string,
  path: string,
  timestampMs: number,
  bodyBytes: Uint8Array,
  signingKey: KeyPair
): {
  "X-Dcg-Key": string;
  "X-Dcg-Timestamp": string;
  "X-Dcg-Signature": string;
} {
  const payload = computeRequestSignaturePayload(method, path, timestampMs, bodyBytes);
  const sig = signEd25519(payload, signingKey.privateKey);
  return {
    "X-Dcg-Key": signingKey.publicKeyBase64,
    "X-Dcg-Timestamp": String(timestampMs),
    "X-Dcg-Signature": sig,
  };
}

/**
 * Verify an HTTP request signature
 */
export function verifyRequestSignature(
  method: string,
  path: string,
  timestampMsStr: string | undefined,
  signatureBase64: string | undefined,
  publicKeyBase64: string | undefined,
  bodyBytes: Uint8Array,
  maxSkewMs = 120_000
): { valid: boolean; error?: string } {
  if (!timestampMsStr || !signatureBase64 || !publicKeyBase64) {
    return { valid: false, error: "Missing authentication headers" };
  }
  const timestampMs = Number.parseInt(timestampMsStr, 10);
  if (Number.isNaN(timestampMs)) {
    return { valid: false, error: "Invalid timestamp header" };
  }
  const now = Date.now();
  if (Math.abs(now - timestampMs) > maxSkewMs) {
    return { valid: false, error: "Timestamp skew exceeded ±120s" };
  }

  const payload = computeRequestSignaturePayload(method, path, timestampMs, bodyBytes);
  const isValid = verifyEd25519(signatureBase64, payload, publicKeyBase64);
  if (!isValid) {
    return { valid: false, error: "Signature verification failed" };
  }
  return { valid: true };
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
