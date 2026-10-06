import { z } from "zod";

/** Session protocol version spoken over the data channel (contract live-share v2). */
export const PROTOCOL_VERSION = 2;

// ── Signaling ────────────────────────────────────────────────────────────────────────────────
// Rendezvous messages, encrypted with the session key before they reach any relay.

export const SignalEnvelopeSchema = z.object({
  v: z.literal(1),
  kind: z.enum(["offer", "answer"]),
  /** Connection attempt id of the sender. */
  from: z.string().min(1).max(64),
  /** Recipient connection id (answers only). */
  to: z.string().min(1).max(64).optional(),
  /** Unique per message; receivers drop duplicates arriving over several relays. */
  nonce: z.string().min(1).max(64),
  /** Sender clock, ms since epoch; stale messages are ignored. */
  ts: z.number().int(),
  sdp: z.string().min(1).max(64_000),
});
export type SignalEnvelope = z.infer<typeof SignalEnvelopeSchema>;

// ── Guest submissions ────────────────────────────────────────────────────────────────────────

export const GuestEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("grade"),
    optionId: z.string().min(1).max(200),
    value: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  }),
  z.object({
    kind: z.literal("comment"),
    optionId: z.string().min(1).max(200),
    body: z.string().trim().min(1).max(10_000),
    /** Id of the guest's own earlier comment this one edits. */
    replaces: z.string().min(1).max(200).optional(),
  }),
  z.object({
    kind: z.literal("ranking"),
    ranking: z.array(z.string().min(1).max(200)).min(1).max(50),
    round: z.number().int().min(1),
  }),
]);
export type GuestEntry = z.infer<typeof GuestEntrySchema>;

// ── Session messages ─────────────────────────────────────────────────────────────────────────

const Hello = z.object({
  t: z.literal("hello"),
  proto: z.number().int(),
  /** Per-session participant key (see guestSessionKey); never shown to other guests. */
  key: z.string().min(32).max(128),
  name: z.string().trim().min(1).max(80),
});
const Submit = z.object({
  t: z.literal("submit"),
  id: z.string().min(1).max(64),
  entries: z.array(GuestEntrySchema).min(1).max(50),
});
const Bye = z.object({ t: z.literal("bye") });

export const GuestMessageSchema = z.discriminatedUnion("t", [Hello, Submit, Bye]);
export type GuestMessage = z.infer<typeof GuestMessageSchema>;

export const LiveRoleSchema = z.enum(["contribute", "view"]);
export type LiveRole = z.infer<typeof LiveRoleSchema>;

const Snapshot = z.record(z.unknown());

const Welcome = z.object({
  t: z.literal("welcome"),
  proto: z.number().int(),
  participantId: z.string().min(1),
  name: z.string(),
  role: LiveRoleSchema,
  rev: z.number().int(),
  snapshot: Snapshot,
});
const SnapshotUpdate = z.object({
  t: z.literal("snapshot"),
  rev: z.number().int(),
  snapshot: Snapshot,
});
export const AckErrorCodeSchema = z.enum([
  "invalid",
  "read_only",
  "voting_closed",
  "rate_limited",
  "store_failed",
]);
export type AckErrorCode = z.infer<typeof AckErrorCodeSchema>;
const Ack = z.object({
  t: z.literal("ack"),
  id: z.string(),
  ok: z.boolean(),
  code: AckErrorCodeSchema.optional(),
  message: z.string().optional(),
});
const Closing = z.object({ t: z.literal("closing"), reason: z.string() });
export const FatalErrorCodeSchema = z.enum(["protocol_mismatch", "session_full", "bad_hello"]);
const Fatal = z.object({ t: z.literal("error"), code: FatalErrorCodeSchema, message: z.string() });

export const HostMessageSchema = z.discriminatedUnion("t", [
  Welcome,
  SnapshotUpdate,
  Ack,
  Closing,
  Fatal,
]);
export type HostMessage = z.infer<typeof HostMessageSchema>;

function parseJson(raw: unknown): unknown {
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

export function parseGuestMessage(raw: unknown): GuestMessage {
  return GuestMessageSchema.parse(parseJson(raw));
}

export function parseHostMessage(raw: unknown): HostMessage {
  return HostMessageSchema.parse(parseJson(raw));
}
