import {
  checkVerifier,
  decrypt,
  deriveKey,
  encrypt,
  generateSalt,
  makeVerifier,
} from "@decisionator/core";

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    const b = bytes[i];
    if (b !== undefined) binary += String.fromCharCode(b);
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

export async function setupPasswordProtection(password: string) {
  const saltBytes = generateSalt();
  const salt = bytesToBase64(saltBytes);
  const iterations = 600000;
  const key = await deriveKey(password, saltBytes, iterations);
  const verifier = await makeVerifier(key);
  return { salt, iterations, verifier, key };
}

export async function verifyAndDerivePasswordKey(
  password: string,
  saltB64: string,
  iterations: number,
  verifier: string
): Promise<CryptoKey> {
  const saltBytes = base64ToBytes(saltB64);
  const key = await deriveKey(password, saltBytes, iterations);
  const ok = await checkVerifier(verifier, key);
  if (!ok) {
    throw new Error("Incorrect password");
  }
  return key;
}

export { checkVerifier, encrypt, decrypt };
