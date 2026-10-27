import { z } from "zod";
import type { RelayPayload } from "./nostr.js";

/** Session protocol version spoken over the data channel (contract live-share v3). */
export const PROTOCOL_VERSION = 3;

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
  z.object({
    kind: z.literal("property"),
    optionId: z.string().min(1).max(200),
    /** Id of the plugin that declares the property. */
    plugin: z.string().min(1).max(200),
    key: z.string().min(1).max(40),
    /** Guests may only set `person` values; `shared` parses so the host can refuse it clearly. */
    scope: z.union([z.literal("shared"), z.literal("person")]),
    /** `null` clears the value; the host caps its size (PROPERTY_VALUE_MAX_BYTES). */
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  }),
  z.object({
    kind: z.literal("reset"),
    /**
     * Guests may only clear their own values of one property: `scope: "participant"`,
     * `targets: ["properties"]`, `plugin` and `key`. The host sets `participantId` to the guest;
     * anything else parses so the host can refuse it clearly.
     */
    scope: z.union([z.literal("all"), z.literal("participant")]),
    targets: z
      .array(z.enum(["grades", "ballots", "properties"]))
      .min(1)
      .max(3),
    plugin: z.string().min(1).max(200).optional(),
    key: z.string().min(1).max(40).optional(),
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

const Snapshot = z.record(z.string(), z.unknown());

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
  role: LiveRoleSchema.optional(),
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
export const ClosingCodeSchema = z.enum(["session_revoked", "ended", "host_closed"]);
export type ClosingCode = z.infer<typeof ClosingCodeSchema>;
const Closing = z.object({
  t: z.literal("closing"),
  reason: z.string(),
  code: ClosingCodeSchema.optional(),
});
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

// ── Relay records (NIP-78, contract session-restore §1) ─────────────────────────────────────
// Sealed with the session key and signed by the host, but still checked for shape: whoever holds
// the relay secret, or a buggy host, must not be able to hand guests something that is not a
// project snapshot.

const RecordList = z.array(z.record(z.string(), z.unknown()));

/** The structural minimum of a redacted ProjectSnapshot that a guest renders. */
export const RelaySnapshotSchema = z
  .object({
    project: z.object({ title: z.string().max(1_000) }).passthrough(),
    options: z.array(z.object({ id: z.string().min(1), title: z.string() }).passthrough()),
    grades: RecordList,
    comments: RecordList,
    rankings: RecordList,
    outcomes: RecordList,
    contributions: RecordList,
    properties: RecordList.optional(),
  })
  .passthrough();

export const RelayPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    v: z.literal(1),
    type: z.literal("snapshot"),
    rev: z.number().int().nonnegative(),
    publishedAt: z.number(),
    snapshot: RelaySnapshotSchema,
  }),
  z.object({
    v: z.literal(1),
    type: z.literal("tombstone"),
    publishedAt: z.number(),
    reason: z.enum(["revoked", "ended"]),
  }),
]);

/** Validates an unsealed relay record; null when it is not a well-formed {@link RelayPayload}. */
export function parseRelayPayload(raw: unknown): RelayPayload | null {
  let value: unknown;
  try {
    value = parseJson(raw);
  } catch {
    return null;
  }
  const parsed = RelayPayloadSchema.safeParse(value);
  return parsed.success ? (parsed.data as RelayPayload) : null;
}

function parseJson(raw: unknown): unknown {
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

export function parseGuestMessage(raw: unknown): GuestMessage {
  return GuestMessageSchema.parse(parseJson(raw));
}

export function parseHostMessage(raw: unknown): HostMessage {
  return HostMessageSchema.parse(parseJson(raw));
}
