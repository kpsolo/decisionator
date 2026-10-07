import { createHash, randomBytes } from "node:crypto";
import type { AgentPermission, AgentRequestStatus, TargetRef } from "@decisionator/core";
import type { AgentAuditEventType, AuditLog } from "./audit.js";

export interface StoredGrant {
  id: string; // request ID
  projectId: string;
  tokenHash: string;
  instruction: string;
  target: TargetRef;
  permissions: AgentPermission[];
  createdAt: string;
  expiresAt: string;
  status: AgentRequestStatus;
  summary?: string;
  agentName?: string;
  contributionsCount: number;
  callsWindowStart: number;
  callsInWindow: number;
}

export interface CreateGrantOptions {
  projectId: string;
  instruction: string;
  target: TargetRef;
  permissions: AgentPermission[];
  lifetimeHours?: number; // default 24, max 30 days (720 hours)
}

export type HttpStatus = 200 | 201 | 400 | 401 | 403 | 404 | 409 | 413 | 429;

export interface GrantVerificationResult {
  valid: boolean;
  status: HttpStatus;
  code: string;
  message: string;
  grant?: StoredGrant;
}

export class GrantManager {
  private grants = new Map<string, StoredGrant>(); // id -> grant
  private tokenHashToId = new Map<string, string>(); // tokenHash -> id

  constructor(private auditLog?: AuditLog) {}

  static hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  createGrant(options: CreateGrantOptions): { grant: StoredGrant; token: string } {
    // Generate 256-bit bearer token (32 random bytes hex)
    const token = randomBytes(32).toString("hex");
    const tokenHash = GrantManager.hashToken(token);

    const now = new Date();
    const lifetimeHours = Math.min(Math.max(options.lifetimeHours ?? 24, 1), 24 * 30);
    const expiresAt = new Date(now.getTime() + lifetimeHours * 3600 * 1000).toISOString();

    const id = `req_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const grant: StoredGrant = {
      id,
      projectId: options.projectId,
      tokenHash,
      instruction: options.instruction,
      target: options.target,
      permissions: [...options.permissions],
      createdAt: now.toISOString(),
      expiresAt,
      status: "open",
      contributionsCount: 0,
      callsWindowStart: Date.now(),
      callsInWindow: 0,
    };

    this.grants.set(id, grant);
    this.tokenHashToId.set(tokenHash, id);

    return { grant, token };
  }

  getGrant(id: string): StoredGrant | undefined {
    return this.grants.get(id);
  }

  resolveGrantByToken(token: string): StoredGrant | undefined {
    const hash = GrantManager.hashToken(token);
    const id = this.tokenHashToId.get(hash);
    if (!id) return undefined;
    return this.grants.get(id);
  }

  revokeGrant(id: string): boolean {
    const grant = this.grants.get(id);
    if (!grant) return false;
    grant.status = "revoked";
    this.auditLog?.record("agent_grant_revoked", {
      grantId: id,
      projectId: grant.projectId,
    });
    return true;
  }

  completeRequest(id: string, summary?: string): boolean {
    const grant = this.grants.get(id);
    if (!grant) return false;
    grant.status = "completed";
    if (summary) grant.summary = summary;
    this.auditLog?.record("agent_request_completed", {
      grantId: id,
      projectId: grant.projectId,
      summary,
    });
    return true;
  }

  /** Appends an event to the audit log this manager was created with, if any. */
  recordAudit(type: AgentAuditEventType, details: Record<string, unknown>): void {
    this.auditLog?.record(type, details);
  }

  setAgentName(grantId: string, name: string): void {
    const grant = this.grants.get(grantId);
    if (grant) {
      grant.agentName = name;
    }
  }

  incrementContributionCount(grantId: string): void {
    const grant = this.grants.get(grantId);
    if (grant) {
      grant.contributionsCount += 1;
    }
  }

  verifyAccess(
    token: string,
    requiredPermission: AgentPermission | null,
    target?: TargetRef
  ): GrantVerificationResult {
    const grant = this.resolveGrantByToken(token);
    if (!grant) {
      return {
        valid: false,
        status: 401,
        code: "UNAUTHORIZED",
        message: "Invalid or missing grant token",
      };
    }

    const now = Date.now();
    const expiryTime = new Date(grant.expiresAt).getTime();

    // 1. Check expiration
    if (now > expiryTime) {
      grant.status = "expired";
      return {
        valid: false,
        status: 401,
        code: "EXPIRED",
        message: "Grant has expired",
        grant,
      };
    }

    // 2. Check revoked status
    if (grant.status === "revoked") {
      return {
        valid: false,
        status: 401,
        code: "REVOKED",
        message: "Grant has been revoked",
        grant,
      };
    }

    // 3. Check completed status (if trying to write)
    if (
      grant.status === "completed" &&
      requiredPermission !== null &&
      requiredPermission !== "read"
    ) {
      return {
        valid: false,
        status: 409,
        code: "REQUEST_COMPLETED",
        message: "Request is marked as completed; no further modifications allowed",
        grant,
      };
    }

    // 4. Rate limit check (<= 60 calls per minute)
    if (now - grant.callsWindowStart > 60_000) {
      grant.callsWindowStart = now;
      grant.callsInWindow = 1;
    } else {
      grant.callsInWindow += 1;
      if (grant.callsInWindow > 60) {
        this.auditLog?.record("agent_refused_limit", {
          grantId: grant.id,
          limit: "calls_per_minute",
          callsInWindow: grant.callsInWindow,
        });
        return {
          valid: false,
          status: 429,
          code: "RATE_LIMITED",
          message: "Rate limit exceeded (maximum 60 calls per minute)",
          grant,
        };
      }
    }

    // 5. Permission check
    if (requiredPermission && !grant.permissions.includes(requiredPermission)) {
      this.auditLog?.record("agent_refused_permission", {
        grantId: grant.id,
        requiredPermission,
        grantedPermissions: grant.permissions,
      });
      return {
        valid: false,
        status: 403,
        code: "NOT_PERMITTED_FOR_AGENTS",
        message: `Operation requires '${requiredPermission}' permission which is not granted`,
        grant,
      };
    }

    // 6. Target scope check
    if (target) {
      if (!this.isTargetInScope(grant.target, target)) {
        this.auditLog?.record("agent_refused_scope", {
          grantId: grant.id,
          grantScope: grant.target,
          requestedTarget: target,
        });
        return {
          valid: false,
          status: 403,
          code: "OUT_OF_SCOPE",
          message: "Target is outside the granted scope",
          grant,
        };
      }
    }

    return {
      valid: true,
      status: 200,
      code: "OK",
      message: "Access granted",
      grant,
    };
  }

  isTargetInScope(grantScope: TargetRef, target: TargetRef): boolean {
    if (grantScope.kind === "project") {
      // Project scope allows the project itself, options in the project, or ideas in the project
      return true;
    }
    if (grantScope.kind === "option") {
      return target.kind === "option" && target.optionId === grantScope.optionId;
    }
    if (grantScope.kind === "idea") {
      return target.kind === "idea" && target.ideaId === grantScope.ideaId;
    }
    return false;
  }
}
