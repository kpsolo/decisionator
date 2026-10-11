import { beforeEach, describe, expect, it } from "vitest";
import {
  deriveHostKeyPair,
  parseHostKeyFromLink,
} from "@decisionator/share-inpage";
import {
  clearSessionRevocation,
  getSessionRevocation,
  hostCredentialsFor,
  isSessionRevoked,
  listHostedProjectKeys,
  markSessionRevoked,
  removeHostSessionIndex,
  resolveHostProject,
  rotateHostCredentials,
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

describe("Live Configuration & Reverse Index Layer (T004, T006)", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = memoryStorage();
  });

  describe("Schnorr hostKeyPair derivation", () => {
    it("derives deterministic 64-char hex and 43-char base64url host keys", () => {
      const relaySecret = "relay-secret-123456789012345678901234567890";
      const sessionId = "sess12345678";

      const pair1 = deriveHostKeyPair(relaySecret, sessionId);
      const pair2 = deriveHostKeyPair(relaySecret, sessionId);

      expect(pair1.hostKey).toHaveLength(64);
      expect(pair1.hostKeyLink).toHaveLength(43);
      expect(pair1.hostKey).toEqual(pair2.hostKey);
      expect(pair1.hostKeyLink).toEqual(pair2.hostKeyLink);
      expect(pair1.secretKey).toEqual(pair2.secretKey);
      expect(pair1.secretKey.byteLength).toBe(32);

      // Normalization handles both formats
      expect(parseHostKeyFromLink(pair1.hostKeyLink)).toBe(pair1.hostKey);
      expect(parseHostKeyFromLink(pair1.hostKey)).toBe(pair1.hostKey);
    });

    it("produces distinct keys for distinct sessionIds or secrets", () => {
      const pairA = deriveHostKeyPair("secret-A", "sess1");
      const pairB = deriveHostKeyPair("secret-B", "sess1");
      const pairC = deriveHostKeyPair("secret-A", "sess2");

      expect(pairA.hostKey).not.toEqual(pairB.hostKey);
      expect(pairA.hostKey).not.toEqual(pairC.hostKey);
    });
  });

  describe("Host session credentials & reverse index", () => {
    it("generates and persists credentials with relaySecret and reverse lookup", () => {
      const projectKey = "local:project-alpha";
      const creds = hostCredentialsFor(projectKey);

      expect(creds.sessionId).toBeDefined();
      expect(creds.secret).toBeDefined();
      expect(creds.relaySecret).toBeDefined();
      expect(creds.createdAt).toBeDefined();
      expect(creds.hostKey).toBeDefined();

      // Reverse index was written
      expect(resolveHostProject(creds.sessionId)).toBe(projectKey);

      // Re-fetching returns the same credentials
      const second = hostCredentialsFor(projectKey);
      expect(second).toEqual(creds);
    });

    it("migrates legacy host credentials lacking relaySecret", () => {
      const projectKey = "local:legacy-project";
      const legacyRecord = {
        sessionId: "legacysess12",
        secret: "legacysecret34",
      };
      localStorage.setItem(`deci.live.host.${projectKey}`, JSON.stringify(legacyRecord));

      const creds = hostCredentialsFor(projectKey);
      expect(creds.sessionId).toBe("legacysess12");
      expect(creds.secret).toBe("legacysecret34");
      expect(creds.relaySecret).toBeDefined();
      expect(creds.hostKey).toBeDefined();
      expect(resolveHostProject("legacysess12")).toBe(projectKey);
    });

    it("rotates host credentials and updates reverse lookup", () => {
      const projectKey = "local:project-rotate";
      const first = hostCredentialsFor(projectKey);
      const rotated = rotateHostCredentials(projectKey);

      expect(rotated.sessionId).not.toBe(first.sessionId);
      expect(resolveHostProject(rotated.sessionId)).toBe(projectKey);
    });

    it("lists all hosted project keys", () => {
      hostCredentialsFor("local:p1");
      hostCredentialsFor("file:p2");

      const list = listHostedProjectKeys();
      expect(list).toContain("local:p1");
      expect(list).toContain("file:p2");
    });
  });

  describe("Revocation registry", () => {
    it("records revocation and unmaps reverse session index", () => {
      const sessionId = "sess-to-revoke";
      saveHostSessionIndex(sessionId, "local:p1");
      expect(resolveHostProject(sessionId)).toBe("local:p1");
      expect(isSessionRevoked(sessionId)).toBe(false);

      markSessionRevoked(sessionId, "Host closed live meeting");
      expect(isSessionRevoked(sessionId)).toBe(true);
      expect(resolveHostProject(sessionId)).toBeNull();

      const details = getSessionRevocation(sessionId);
      expect(details?.reason).toBe("Host closed live meeting");
      expect(details?.revokedAt).toBeDefined();

      clearSessionRevocation(sessionId);
      expect(isSessionRevoked(sessionId)).toBe(false);
    });
  });
});
