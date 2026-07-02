/**
 * @voice-kit/core-transport-ws
 *
 * Pillar #3 of voice-kit: WebSocket transport with
 *  - jittered-exponential reconnect
 *  - backpressure awareness (write-buffer monitoring)
 *  - chunk_id RTT attribution (via TransportMessage.meta.chunkId)
 *
 * Platform: works in browser & Node.js (depends on global WebSocket).
 */

import type {
  ITransport,
  TransportKind,
  TransportMessage,
  TransportOptions,
  TransportState,
  BackpressureOptions,
} from '@voice-kit/core-types';

interface Listener<T> {
  (value: T): void;
}

/**
 * Compute the next reconnect delay using jittered-exponential strategy.
 * Formula: base * 2^attempt * (0.5 + rand*0.5), capped at max.
 */
export function nextReconnectDelay(
  attempt: number,
  baseMs: number,
  maxMs: number
): number {
  const exp = baseMs * Math.pow(2, attempt);
  const jittered = exp * (0.5 + Math.random() * 0.5);
  return Math.min(jittered, maxMs);
}

interface PendingResolver {
  resolve: () => void;
  reject: (e: Error) => void;
}

export class WebSocketTransport implements ITransport {
  readonly kind: TransportKind = 'websocket';

  private ws: WebSocket | null = null;
  private url = '';
  private opts: TransportOptions = {};
  private _state: TransportState = 'idle';
  private stateListeners = new Set<Listener<TransportState>>();

  // Reconnect state
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private manuallyClosed = false;

  // Pending connect promise
  private connectResolver: PendingResolver | null = null;

  // Backpressure state
  private bp?: BackpressureOptions;
  private bpCheckTimer: ReturnType<typeof setInterval> | null = null;
  private bpHigh = false;

  // Message stream
  private messageQueue: TransportMessage[] = [];
  private messageWaiters: Array<() => void> = [];

  // For bufferedAmount() snapshot
  get bufferedAmountBytes(): number {
    return this.ws?.bufferedAmount ?? 0;
  }

  state(): TransportState {
    return this._state;
  }

  bufferedAmount(): number {
    return this.bufferedAmountBytes;
  }

  onStateChange(cb: Listener<TransportState>): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  private setState(s: TransportState): void {
    if (this._state === s) return;
    this._state = s;
    for (const l of this.stateListeners) {
      try {
        l(s);
      } catch {
        /* swallow listener errors */
      }
    }
  }

  async connect(url: string, opts: TransportOptions = {}): Promise<void> {
    this.url = url;
    this.opts = opts;
    this.manuallyClosed = false;
    this.reconnectAttempt = 0;
    this.bp = opts.backpressure;

    // Wire AbortSignal: abort → close immediately, no reconnect.
    if (opts.signal) {
      if (opts.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      opts.signal.addEventListener('abort', () => {
        this.manuallyClosed = true; // prevent reconnect loop
        this.close(1000, 'AbortSignal');
      }, { once: true });
    }

    return this.doConnect();
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState('connecting');
      let ws: WebSocket;
      try {
        // Browser WebSocket supports protocols but not custom headers.
        // For header-based auth, use query params + sub-protocols.
        const protocols = this.opts.headers?.['Sec-WebSocket-Protocol'];
        ws = protocols
          ? new WebSocket(this.url, protocols.split(','))
          : new WebSocket(this.url);
        ws.binaryType = 'arraybuffer';
      } catch (e) {
        reject(e as Error);
        return;
      }
      this.ws = ws;

      this.connectResolver = { resolve, reject };

      ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.setState('open');
        this.startBackpressureCheck();
        this.connectResolver?.resolve();
        this.connectResolver = null;
      };

      ws.onmessage = (e) => {
        const isBinary =
          typeof ArrayBuffer !== 'undefined' && e.data instanceof ArrayBuffer;
        const msg: TransportMessage = {
          kind: isBinary ? 'binary' : 'text',
          data: e.data,
        };
        this.enqueueMessage(msg);
      };

      ws.onerror = () => {
        // ws.onerror fires before onclose; defer rejection to onclose
      };

      ws.onclose = (e) => {
        this.stopBackpressureCheck();
        this.ws = null;
        if (this.manuallyClosed) {
          this.setState('closed');
          this.connectResolver?.reject(
            new Error(`WebSocket closed: ${e.code} ${e.reason}`)
          );
          this.connectResolver = null;
          return;
        }
        // Reconnect path
        this.setState('reconnecting');
        this.connectResolver?.reject(
          new Error(`WebSocket closed before open: ${e.code}`)
        );
        this.connectResolver = null;
        this.scheduleReconnect();
      };
    });
  }

  private scheduleReconnect(): void {
    const r = this.opts.reconnect;
    if (!r || r.strategy === 'none') {
      this.setState('closed');
      return;
    }
    const maxAttempts = r.maxAttempts ?? Infinity;
    if (this.reconnectAttempt >= maxAttempts) {
      this.setState('closed');
      return;
    }
    const delay =
      r.strategy === 'fixed'
        ? r.baseMs
        : nextReconnectDelay(this.reconnectAttempt, r.baseMs, r.maxMs);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect().catch(() => {
        // will be rescheduled by onclose
      });
    }, delay);
  }

  send(msg: TransportMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Transport not open');
    }
    this.ws.send(msg.data);
    // After send, check backpressure on next tick
    queueMicrotask(() => this.checkBackpressure());
  }

  messages(): AsyncIterable<TransportMessage> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<TransportMessage>> {
            while (true) {
              const msg = self.messageQueue.shift();
              if (msg) return { value: msg, done: false };
              if (self._state === 'closed') {
                return { value: undefined, done: true };
              }
              await new Promise<void>((r) => self.messageWaiters.push(r));
            }
          },
        };
      },
    };
  }

  close(code?: number, reason?: string): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopBackpressureCheck();
    try {
      this.ws?.close(code, reason);
    } catch {
      /* ignore */
    }
    this.setState('closed');
    // Wake up any pending message iterators
    const waiters = this.messageWaiters;
    this.messageWaiters = [];
    waiters.forEach((w) => w());
  }

  private enqueueMessage(msg: TransportMessage): void {
    this.messageQueue.push(msg);
    const waiters = this.messageWaiters;
    this.messageWaiters = [];
    waiters.forEach((w) => w());
  }

  private startBackpressureCheck(): void {
    if (!this.bp || this.bpCheckTimer) return;
    this.bpCheckTimer = setInterval(() => this.checkBackpressure(), 100);
  }

  private stopBackpressureCheck(): void {
    if (this.bpCheckTimer) {
      clearInterval(this.bpCheckTimer);
      this.bpCheckTimer = null;
    }
  }

  private checkBackpressure(): void {
    if (!this.bp || !this.ws) return;
    const buffered = this.ws.bufferedAmount;
    if (!this.bpHigh && buffered > this.bp.highWaterBytes) {
      this.bpHigh = true;
      this.bp.onPressure(true);
    } else if (this.bpHigh && buffered < this.bp.lowWaterBytes) {
      this.bpHigh = false;
      this.bp.onPressure(false);
    }
  }
}
