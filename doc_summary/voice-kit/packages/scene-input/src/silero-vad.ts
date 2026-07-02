/**
 * SileroVAD — ONNX-backed neural VAD implementing IVAD.
 *
 * EnergyVAD (RMS + ZCR) is an explicit fallback for when WASM is unavailable.
 * This class is the primary path: Silero V5 ONNX model running via ort-web,
 * with ~1.5 MB model weight downloaded once and cached in IStorage.
 *
 * Architecture:
 *   frames → InferenceSession.run() → probability 0..1 → threshold gate
 *                                                       → speech-start / speech-end events
 *
 * Usage:
 *   const vad = new SileroVAD(storage, { modelUrl: '/models/silero_vad.onnx' });
 *   await vad.load();   // download + compile ONNX model (cached after first load)
 *   vad.push(frame);    // call from AudioWorklet message handler
 *   for await (const event of vad.events()) { ... }
 *
 * Model format:
 *   Input:  Float32Array[512]  (32ms frame @ 16kHz, MATCHES Silero V5 chunk size)
 *   Output: { output: Float32Array[1] }  (speech probability 0..1)
 *   State:  two GRU hidden state tensors, carried across frames
 *
 * ORT dependency is a peer dependency — callers import ort-web and pass the
 * InferenceSession factory via SileroVADOptions.createSession, keeping this
 * package free of a hard ort-web dependency at bundle time.
 */

import type { IVAD, VADEvent, VADOptions, IStorage } from '@voice-kit/core-types';

// ---------------------------------------------------------------------------
// ORT interface (subset needed — avoids hard ort-web dep)
// ---------------------------------------------------------------------------

export interface OrtTensor {
  data: Float32Array | BigInt64Array;
  dims: readonly number[];
  type: string;
}

export interface OrtSession {
  run(
    feeds: Record<string, OrtTensor>,
    options?: { logSeverityLevel?: number }
  ): Promise<Record<string, OrtTensor>>;
  inputNames: readonly string[];
  outputNames: readonly string[];
}

export interface OrtSessionFactory {
  create(modelData: ArrayBuffer, options?: unknown): Promise<OrtSession>;
  /** Create a zero tensor of the given shape and type */
  tensor(type: string, data: Float32Array | BigInt64Array, dims: number[]): OrtTensor;
}

// ---------------------------------------------------------------------------
// SileroVAD
// ---------------------------------------------------------------------------

export interface SileroVADOptions extends VADOptions {
  /** URL or path to the Silero V5 ONNX model. */
  modelUrl: string;
  /**
   * ORT InferenceSession factory — pass `ort.InferenceSession` from ort-web.
   * Required if you want to use ONNX inference; if omitted, push() is a no-op
   * and the instance behaves as a disabled VAD.
   */
  ort?: OrtSessionFactory;
  /**
   * Speech probability threshold (0..1). Frames above this are considered
   * speech. Default: 0.5 (Silero V5 recommended).
   */
  threshold?: number;
  /** Minimum consecutive speech frames before firing speech-start. Default: 200ms */
  minSpeechMs?: number;
  /** Minimum consecutive silence frames before firing speech-end. Default: 700ms */
  minSilenceMs?: number;
  /** Frame size in samples expected by model. Must match model. Default: 512 (32ms@16kHz) */
  frameSamples?: number;
}

const CACHE_KEY_PREFIX = 'silero-vad-model:';

export class SileroVAD implements IVAD {
  private session: OrtSession | null = null;
  private opts: Required<Omit<SileroVADOptions, 'ort'>> & Pick<SileroVADOptions, 'ort'>;

  // GRU hidden states — carried between frames (Silero V5 stateful inference)
  private h: Float32Array;
  private c: Float32Array;

  private inSpeech = false;
  private consecutiveSpeechFrames = 0;
  private consecutiveSilenceFrames = 0;
  private frameMs: number;

  private listeners = new Set<(e: VADEvent) => void>();

  constructor(
    private readonly storage: IStorage | null,
    opts: SileroVADOptions,
  ) {
    const frameSamples = opts.frameSamples ?? 512;
    this.opts = {
      modelUrl: opts.modelUrl,
      ort: opts.ort,
      threshold: opts.threshold ?? 0.5,
      minSpeechMs: opts.minSpeechMs ?? 200,
      minSilenceMs: opts.minSilenceMs ?? 700,
      preRollMs: opts.preRollMs ?? 200,
      frameSamples,
    };
    this.frameMs = (frameSamples / 16000) * 1000;
    // Silero V5 hidden state dimensions: [2, 1, 64]
    this.h = new Float32Array(2 * 1 * 64);
    this.c = new Float32Array(2 * 1 * 64);
  }

