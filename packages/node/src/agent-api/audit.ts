import type { AuditEvent } from "@decisionator/core";

/**
 * Audit event types the node records. Extends the core set with `agent_property_set`: an agent
 * set a shared option property (agentic API 1.1.0).
 */
export type AgentAuditEventType = AuditEvent["type"] | "agent_property_set";
export type AgentAuditEvent = Omit<AuditEvent, "type"> & { type: AgentAuditEventType };

export class AuditLog {
  private events: AgentAuditEvent[] = [];

  record(type: AgentAuditEventType, details: Record<string, unknown>): AgentAuditEvent {
    const event: AgentAuditEvent = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      at: new Date().toISOString(),
      type,
      details,
    };
    this.events.push(event);
    return event;
  }

  getEvents(): AgentAuditEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}
