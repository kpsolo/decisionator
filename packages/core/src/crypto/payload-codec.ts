const VERIFIER_CONSTANT = "decisionator:verifier:v1";

/** Ciphertext written before context binding: AES-256-GCM without additional data. Read only. */
export const SEALED_PREFIX_V1 = "enc:v1:";
/** Current ciphertext: AES-256-GCM with additional data derived from the seal context. */
export const SEALED_PREFIX_V2 = "enc:v2:";

/** Bounds for PBKDF2 iteration counts read from stored (untrusted) project data. */
export const KDF_MIN_ITERATIONS = 100_000;
export const KDF_MAX_ITERATIONS = 5_000_000;
/** Iterations used for every new password. */
export const KDF_DEFAULT_ITERATIONS = 600_000;

/** Shortest project password accepted when a password is set. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Where a sealed value lives, e.g. `["option", optionId, "title"]`. It is bound to the ciphertext
 * as AES-GCM additional data, so a value copied to another record or field no longer decrypts.
 * It is not stored: the reader rebuilds it from where it found the value.
 */
export type SealContext = readonly (string | number)[];

const AAD_LABEL = "decisionator/aad/v2";

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

/** The additional data for a context: an unambiguous (JSON array) encoding with a label. */
function additionalData(context: SealContext): Uint8Array {
  return new TextEncoder().encode(JSON.stringify([AAD_LABEL, ...context]));
}

/** True for a value written by `encrypt` (any codec version). */
export function isSealed(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value.startsWith(SEALED_PREFIX_V2) || value.startsWith(SEALED_PREFIX_V1))
  );
}

/**
 * Checks a PBKDF2 iteration count read from a stored project (a file, a sheet, a document other
 * people can write) and returns it as a number. Counts outside
 * [`KDF_MIN_ITERATIONS`, `KDF_MAX_ITERATIONS`] are refused: a tiny count weakens the key, a huge
 * one locks the browser up.
 */
export function checkKdfIterations(value: unknown): number {
  const n = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (
    typeof n !== "number" ||
    !Number.isInteger(n) ||
    n < KDF_MIN_ITERATIONS ||
    n > KDF_MAX_ITERATIONS
  ) {
    throw new Error(
      `INVALID_KDF: iteration count must be an integer between ${KDF_MIN_ITERATIONS} and ${KDF_MAX_ITERATIONS}`
    );
  }
  return n;
}

/**
 * Refuses a project password shorter than `MIN_PASSWORD_LENGTH` characters. Every store calls it
 * wherever a password is set (not when one is entered to unlock).
 */
export function assertPasswordStrength(password: string): void {
  if (typeof password !== "string" || [...password].length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }
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
 * The raw key is never serialized or exposed. Iteration counts read from stored data must go
 * through `checkKdfIterations` first.
 */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations = KDF_DEFAULT_ITERATIONS
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
 * Encrypt a plaintext string using AES-256-GCM, bound to `context` (additional data).
 * Generates a fresh 12-byte IV per invocation.
 * Output format: enc:v2:<base64 iv>:<base64 ciphertext>
 */
export async function encrypt(
  plaintext: string,
  key: CryptoKey,
  context: SealContext = []
): Promise<string> {
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);

  const encoded = new TextEncoder().encode(plaintext);

  const ciphertextBuffer = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: additionalData(context) as BufferSource,
    },
    key,
    encoded
  );

  return `${SEALED_PREFIX_V2}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertextBuffer))}`;
}

/**
 * Decrypt a value written by `encrypt`. A v2 value only decrypts with the `context` it was
 * written with. A legacy v1 value (no additional data) is still read, whatever the context.
 */
export async function decrypt(
  encrypted: string,
  key: CryptoKey,
  context: SealContext = []
): Promise<string> {
  const parts = encrypted.split(":");
  const version = parts[1];
  if (parts.length !== 4 || parts[0] !== "enc" || (version !== "v1" && version !== "v2")) {
    throw new Error("Invalid encrypted payload format: expected enc:v2:... or enc:v1:...");
  }

  const ivPart = parts[2];
  const cipherPart = parts[3];
  if (!ivPart || !cipherPart) {
    throw new Error("Invalid encrypted payload parts");
  }

  const iv = base64ToBytes(ivPart);
  const ciphertext = base64ToBytes(cipherPart);

  const params: AesGcmParams =
    version === "v2"
      ? {
          name: "AES-GCM",
          iv: iv as BufferSource,
          additionalData: additionalData(context) as BufferSource,
        }
      : { name: "AES-GCM", iv: iv as BufferSource };
  const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
    params,
    key,
    ciphertext as BufferSource
  );

  return new TextDecoder().decode(decryptedBuffer);
}

const VERIFIER_CONTEXT: SealContext = ["verifier"];

/**
 * Creates an encrypted verifier string to test password correctness.
 */
export async function makeVerifier(key: CryptoKey): Promise<string> {
  return encrypt(VERIFIER_CONSTANT, key, VERIFIER_CONTEXT);
}

/**
 * Checks if the key successfully decrypts the verifier (v2, or a legacy v1 verifier).
 */
export async function checkVerifier(verifier: string, key: CryptoKey): Promise<boolean> {
  try {
    const decrypted = await decrypt(verifier, key, VERIFIER_CONTEXT);
    return decrypted === VERIFIER_CONSTANT;
  } catch {
    return false;
  }
}
