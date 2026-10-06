import { describe, expect, it } from "vitest";
import { parseInPageMessage } from "../src/protocol.js";

describe("In-Page Sharing Protocol Message Validation", () => {
  it("validates PEER_HELLO message", () => {
    const msg = {
      type: "PEER_HELLO",
      sessionId: "sess_123",
      participantId: "bob@example.com",
      displayName: "Bob",
    };
    const parsed = parseInPageMessage(msg);
    expect(parsed.type).toBe("PEER_HELLO");
  });

  it("validates HOST_WELCOME message", () => {
    const msg = {
      type: "HOST_WELCOME",
      sessionId: "sess_123",
      projectTitle: "Dinner Decision",
      snapshot: { project: { title: "Dinner" } },
      role: "contribute",
    };
    const parsed = parseInPageMessage(msg);
    expect(parsed.type).toBe("HOST_WELCOME");
  });

  it("throws on invalid message", () => {
    expect(() => parseInPageMessage({ type: "UNKNOWN" })).toThrow();
  });
});
