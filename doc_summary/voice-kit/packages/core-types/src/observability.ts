/**
 * @voice-kit/core-types — observability + scene-level shared types
 */
import type { IAudioCapture, IAudioPlayer } from './audio';
import type { ITransport } from './transport';
import type { IStorage, IClock } from './platform';
import type { IVAD, IResampler } from './dsp';

export type Attrs = Record<string, string | number | boolean | undefined>;

export interface Span {
  setAttribute(key: string, value: Attrs[string]): void;
  recordError(error: Error | string): void;
  end(): void;
}

export interface IObservability {
  /** Wrap an async function in a span */
  span<T>(name: string, attrs: Attrs, fn: (span: Span) => Promise<T> | T): Promise<T>;
  /** Record a latency sample in ms (routed to HDR histogram internally) */
  histogram(name: string, valueMs: number, attrs?: Attrs): void;
  counter(name: string, attrs?: Attrs): void;
  gauge(name: string, value: number, attrs?: Attrs): void;
  /** Domain-specific: stamp a capture chunk for RTT attribution */
  markCapture(chunkId: number, ts: number): void;
  /** Domain-specific: server ack echoes chunkId, client computes RTT */
  markAck(chunkId: number, ts: number): void;
  /** Enable/disable at runtime (for user opt-in) */
  setEnabled(enabled: boolean): void;
}

// ---------------------------------------------------------------------------
// Scene-level shared types
// ---------------------------------------------------------------------------

export interface SceneDeps {
  capture?: IAudioCapture;
  player?: IAudioPlayer;
  transport?: ITransport;
  storage?: IStorage;
  clock?: IClock;
  vad?: IVAD;
  resampler?: IResampler;
  observability?: IObservability;
}

export interface SceneStateSubscription<T> {
  state(): AsyncIterable<T>;
  unsubscribe(): void;
}

export interface IScene<S, A> {
  /** Current state snapshot (also observable via state()) */
  getState(): S;
  /** Async iterable of state changes */
  state(): AsyncIterable<S>;
  /** Dispatch an action */
  dispatch(action: A): void;
  /** Tear down all resources */
  destroy(): Promise<void>;
}
