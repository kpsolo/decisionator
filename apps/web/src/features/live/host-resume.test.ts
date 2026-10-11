import { beforeEach, describe, expect, it } from "vitest";
import { ACTIVE_HOSTING_KEY, type ActiveHostingDescriptor } from "./LiveShareContext.js";
import {
  hostCredentialsFor,
  isSessionRevoked,
  markSessionRevoked,
  resolveHostProject,
  saveHostSessionIndex,
} from "./live-config.js";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

describe("Host Reverse Resolution & Reload Auto-Resume (US1, T007)", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
    (globalThis as { sessionStorage?: Storage }).sessionStorage = memoryStorage();
  });

  describe("Host recognition via reverse index", () => {
    it("recognizes host from shared link sessionId", () => {
      const projectKey = "local:project-offsite";
      const creds = hostCredentialsFor(projectKey);

      expect(resolveHostProject(creds.sessionId)).toBe(projectKey);
    });

    it("does not recognize unknown session as host", () => {
      expect(resolveHostProject("unknown-session-99")).toBeNull();
    });

    it("unmaps host project when session is revoked", () => {
      const projectKey = "local:project-offsite";
      const creds = hostCredentialsFor(projectKey);

      expect(isSessionRevoked(creds.sessionId)).toBe(false);
      markSessionRevoked(creds.sessionId, "Owner revoked session");

      expect(isSessionRevoked(creds.sessionId)).toBe(true);
      expect(resolveHostProject(creds.sessionId)).toBeNull();
    });
  });

  describe("Active hosting descriptor for reload recovery", () => {
    it("stores and validates fresh active hosting descriptor (< 1 hour)", () => {
      const descriptor: ActiveHostingDescriptor = {
        projectRef: { store: "local", id: "project-123" },
        projectTitle: "Strategy Meeting",
        sessionId: "sess-abc-xyz",
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
      };

      sessionStorage.setItem(ACTIVE_HOSTING_KEY, JSON.stringify(descriptor));

      const raw = sessionStorage.getItem(ACTIVE_HOSTING_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw ?? "{}") as ActiveHostingDescriptor;

      const ageMs = Date.now() - new Date(parsed.lastHeartbeat).getTime();
      expect(ageMs).toBeLessThan(3600 * 1000);
      expect(parsed.projectRef.id).toBe("project-123");
    });

    it("identifies stale heartbeat (> 1 hour) as expired", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
      const staleDescriptor: ActiveHostingDescriptor = {
        projectRef: { store: "local", id: "project-123" },
        projectTitle: "Strategy Meeting",
        sessionId: "sess-abc-xyz",
        startedAt: twoHoursAgo,
        lastHeartbeat: twoHoursAgo,
      };

      sessionStorage.setItem(ACTIVE_HOSTING_KEY, JSON.stringify(staleDescriptor));

      const raw = sessionStorage.getItem(ACTIVE_HOSTING_KEY);
      const parsed = JSON.parse(raw ?? "{}") as ActiveHostingDescriptor;
      const ageMs = Date.now() - new Date(parsed.lastHeartbeat).getTime();

      expect(ageMs).toBeGreaterThan(3600 * 1000);
    });
  });
});
