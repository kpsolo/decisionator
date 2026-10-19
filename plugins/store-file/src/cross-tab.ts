/**
 * Coordination between store instances that share one IndexedDB database, e.g. two browser tabs
 * of the same project. A read-modify-write of a project document runs under a lock named after
 * the project, and a committed change is announced so that the other tabs can refresh.
 */

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

interface ChannelLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
  /** Node.js only: lets the process exit while the channel is open. */
  unref?: () => void;
}

/** Lock and channel name of one project; shared by every store instance and tab. */
export function projectLockName(projectId: string): string {
  return `decisionator:project:${projectId}`;
}

function lockManager(): LockManagerLike | undefined {
  const nav = (globalThis as { navigator?: { locks?: Partial<LockManagerLike> } }).navigator;
  const locks = nav?.locks;
  return locks && typeof locks.request === "function" ? (locks as LockManagerLike) : undefined;
}

/**
 * Tails of the fallback lock chains, by lock name. Module-wide rather than per instance, so that
 * every store instance of this realm takes part when the Web Locks API is missing.
 */
const fallbackChains = new Map<string, Promise<void>>();

/**
 * Runs `fn` while holding the project's lock: a Web Lock when the browser has them (shared by
 * every tab of the origin), otherwise a promise chain shared by the instances of this realm.
 * `fn` must not take the same lock again.
 */
export function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const name = projectLockName(projectId);
  const locks = lockManager();
  if (locks) return locks.request(name, () => fn());

  const previous = fallbackChains.get(name) ?? Promise.resolve();
  const run = previous.then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  fallbackChains.set(name, tail);
  void tail.then(() => {
    if (fallbackChains.get(name) === tail) fallbackChains.delete(name);
  });
  return run;
}

function openChannel(projectId: string): ChannelLike | undefined {
  const Channel = (globalThis as { BroadcastChannel?: new (name: string) => ChannelLike })
    .BroadcastChannel;
  if (typeof Channel !== "function") return undefined;
  try {
    const channel = new Channel(projectLockName(projectId));
    channel.unref?.();
    return channel;
  } catch {
    return undefined;
  }
}

interface ChangeMessage {
  type: "changed";
  projectId: string;
  sender: string;
}

function isChangeMessage(data: unknown, projectId: string): data is ChangeMessage {
  const m = data as Partial<ChangeMessage> | null;
  return m?.type === "changed" && m.projectId === projectId && typeof m.sender === "string";
}

/** Tells the other instances (and tabs) that `projectId` changed. `sender` names this instance. */
export function announceChange(projectId: string, sender: string): void {
  const channel = openChannel(projectId);
  if (!channel) return;
  try {
    channel.postMessage({ type: "changed", projectId, sender } satisfies ChangeMessage);
  } catch {
    // Announcing is best effort; the other tabs still see the change on their next read.
  } finally {
    channel.close();
  }
}

/**
 * Calls `onChange` whenever another instance announces a change of `projectId`. Returns the
 * function that stops listening.
 */
export function listenForChanges(
  projectId: string,
  sender: string,
  onChange: () => void
): () => void {
  const channel = openChannel(projectId);
  if (!channel) return () => {};
  channel.onmessage = (event) => {
    if (isChangeMessage(event.data, projectId) && event.data.sender !== sender) onChange();
  };
  return () => channel.close();
}

/** A random id for one store instance, so that it ignores its own announcements. */
export function instanceId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
}
