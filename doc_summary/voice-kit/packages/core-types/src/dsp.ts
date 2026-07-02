/**
 * @voice-kit/core-types — DSP / VAD / wake word interfaces
 *
 * DSP runs in native (C++/Rust → WASM) — TS only orchestrates topology.
 */

// ---------------------------------------------------------------------------
// Resampler
// ---------------------------------------------------------------------------

export interface IResampler {
  readonly inRate: number;
  readonly outRate: number;
  /** Process input Float32 PCM, returns resampled Float32 PCM (phase-preserving) */
  process(input: Float32Array): Float32Array;
  /** Flush internal delay line */
  flush(): Float32Array;
  reset(): void;
}

// ---------------------------------------------------------------------------
// VAD (Voice Activity Detection)
// ---------------------------------------------------------------------------

export type VADEventKind = 'speech-start' | 'speech-end' | 'confidence';

export interface VADEvent {
  kind: VADEventKind;
  ts: number;
  /** Confidence score 0..1 (always present for 'confidence') */
  score?: number;
}

export interface VADOptions {
  /** RMS threshold above which audio is considered speech (0..1) */
  threshold?: number;
  /** Minimum speech duration to fire 'speech-start' (ms) */
  minSpeechMs?: number;
  /** Minimum silence duration to fire 'speech-end' (ms) */
  minSilenceMs?: number;
  /** Pre-roll buffer kept in memory to hand off on speech-start (ms) */
  preRollMs?: number;
}

export interface IVAD {
  /** Push a frame (typically 10/20/30ms Float32 PCM at 16kHz) */
  push(frame: Float32Array): void;
  /** Async iterable of VAD events */
  events(): AsyncIterable<VADEvent>;
  configure(opts: VADOptions): void;
  reset(): void;
}

// ---------------------------------------------------------------------------
// Wake word
// ---------------------------------------------------------------------------

export interface WakeModelRef {
  url: string;
  /** Content hash for integrity check */
  hash: string;
  sensitivity?: number;
}

export interface WakeEvent {
  keyword: string;
  score: number;
  ts: number;
}

export interface IWakeWord {
  load(model: WakeModelRef): Promise<void>;
  push(frame: Float32Array): void;
  events(): AsyncIterable<WakeEvent>;
  dispose(): void;
}
