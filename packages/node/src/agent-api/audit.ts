import type { AuditEvent } from "@decisionator/core";

export class AuditLog {
  private events: AuditEvent[] = [];

  record(type: AuditEvent["type"], details: Record<string, unknown>): AuditEvent {
    const event: AuditEvent = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      at: new Date().toISOString(),
      type,
      details,
    };
    this.events.push(event);
    return event;
  }

  getEvents(): AuditEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}
