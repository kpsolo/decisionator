import { describe, expect, it, vi } from "vitest";
import { HostingStartGate } from "./hosting-gate.js";

class FakeHost {
  closedWith: string | null = null;
  revokedWith: string | null = null;
  constructor(readonly key: string) {}
  close(reason = "closed") {
    this.closedWith = reason;
  }
  revoke(reason = "revoked") {
    this.revokedWith = reason;
  }
  get live() {
    return this.closedWith === null && this.revokedWith === null;
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const closeIt = (h: FakeHost) => h.close("superseded");

describe("HostingStartGate", () => {
  it("starts hosting once when start runs twice for the same project (StrictMode, double click)", async () => {
    const gate = new HostingStartGate<FakeHost>();
    const pending = deferred<FakeHost>();
    const open = vi.fn(() => pending.promise);

    const first = gate.start("local:a", open, closeIt);
    const second = gate.start("local:a", open, closeIt);
    expect(gate.pendingKey).toBe("local:a");
    const host = new FakeHost("local:a");
    pending.resolve(host);

    expect(await first).toBe(host);
    expect(await second).toBe(host);
    expect(open).toHaveBeenCalledTimes(1);
    expect(host.live).toBe(true);
    expect(gate.pendingKey).toBeNull();
  });

  it("revoking during a pending start leaves no live host", async () => {
    const gate = new HostingStartGate<FakeHost>();
    const pending = deferred<FakeHost>();
    const result = gate.start("local:a", () => pending.promise, closeIt);

    expect(gate.cancel((h) => h.revoke("link revoked"))).toBe("local:a");
    expect(gate.pendingKey).toBeNull();
    const host = new FakeHost("local:a");
    pending.resolve(host);

    expect(await result).toBeNull();
    expect(host.revokedWith).toBe("link revoked");
    expect(host.live).toBe(false);
  });

  it("closes the host of a start superseded by another project", async () => {
    const gate = new HostingStartGate<FakeHost>();
    const a = deferred<FakeHost>();
    const b = deferred<FakeHost>();
    const first = gate.start("local:a", () => a.promise, closeIt);
    const second = gate.start("local:b", () => b.promise, closeIt);
    const hostA = new FakeHost("local:a");
    const hostB = new FakeHost("local:b");
    a.resolve(hostA);
    b.resolve(hostB);
    expect(await first).toBeNull();
    expect(await second).toBe(hostB);
    expect(hostA.closedWith).toBe("superseded");
    expect(hostB.live).toBe(true);
  });

  it("starts again after a cancelled start", async () => {
    const gate = new HostingStartGate<FakeHost>();
    const open = vi.fn(async () => new FakeHost("local:a"));
    const first = gate.start("local:a", open, closeIt);
    gate.cancel(closeIt);
    const second = gate.start("local:a", open, closeIt);
    expect(await first).toBeNull();
    expect((await second)?.live).toBe(true);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("reports failures, except for a start that was cancelled meanwhile", async () => {
    const gate = new HostingStartGate<FakeHost>();
    await expect(
      gate.start("local:a", async () => Promise.reject(new Error("locked")), closeIt)
    ).rejects.toThrow("locked");

    const pending = deferred<FakeHost>();
    const cancelled = gate.start("local:a", () => pending.promise, closeIt);
    gate.cancel(closeIt);
    pending.reject(new Error("too late"));
    expect(await cancelled).toBeNull();
  });
});
