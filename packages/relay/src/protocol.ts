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
});
export type CreateInvite = z.infer<typeof CreateInviteSchema>;

export const AcceptInviteSchema = z.object({
  key: z.string(), // Ed25519 public key base64
  encKey: z.string(), // X25519 public key base64
});
export type AcceptInvite = z.infer<typeof AcceptInviteSchema>;

export const PostInviteKeySchema = z.object({
  sealedKey: z.string(), // JSON string representing sealedBox
});
export type PostInviteKey = z.infer<typeof PostInviteKeySchema>;
