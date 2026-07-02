/**
 * @voice-kit/core-types — transport interface
 *
 * One SDK, many transports: WebSocket / Socket.IO / WebRTC data channel.
 * Consume via pull-based message stream; subscribe to state changes for reconnect UI.
 */

export type TransportKind = 'websocket' | 'socket.io' | 'webrtc' | 'mock';

export interface TransportMessage {
  kind: 'text' | 'binary';
  data: string | ArrayBuffer;
  /** Optional metadata for tracing (e.g. chunkId for RTT attribution) */
  meta?: Record<string, unknown>;
}

export type TransportState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed';

export interface ReconnectOptions {
  strategy: 'none' | 'fixed' | 'exponential' | 'jittered-exponential';
  /** Base delay in ms */
  baseMs: number;
  /** Maximum delay between attempts */
  maxMs: number;
  /** Maximum attempts before giving up (omit = unlimited) */
  maxAttempts?: number;
}

export interface BackpressureOptions {
  /** When write buffer exceeds this, call onPressure(true) */
  highWaterBytes: number;
  /** When write buffer drops below this, call onPressure(false) */
  lowWaterBytes: number;
  /** Subscribe to pressure changes; producer side should adapt */
  onPressure: (paused: boolean) => void;
}

export interface TransportOptions {
  reconnect?: ReconnectOptions;
  heartbeatMs?: number;
  backpressure?: BackpressureOptions;
  /** Custom headers (adapter-dependent; some transports like browser WS cannot set them) */
  headers?: Record<string, string>;
  /** Initial payload sent on connect (e.g. auth token, session resume token) */
  auth?: Record<string, unknown>;
  /**
   * Optional cancellation signal. When aborted, the transport closes immediately
   * and the messages() iterable terminates. No reconnect is attempted after abort.
   */
  signal?: AbortSignal;
}

export interface ITransport {
  readonly kind: TransportKind;
  connect(url: string, opts?: TransportOptions): Promise<void>;
  send(msg: TransportMessage): void;
  messages(): AsyncIterable<TransportMessage>;
  state(): TransportState;
  onStateChange(cb: (state: TransportState) => void): () => void;
  /** Current bytes buffered in the underlying send queue */
  bufferedAmount(): number;
  close(code?: number, reason?: string): void;
}
