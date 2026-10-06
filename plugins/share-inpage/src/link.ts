/**
 * A message link between host and one guest: JSON messages over a string pipe (an RTCDataChannel
 * in the browser, an in-memory pipe in tests), with chunking and a liveness heartbeat.
 *
 * Frames: `m<json>` a whole message · `c<id>,<index>,<count>|<part>` one chunk of a large message ·
 * `p` ping · `q` pong.
 */

/** The raw transport under a link. */
export interface MessagePipe {
  send(data: string): void;
  close(): void;
  onmessage: ((data: string) => void) | null;
  onclose: (() => void) | null;
}

export interface Link {
  readonly closed: boolean;
  send(message: unknown): void;
  onMessage(cb: (message: unknown) => void): void;
  onClose(cb: (reason: string) => void): void;
  close(reason?: string): void;
}

export interface LinkOptions {
  /** Largest reassembled message accepted from the other side. */
  maxMessageBytes?: number;
  /** Ping interval when the link is otherwise idle. */
  heartbeatMs?: number;
  /** Close the link after this long without hearing anything. */
  timeoutMs?: number;
}

/** Stays under the 16 KiB that every browser's SCTP stack accepts in one message. */
export const FRAME_BYTES = 16_000;

export function createLink(pipe: MessagePipe, opts: LinkOptions = {}): Link {
  const maxMessageBytes = opts.maxMessageBytes ?? 16 * 1024 * 1024;
  const heartbeatMs = opts.heartbeatMs ?? 5_000;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const messageListeners: ((m: unknown) => void)[] = [];
  const closeListeners: ((reason: string) => void)[] = [];
  const partial = new Map<string, { parts: string[]; received: number; size: number }>();
  let closed = false;
  let lastHeard = Date.now();
  let nextChunkId = 0;

  const rawSend = (frame: string) => {
    if (closed) return;
    try {
      pipe.send(frame);
    } catch {
      shutdown("send failed");
    }
  };

  const timer = setInterval(() => {
    if (Date.now() - lastHeard > timeoutMs) {
      shutdown("timed out");
      return;
    }
    rawSend("p");
  }, heartbeatMs);

  function shutdown(reason: string, closePipe = true) {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    partial.clear();
    if (closePipe) {
      try {
        pipe.close();
      } catch {
        // already gone
      }
    }
    for (const cb of closeListeners) cb(reason);
  }

  function deliver(json: string) {
    let message: unknown;
    try {
      message = JSON.parse(json);
    } catch {
      return;
    }
    for (const cb of messageListeners) cb(message);
  }

  pipe.onmessage = (data) => {
    if (closed || typeof data !== "string" || data.length === 0) return;
    lastHeard = Date.now();
    const kind = data[0];
    if (kind === "p") {
      rawSend("q");
    } else if (kind === "m") {
      if (data.length - 1 <= maxMessageBytes) deliver(data.slice(1));
    } else if (kind === "c") {
      const bar = data.indexOf("|");
      const [id, indexText, countText] = data.slice(1, bar).split(",");
      const index = Number(indexText);
      const count = Number(countText);
      if (!id || !Number.isInteger(index) || !Number.isInteger(count) || index >= count) return;
      let entry = partial.get(id);
      if (!entry) {
        if (count * FRAME_BYTES > maxMessageBytes + FRAME_BYTES || partial.size > 8) {
          shutdown("message too large");
          return;
        }
        entry = { parts: new Array(count), received: 0, size: 0 };
        partial.set(id, entry);
      }
      const part = data.slice(bar + 1);
      if (entry.parts[index] === undefined) {
        entry.parts[index] = part;
        entry.received++;
        entry.size += part.length;
      }
      if (entry.size > maxMessageBytes) {
        shutdown("message too large");
        return;
      }
      if (entry.received === count) {
        partial.delete(id);
        deliver(entry.parts.join(""));
      }
    }
  };
  pipe.onclose = () => shutdown("closed by peer", false);

  return {
    get closed() {
      return closed;
    },
    send(message) {
      const json = JSON.stringify(message);
      if (json.length + 1 <= FRAME_BYTES) {
        rawSend(`m${json}`);
        return;
      }
      const id = (nextChunkId++).toString(36);
      const count = Math.ceil(json.length / FRAME_BYTES);
      for (let i = 0; i < count; i++) {
        rawSend(`c${id},${i},${count}|${json.slice(i * FRAME_BYTES, (i + 1) * FRAME_BYTES)}`);
      }
    },
    onMessage(cb) {
      messageListeners.push(cb);
    },
    onClose(cb) {
      if (closed) cb("closed");
      else closeListeners.push(cb);
    },
    close(reason = "closed") {
      shutdown(reason);
    },
  };
}

/** Two connected in-memory pipes, delivering asynchronously like a real channel. */
export function createPipePair(): [MessagePipe, MessagePipe] {
  let open = true;
  const make = (): MessagePipe => ({ send() {}, close() {}, onmessage: null, onclose: null });
  const a = make();
  const b = make();
  const wire = (from: MessagePipe, to: MessagePipe) => {
    from.send = (data) => {
      if (!open) throw new Error("pipe closed");
      // Like a data channel, messages already sent still arrive before the close does.
      queueMicrotask(() => to.onmessage?.(data));
    };
    from.close = () => {
      if (!open) return;
      open = false;
      queueMicrotask(() => to.onclose?.());
    };
  };
  wire(a, b);
  wire(b, a);
  return [a, b];
}
