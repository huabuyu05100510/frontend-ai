/**
 * @voice-kit/core-types — storage / clock / capability abstractions
 */

// ---------------------------------------------------------------------------
// Storage — large-blob aware (voice samples, offline queue, resume tokens)
// ---------------------------------------------------------------------------

export interface IStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  /** Put a large blob; returns the storage key used */
  putBlob(key: string, data: Blob | ArrayBuffer, meta?: Record<string, unknown>): Promise<string>;
  getBlob(key: string): Promise<Blob | null>;
  iterate<T>(prefix: string): AsyncIterable<[string, T]>;
}

// ---------------------------------------------------------------------------
// Clock — wall clock vs monotonic, plus scheduler
// ---------------------------------------------------------------------------

export interface IClock {
  /** Wall clock ms (Date.now equivalent) */
  now(): number;
  /** Monotonic clock ms (performance.now equivalent); never goes backwards */
  mono(): number;
  /** Schedule a callback at a monotonic timestamp; returns cancel function */
  scheduleAt(monoTs: number, cb: () => void): () => void;
}

// ---------------------------------------------------------------------------
// Capability matrix — adapter declares what it can do
// ---------------------------------------------------------------------------

export interface AdapterCapabilities {
  /** SharedArrayBuffer + Atomics available (requires crossOriginIsolated) */
  hasSharedArrayBuffer: boolean;
  /** AudioWorklet available (not in legacy browsers / mini-program) */
  hasAudioWorklet: boolean;
  /** WebAssembly available */
  hasWasm: boolean;
  /** WebRTC peer connection available */
  hasWebRTC: boolean;
  /** Service Worker available */
  hasServiceWorker: boolean;
  /** Native sample rate of the platform (used to decide resampling) */
  nativeSampleRate: number;
  /** Adapter identifier: 'web' | 'electron' | 'taro' | 'node' */
  platform: string;
}

export const WEB_CAPABILITIES: AdapterCapabilities = {
  hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
  hasAudioWorklet: typeof AudioWorkletNode !== 'undefined',
  hasWasm: typeof WebAssembly !== 'undefined',
  hasWebRTC: typeof RTCPeerConnection !== 'undefined',
  hasServiceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  nativeSampleRate:
    typeof AudioContext !== 'undefined' ? new AudioContext().sampleRate : 48000,
  platform: 'web',
};
