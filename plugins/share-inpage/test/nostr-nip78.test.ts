import { describe, expect, it } from "vitest";
import { deriveHostKeyPair, deriveSessionKeys, seal, unseal } from "../src/crypto.js";
import { NIP78_SNAPSHOT_KIND, type NostrEvent, signEvent, verifyEvent } from "../src/nostr.js";

describe("NIP-78 host-signed replaceable snapshots", () => {
  const sessionId = "test-session-123";
  const secret = "secret-abc-def-123456";
  const relaySecret = "host-relay-secret-top-secret-789";

  const sessionKeys = deriveSessionKeys({ sessionId, secret });
  const hostKeys = deriveHostKeyPair(relaySecret, sessionId);

  it("signs and verifies NIP-78 events with host Schnorr key", () => {
    const template = {
      kind: NIP78_SNAPSHOT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", sessionKeys.topic],
        ["t", sessionKeys.topic],
      ],
      content: "sealed-content-test",
    };

    const event = signEvent(hostKeys.secretKey, template);

    expect(event.pubkey).toBe(hostKeys.hostKey);
    expect(event.kind).toBe(30078);
    expect(verifyEvent(event)).toBe(true);
  });

  it("rejects forged events signed by a different key or tampered content", () => {
    const attackerRelaySecret = "attacker-secret-xyz-456";
    const attackerKeys = deriveHostKeyPair(attackerRelaySecret, sessionId);

    const template = {
      kind: NIP78_SNAPSHOT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", sessionKeys.topic],
        ["t", sessionKeys.topic],
      ],
      content: "forged-content",
    };

    const attackerEvent = signEvent(attackerKeys.secretKey, template);

    // Attacker's event is internally valid for attacker's pubkey...
    expect(verifyEvent(attackerEvent)).toBe(true);
    // ...but does not match the pinned hostKey!
    expect(attackerEvent.pubkey).not.toBe(hostKeys.hostKey);

    // Tampered content with host's signature fails verifyEvent
    const validEvent = signEvent(hostKeys.secretKey, template);
    const tamperedEvent: NostrEvent = { ...validEvent, content: "tampered-content" };
    expect(verifyEvent(tamperedEvent)).toBe(false);
  });

  it("seals snapshot payload and unseals after signature verification", () => {
    const payload = {
      v: 1 as const,
      type: "snapshot" as const,
      rev: 5,
      publishedAt: Date.now(),
      snapshot: {
        project: { title: "Deliberation", description: "", protected: false, formatVersion: 2 },
        options: [],
        grades: [],
        comments: [],
        rankings: [],
        outcomes: [],
        contributions: [],
        properties: [],
        role: "guest" as const,
      },
    };

    const sealed = seal(sessionKeys.signalKey, sessionKeys.topic, JSON.stringify(payload));
    const event = signEvent(hostKeys.secretKey, {
      kind: NIP78_SNAPSHOT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", sessionKeys.topic],
        ["t", sessionKeys.topic],
      ],
      content: sealed,
    });

    // Guest receives event from relay
    expect(event.pubkey).toBe(hostKeys.hostKey);
    expect(verifyEvent(event)).toBe(true);

    const unsealedJson = unseal(sessionKeys.signalKey, sessionKeys.topic, event.content);
    expect(unsealedJson).not.toBeNull();

    const recovered = JSON.parse(unsealedJson ?? "{}");
    expect(recovered).toEqual(payload);
    expect(recovered.rev).toBe(5);
  });

  it("handles tombstone events for revocation purge", () => {
    const tombstone = {
      v: 1 as const,
      type: "tombstone" as const,
      publishedAt: Date.now(),
      reason: "revoked" as const,
    };

    const sealed = seal(sessionKeys.signalKey, sessionKeys.topic, JSON.stringify(tombstone));
    const event = signEvent(hostKeys.secretKey, {
      kind: NIP78_SNAPSHOT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", sessionKeys.topic],
        ["t", sessionKeys.topic],
      ],
      content: sealed,
    });

    expect(event.pubkey).toBe(hostKeys.hostKey);
    expect(verifyEvent(event)).toBe(true);

    const unsealedJson = unseal(sessionKeys.signalKey, sessionKeys.topic, event.content);
    const recovered = JSON.parse(unsealedJson ?? "{}");
    expect(recovered.type).toBe("tombstone");
    expect(recovered.reason).toBe("revoked");
  });
});
