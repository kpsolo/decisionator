import { z } from "zod";

export const InPagePeerHelloSchema = z.object({
  type: z.literal("PEER_HELLO"),
  sessionId: z.string(),
  participantId: z.string(),
  displayName: z.string(),
});
export type InPagePeerHello = z.infer<typeof InPagePeerHelloSchema>;

export const InPageHostWelcomeSchema = z.object({
  type: z.literal("HOST_WELCOME"),
  sessionId: z.string(),
  projectTitle: z.string(),
  snapshot: z.record(z.unknown()),
  role: z.enum(["contribute", "view"]),
});
export type InPageHostWelcome = z.infer<typeof InPageHostWelcomeSchema>;

export const InPagePeerAppendSchema = z.object({
  type: z.literal("PEER_APPEND"),
  sessionId: z.string(),
  participantId: z.string(),
  entries: z.array(z.record(z.unknown())),
});
export type InPagePeerAppend = z.infer<typeof InPagePeerAppendSchema>;

export const InPageHostSnapshotUpdateSchema = z.object({
  type: z.literal("HOST_SNAPSHOT_UPDATE"),
  sessionId: z.string(),
  snapshot: z.record(z.unknown()),
});
export type InPageHostSnapshotUpdate = z.infer<typeof InPageHostSnapshotUpdateSchema>;

export const InPageHostClosingSchema = z.object({
  type: z.literal("HOST_CLOSING"),
  sessionId: z.string(),
  reason: z.string(),
});
export type InPageHostClosing = z.infer<typeof InPageHostClosingSchema>;

export type InPageMessage =
  | InPagePeerHello
  | InPageHostWelcome
  | InPagePeerAppend
  | InPageHostSnapshotUpdate
  | InPageHostClosing;

export function parseInPageMessage(raw: unknown): InPageMessage {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const obj = data as { type?: string };
  switch (obj?.type) {
    case "PEER_HELLO":
      return InPagePeerHelloSchema.parse(obj);
    case "HOST_WELCOME":
      return InPageHostWelcomeSchema.parse(obj);
    case "PEER_APPEND":
      return InPagePeerAppendSchema.parse(obj);
    case "HOST_SNAPSHOT_UPDATE":
      return InPageHostSnapshotUpdateSchema.parse(obj);
    case "HOST_CLOSING":
      return InPageHostClosingSchema.parse(obj);
    default:
      throw new Error(`Unknown in-page message type: ${obj?.type}`);
  }
}
