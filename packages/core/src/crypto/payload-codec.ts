const VERIFIER_CONSTANT = "decisionator:verifier:v1";

function bytesToBase64(bytes: Uint8Array): string {
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

function base64ToBytes(base64: string): Uint8Array {
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

/**
 * Generate a cryptographically secure 16-byte random salt.
 */
export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  return salt;
}

/**
 * Derive an AES-256-GCM CryptoKey from a password and salt using PBKDF2-HMAC-SHA-256.
 * The raw key is never serialized or exposed.
 */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations = 600_000
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return globalThis.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false, // key is non-extractable
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Generates a fresh 12-byte IV per invocation.
 * Output format: enc:v1:<base64 iv>:<base64 ciphertext>
 */
export async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);

  const encoder = new TextEncoder();
  const encoded = encoder.encode(plaintext);

  const ciphertextBuffer = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    encoded
  );

  const ivBase64 = bytesToBase64(iv);
  const cipherBase64 = bytesToBase64(new Uint8Array(ciphertextBuffer));

  return `enc:v1:${ivBase64}:${cipherBase64}`;
}

/**
 * Decrypt a string formatted as enc:v1:<base64 iv>:<base64 ciphertext>.
 */
export async function decrypt(encrypted: string, key: CryptoKey): Promise<string> {
  const parts = encrypted.split(":");
  if (parts.length !== 4 || parts[0] !== "enc" || parts[1] !== "v1") {
    throw new Error("Invalid encrypted payload format: expected enc:v1:...");
  }

  const ivPart = parts[2];
  const cipherPart = parts[3];
  if (!ivPart || !cipherPart) {
    throw new Error("Invalid encrypted payload parts");
  }

  const iv = base64ToBytes(ivPart);
  const ciphertext = base64ToBytes(cipherPart);

  const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

/**
 * Creates an encrypted verifier string to test password correctness.
 */
export async function makeVerifier(key: CryptoKey): Promise<string> {
  return encrypt(VERIFIER_CONSTANT, key);
}

/**
 * Checks if the key successfully decrypts the verifier.
 */
export async function checkVerifier(verifier: string, key: CryptoKey): Promise<boolean> {
  try {
    const decrypted = await decrypt(verifier, key);
    return decrypted === VERIFIER_CONSTANT;
  } catch {
    return false;
  }
}
