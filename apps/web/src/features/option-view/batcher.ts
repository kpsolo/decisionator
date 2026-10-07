/**
 * Groups entries and sends them at most once per `intervalMs`, up to `max` per send. Each `add`
 * resolves or rejects with the send its entries went out in. Used for live-session guests, whose
 * host rate-limits submissions (20 burst, 5/s).
 */
export function createBatcher<T>(
  send: (items: T[]) => Promise<void>,
  opts: { intervalMs?: number; max?: number; now?: () => number } = {}
) {
  const intervalMs = opts.intervalMs ?? 2000;
  const max = opts.max ?? 50;
  const now = opts.now ?? (() => Date.now());
  let queue: { item: T; resolve(): void; reject(err: unknown): void }[] = [];
  let lastSent = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    timer = null;
    const batch = queue.slice(0, max);
    queue = queue.slice(max);
    if (queue.length > 0) schedule();
    if (batch.length === 0) return;
    lastSent = now();
    try {
      await send(batch.map((b) => b.item));
      for (const b of batch) b.resolve();
    } catch (err) {
      for (const b of batch) b.reject(err);
    }
  };

  const schedule = () => {
    if (timer) return;
    const wait = Math.max(0, lastSent + intervalMs - now());
    timer = setTimeout(() => void flush(), wait);
  };

  return {
    add(items: T[]): Promise<void> {
      const done = Promise.all(
        items.map(
          (item) =>
            new Promise<void>((resolve, reject) => {
              queue.push({ item, resolve, reject });
            })
        )
      ).then(() => undefined);
      schedule();
      return done;
    },
    /** Starts the timer if anything is queued. */
    kick() {
      if (queue.length > 0) schedule();
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      for (const b of queue) b.reject(new Error("The session ended before this change was sent."));
      queue = [];
    },
  };
}
