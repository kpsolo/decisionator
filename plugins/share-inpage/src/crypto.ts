import { gcm } from "@noble/ciphers/aes";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

// Pure-JS primitives on purpose: guests may open the join link over plain http on a LAN
// address, where `crypto.subtle` does not exist. `getRandomValues` is available everywhere.

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** A random URL-safe id with `bytes` of entropy. */
export function randomId(bytes = 16): string {
  return toBase64Url(randomBytes(bytes));
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

/** Credentials that make up a join link. Both parts travel only in the URL fragment. */
export interface SessionCredentials {
  /** Public-ish session id, shown in the UI. */
  sessionId: string;
  /** 128-bit secret; whoever holds it can join and read the signaling traffic. */
  secret: string;
}

export function createSessionCredentials(): SessionCredentials {
  return { sessionId: randomId(9), secret: randomId(16) };
}

export interface SessionKeys {
  /** Topic the signaling messages are published under; reveals neither id nor secret. */
  topic: string;
  /** AES-256-GCM key for signaling envelopes. */
  signalKey: Uint8Array;
}

export function deriveSessionKeys(creds: SessionCredentials): SessionKeys {
  const ikm = utf8ToBytes(`${creds.sessionId}\0${creds.secret}`);
  const okm = hkdf(sha256, ikm, utf8ToBytes("deci-live/2"), utf8ToBytes("signal+topic"), 64);
  return { signalKey: okm.slice(0, 32), topic: bytesToHex(okm.slice(32, 64)) };
}

/** Encrypts `plaintext` as base64url(nonce ‖ ciphertext), bound to `topic`. */
export function seal(key: Uint8Array, topic: string, plaintext: string): string {
  const nonce = randomBytes(12);
  const ct = gcm(key, nonce, utf8ToBytes(topic)).encrypt(utf8ToBytes(plaintext));
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce, 0);
  out.set(ct, nonce.length);
  return toBase64Url(out);
}

/** Inverse of {@link seal}; returns null for anything that does not authenticate. */
export function unseal(key: Uint8Array, topic: string, sealed: string): string | null {
  try {
    const bytes = fromBase64Url(sealed);
    if (bytes.length < 12 + 16) return null;
    const pt = gcm(key, bytes.slice(0, 12), utf8ToBytes(topic)).decrypt(bytes.slice(12));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

/**
 * The key a guest presents to a session. It is derived from a device-wide secret and the session
 * id, so a guest keeps one identity per session (rejoining does not create a second voter) while
 * different hosts cannot correlate the same device.
 */
export function guestSessionKey(deviceSecret: string, sessionId: string): string {
  return sha256Hex(`deci-live/participant\0${deviceSecret}\0${sessionId}`);
}

/**
 * The participant id entries are attributed to. Only the holder of the session key can produce it,
 * so one guest cannot vote as another even though ids are visible in snapshots.
 */
export function participantIdFromKey(sessionKey: string): string {
  return `peer:${sha256Hex(`deci-live/pid\0${sessionKey}`).slice(0, 24)}`;
}
