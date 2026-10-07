/**
 * Decides when an option has been looked at: on screen without a break for `minMs`, counting only
 * time while the page is visible (contract `option-view` 1.0.0, research R5). Pure and clock-free
 * so it can be tested with a fake clock; `useExposure` feeds it browser events.
 */
export class ExposureTracker {
  private minMs: number;
  /** Visible time already accumulated for elements currently on screen. */
  private accumulated = new Map<string, number>();
  /** When the current on-screen stretch started counting (absent while paused). */
  private since = new Map<string, number>();
  private emitted = new Set<string>();
  private pageVisible = true;

  constructor(minMs: number) {
    this.minMs = minMs;
  }

  /**
   * Reports an element's visibility. It is on screen when at least half of it is visible, or when
   * its visible part covers at least half the viewport (a card taller than the screen).
   */
  observe(
    id: string,
    ratio: number,
    visibleHeight: number,
    viewportHeight: number,
    now: number
  ): void {
    const onScreen = ratio >= 0.5 || (viewportHeight > 0 && visibleHeight >= 0.5 * viewportHeight);
    if (onScreen) {
      if (!this.accumulated.has(id)) {
        this.accumulated.set(id, 0);
        if (this.pageVisible) this.since.set(id, now);
      }
    } else {
      this.accumulated.delete(id);
      this.since.delete(id);
    }
  }

  /** Stops counting an element entirely, e.g. when it unmounts. */
  forget(id: string): void {
    this.accumulated.delete(id);
    this.since.delete(id);
  }

  /** Pauses (hidden tab, minimised window, lost focus) or resumes every running timer. */
  setPageVisible(visible: boolean, now: number): void {
    if (visible === this.pageVisible) return;
    this.pageVisible = visible;
    if (!visible) {
      for (const [id, start] of this.since) {
        this.accumulated.set(id, (this.accumulated.get(id) ?? 0) + (now - start));
      }
      this.since.clear();
    } else {
      for (const id of this.accumulated.keys()) this.since.set(id, now);
    }
  }

  setMinMs(ms: number): void {
    this.minMs = ms;
  }

  /** True while at least one element is on screen and not yet reported. */
  get pending(): boolean {
    for (const id of this.accumulated.keys()) if (!this.emitted.has(id)) return true;
    return false;
  }

  /** Ids on screen for at least `minMs` that were not reported before. Each id is reported once. */
  tick(now: number): string[] {
    const ready: string[] = [];
    for (const [id, acc] of this.accumulated) {
      if (this.emitted.has(id)) continue;
      const start = this.since.get(id);
      const total = acc + (start === undefined ? 0 : now - start);
      if (total >= this.minMs) {
        this.emitted.add(id);
        ready.push(id);
      }
    }
    return ready;
  }
}
