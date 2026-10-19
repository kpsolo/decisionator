/**
 * Keeps at most one hosting start in flight for the whole app.
 *
 * Starting a host is asynchronous (the project has to load), so without this a second `start`
 * for the same project (React StrictMode re-running the auto-resume effect, a double click)
 * would open a second host, and a `stop`/`revoke` issued meanwhile would be undone when the
 * start completes. Here a start for the key already in flight joins it, and a cancelled start
 * hands its host, once it arrives, to the disposer the canceller chose (close or revoke).
 */
export class HostingStartGate<H> {
  private inFlight: InFlight<H> | null = null;

  /** Key of the start in flight, if any. */
  get pendingKey(): string | null {
    return this.inFlight?.key ?? null;
  }

  /**
   * Runs `open` for `key`, or joins the start already in flight for it. A start in flight for
   * another key is cancelled and its host goes to `disposeSuperseded`. Resolves `null` when this
   * start is cancelled before it completes (its host has then been disposed).
   */
  start(
    key: string,
    open: () => Promise<H>,
    disposeSuperseded: (host: H) => void
  ): Promise<H | null> {
    if (this.inFlight?.key === key) return this.inFlight.promise;
    this.cancel(disposeSuperseded);
    const entry: InFlight<H> = { key, dispose: null, promise: Promise.resolve(null) };
    entry.promise = (async () => {
      try {
        const host = await open();
        if (entry.dispose) {
          entry.dispose(host);
          return null;
        }
        return host;
      } catch (err) {
        if (entry.dispose) return null;
        throw err;
      } finally {
        if (this.inFlight === entry) this.inFlight = null;
      }
    })();
    this.inFlight = entry;
    return entry.promise;
  }

  /**
   * Cancels the start in flight; when its host arrives it goes to `dispose`. Returns the
   * cancelled key, or null when nothing was in flight.
   */
  cancel(dispose: (host: H) => void): string | null {
    const entry = this.inFlight;
    if (!entry) return null;
    entry.dispose = dispose;
    this.inFlight = null;
    return entry.key;
  }
}

interface InFlight<H> {
  key: string;
  promise: Promise<H | null>;
  dispose: ((host: H) => void) | null;
}
