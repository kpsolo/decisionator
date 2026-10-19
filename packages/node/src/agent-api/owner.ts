import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Shortest owner token accepted from configuration (a generated one has 64 hex characters). */
export const OWNER_TOKEN_MIN_LENGTH = 32;

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

/**
 * The project owner's credential for the host bridge (agentic API 1.3.0): the owner's tab uses it
 * to push the live-session summary and to read and decide moderation proposals. It is separate
 * from agent grant tokens, so no agent can act as the owner (Constitution IV: agents propose,
 * the owner decides).
 *
 * Configure it at server start (`ownerToken`, e.g. from `DECISIONATOR_OWNER_TOKEN`) or let the
 * server generate one and hand it to the owner's app.
 */
export class OwnerAuth {
  readonly token: string;
  private readonly hash: Buffer;

  constructor(token?: string) {
    if (token !== undefined && token.length < OWNER_TOKEN_MIN_LENGTH) {
      throw new Error(`The owner token must be at least ${OWNER_TOKEN_MIN_LENGTH} characters`);
    }
    this.token = token ?? randomBytes(32).toString("hex");
    this.hash = digest(this.token);
  }

  /** Whether `token` is the owner token (constant-time comparison). */
  verify(token: string): boolean {
    return token.length > 0 && timingSafeEqual(digest(token), this.hash);
  }
}
