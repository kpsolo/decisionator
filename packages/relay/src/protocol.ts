import { z } from "zod";

export const ParticipantRoleSchema = z.enum(["owner", "contribute", "view"]);
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

export const AclMemberSchema = z.object({
  key: z.string(), // Ed25519 public key base64
  encKey: z.string(), // X25519 public key base64
  role: ParticipantRoleSchema,
});
export type AclMember = z.infer<typeof AclMemberSchema>;

export const SignedAclSchema = z.object({
  docId: z.string(),
  version: z.number().int().nonnegative(),
  keyEpoch: z.number().int().nonnegative(),
  members: z.array(AclMemberSchema),
  ownerSignature: z.string(), // Ed25519 over canonical JSON of { docId, version, keyEpoch, members }
});
export type SignedAcl = z.infer<typeof SignedAclSchema>;

export const ChangeBatchSchema = z.object({
  keyEpoch: z.number().int().nonnegative(),
  nonce: z.string(), // 24-byte XChaCha20 nonce base64
  ciphertext: z.string(), // XChaCha20-Poly1305 ciphertext base64
  signerKey: z.string(), // Ed25519 public key base64
  signature: z.string(), // Ed25519 over (docId || keyEpoch || nonce || ciphertext)
});
export type ChangeBatch = z.infer<typeof ChangeBatchSchema>;

export const StoredChangeBatchSchema = ChangeBatchSchema.extend({
  seq: z.number().int().positive(),
  receivedAt: z.string(),
});
export type StoredChangeBatch = z.infer<typeof StoredChangeBatchSchema>;

export const CreateInviteSchema = z.object({
  role: z.enum(["contribute", "view"]),
  expiresAt: z.string(),
  // SHA-256 (lowercase hex) of the out-of-band invite secret that travels in the invite link
  // fragment (`hashInviteSecret` in @decisionator/core). Only its holder can accept the invite.
  secretHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type CreateInvite = z.infer<typeof CreateInviteSchema>;

export const AcceptInviteSchema = z.object({
  key: z.string(), // Ed25519 public key base64; must be the request signer
  encKey: z.string(), // X25519 public key base64
  secret: z.string().min(16).max(256), // the out-of-band invite secret
});
export type AcceptInvite = z.infer<typeof AcceptInviteSchema>;

export const PostInviteKeySchema = z.object({
  sealedKey: z.string(), // JSON string representing sealedBox
});
export type PostInviteKey = z.infer<typeof PostInviteKeySchema>;

/** First message on `WS /v1/docs/{docId}/live`; signed like an HTTP request (method "WS"). */
export const LiveSubscribeSchema = z.object({
  type: z.literal("subscribe"),
  key: z.string(),
  timestamp: z.union([z.string(), z.number()]),
  nonce: z.string(),
  signature: z.string(),
});
export type LiveSubscribe = z.infer<typeof LiveSubscribeSchema>;

/** Canonical body signed by a live subscribe message for `docId`. */
export function liveSubscribeBody(docId: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ type: "subscribe", docId }));
}

/** Canonical body signed by a tunnel hello message. */
export function tunnelHelloBody(): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ type: "hello" }));
}