  /**
   * Download and compile the ONNX model.
   * Model bytes are cached in IStorage so subsequent loads are instant.
   * Must be called and awaited before push().
   */
  async load(): Promise<void> {
    if (!this.opts.ort) return; // no ORT runtime, no-op

    const cacheKey = CACHE_KEY_PREFIX + this.opts.modelUrl;
    let modelBuffer: ArrayBuffer | null = null;

    // Try cache first
    if (this.storage) {
      const cached = await this.storage.getBlob(cacheKey);
      if (cached) modelBuffer = await cached.arrayBuffer();
    }

    if (!modelBuffer) {
      const resp = await fetch(this.opts.modelUrl);
      if (!resp.ok) throw new Error(`SileroVAD: failed to fetch model: ${resp.status}`);
      modelBuffer = await resp.arrayBuffer();
      if (this.storage) {
        void this.storage.putBlob(cacheKey, modelBuffer);
      }
    }

    this.session = await this.opts.ort.create(modelBuffer, { logSeverityLevel: 4 });
  }

  push(frame: Float32Array): void {
    if (!this.session || !this.opts.ort) return;
    // Run inference asynchronously; push() stays sync for AudioWorklet compat.
    void this.runInference(frame);
  }

  configure(opts: VADOptions): void {
    if (opts.threshold !== undefined) this.opts.threshold = opts.threshold;
    if (opts.minSpeechMs !== undefined) this.opts.minSpeechMs = opts.minSpeechMs;
    if (opts.minSilenceMs !== undefined) this.opts.minSilenceMs = opts.minSilenceMs;
  }

  reset(): void {
    this.inSpeech = false;
    this.consecutiveSpeechFrames = 0;
    this.consecutiveSilenceFrames = 0;
    // Reset GRU hidden state
    this.h.fill(0);
    this.c.fill(0);
  }

  events(): AsyncIterable<VADEvent> {
    const queue: VADEvent[] = [];
    let waiter: (() => void) | null = null;
    const listener = (e: VADEvent) => {
      queue.push(e);
      if (waiter) { const w = waiter; waiter = null; w(); }
    };
    this.listeners.add(listener);
    return {
      [Symbol.asyncIterator]: () => ({
        async next(): Promise<IteratorResult<VADEvent>> {
          while (true) {
            if (queue.length > 0) return { value: queue.shift()!, done: false };
            await new Promise<void>((r) => (waiter = r));
          }
        },
        return: () => {
          listener && this.listeners.delete(listener);
          return Promise.resolve({ value: undefined as unknown as VADEvent, done: true });
        },
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async runInference(frame: Float32Array): Promise<void> {
    if (!this.session || !this.opts.ort) return;
    const ort = this.opts.ort;
    const ts = Date.now();

    try {
      const feeds: Record<string, OrtTensor> = {
        input: ort.tensor('float32', frame, [1, frame.length]),
        h: ort.tensor('float32', this.h, [2, 1, 64]),
        c: ort.tensor('float32', this.c, [2, 1, 64]),
        sr: ort.tensor('int64', BigInt64Array.from([16000n]), [1]),
      };

      const out = await this.session.run(feeds);

      // Update GRU state for next frame
      const newH = out['hn']?.data as Float32Array | undefined;
      const newC = out['cn']?.data as Float32Array | undefined;
      if (newH) this.h = newH;
      if (newC) this.c = newC;

      const prob = (out['output']?.data as Float32Array)?.[0] ?? 0;
      this.emit({ kind: 'confidence', ts, score: prob });
      this.updateSpeechState(prob, ts);
    } catch {
      /* swallow inference errors to not crash the capture loop */
    }
  }

  private updateSpeechState(prob: number, ts: number): void {
    const isSpeechFrame = prob >= this.opts.threshold;

    if (isSpeechFrame) {
      this.consecutiveSpeechFrames++;
      this.consecutiveSilenceFrames = 0;
      if (!this.inSpeech) {
        const speechMs = this.consecutiveSpeechFrames * this.frameMs;
        if (speechMs >= this.opts.minSpeechMs) {
          this.inSpeech = true;
          this.emit({ kind: 'speech-start', ts: ts - speechMs });
        }
      }
    } else {
      this.consecutiveSilenceFrames++;
      this.consecutiveSpeechFrames = 0;
      if (this.inSpeech) {
        const silenceMs = this.consecutiveSilenceFrames * this.frameMs;
        if (silenceMs >= this.opts.minSilenceMs) {
          this.inSpeech = false;
          this.emit({ kind: 'speech-end', ts: ts - silenceMs });
        }
      }
    }
  }

  private emit(e: VADEvent): void {
    for (const l of this.listeners) {
      try { l(e); } catch { /* swallow */ }
    }
  }
}
