/**
 * @voice-kit/core-types — audio capture & playback interfaces
 *
 * Design principles:
 * - Pull-based streams (AsyncIterable) for natural backpressure.
 * - Every chunk carries a monotonic chunkId for RTT echo attribution.
 * - Platform-agnostic: same interface implemented by web / RN / Taro / node.
 */

// ---------------------------------------------------------------------------
// Audio format
// ---------------------------------------------------------------------------

export type SampleRate = 8000 | 16000 | 24000 | 44100 | 48000;
export type AudioEncoding = 'pcm-s16le' | 'pcm-f32le' | 'opus' | 'mp3';

export interface AudioFormat {
  sampleRate: SampleRate;
  channels: 1 | 2;
  encoding: AudioEncoding;
}

export const PCM16_MONO_16K: AudioFormat = {
  sampleRate: 16000,
  channels: 1,
  encoding: 'pcm-s16le',
};

// ---------------------------------------------------------------------------
// Capture (microphone → app)
// ---------------------------------------------------------------------------

export interface AudioChunk {
  /** Int16 PCM data by default */
  data: ArrayBuffer;
  /** Monotonic per-stream id; used for chunk_id RTT echo */
  chunkId: number;
  /** Monotonic capture timestamp (ms) at first sample */
  captureTsMono: number;
  /** Chunk duration in milliseconds */
  durationMs: number;
  /** Filled by inline VAD when enabled */
  isSpeech?: boolean;
  /** RMS amplitude 0..1 */
  rms?: number;
}

export interface CaptureStats {
  /** Total frames emitted */
  framesEmitted: number;
  /** Frames dropped due to backpressure ring overflow */
  droppedFrames: number;
  /** Bytes captured */
  bytesCaptured: number;
  /** Active duration in ms */
  activeMs: number;
  /** Whether capture required software resampling */
  requiresResampling: boolean;
}

export interface CaptureStartOptions {
  /** Specific device id (omit for default) */
  deviceId?: string;
  /** Echo cancellation / noise suppression / auto gain (browser-dependent) */
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  /**
   * Optional cancellation signal. When aborted, capture is stopped and the
   * chunks() iterable terminates. Useful for React useEffect cleanup:
   *   const controller = new AbortController();
   *   capture.start({ signal: controller.signal });
   *   return () => controller.abort();
   */
  signal?: AbortSignal;
}

export interface IAudioCapture {
  readonly format: AudioFormat;
  /** Begin capturing. Rejects on permission denied or device unavailable. */
  start(opts?: CaptureStartOptions): Promise<void>;
  /** Stop capturing and release the device. */
  stop(): Promise<void>;
  /** Pull-based stream of audio chunks. */
  chunks(): AsyncIterable<AudioChunk>;
  /** Subscribe to device hot-plug events (browser/web only). */
  onDeviceChange?(cb: (devices: readonly DeviceInfo[]) => void): () => void;
  /** Snapshot statistics for observability. */
  getStats(): CaptureStats;
}

export interface DeviceInfo {
  deviceId: string;
  kind: 'audioinput' | 'audiooutput';
  label: string;
}

// ---------------------------------------------------------------------------
// Playback (app → speaker)
// ---------------------------------------------------------------------------

export interface PlaybackChunk {
  data: ArrayBuffer;
  /** Barge-in gating key; chunks with older responseId are dropped on interrupt */
  responseId: string;
  /** Per-response monotonic seq; tolerated out-of-order */
  seq: number;
  format: AudioFormat;
  /** Marks the final chunk of a response */
  isFinal?: boolean;
}

export interface PlayerStats {
  /** Chunks successfully scheduled */
  scheduled: number;
  /** Chunks dropped due to stale responseId */
  droppedStale: number;
  /** Detected scheduling drift events */
  underruns: number;
  /** Total gap milliseconds caused by drift */
  gapMs: number;
}

export interface IAudioPlayer {
  /** Enqueue a chunk for playback. Returns false if dropped (e.g. stale responseId). */
  enqueue(chunk: PlaybackChunk): boolean;
  /**
   * Atomically interrupt playback.
   * - With responseId: stop only chunks belonging to that responseId.
   * - Without: bump currentResponseId and stop everything currently scheduled.
   */
  interrupt(responseId?: string): void;
  /** Wait for all currently-scheduled chunks to finish playing. */
  flush(responseId?: string): Promise<void>;
  /**
   * Monotonic scheduled end-time (in AudioContext.currentTime domain when available,
   * otherwise relative to a clock provided by adapter).
   * Used by converse scene to decide when to safely unmute mic after AI speech ends.
   */
  getScheduledEndTime(responseId?: string): number | null;
  /** Subscribe to per-response end events. */
  onEnded(cb: (responseId: string) => void): () => void;
  getStats(): PlayerStats;
}
