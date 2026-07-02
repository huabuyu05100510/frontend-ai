/**
 * EnergyVAD — lightweight RMS + zero-crossing-rate voice activity detector.
 *
 * Pure-JS fallback when Silero WASM VAD is unavailable. Used by scene-input
 * (input method) to detect end-of-utterance automatically without server help.
 *
 * Algorithm:
 * - Per frame (default 20ms @ 16kHz = 320 samples):
 *   1. Compute RMS, if > threshold → speech-like frame
 *   2. Compute zero-crossing rate (voiced speech has lower ZCR)
 *   3. Decision: speech = high RMS AND ZCR < zcrCeiling
 * - Fire 'speech-start' after minSpeechMs consecutive speech frames
 * - Fire 'speech-end' after minSilenceMs consecutive silence frames
 */

import type { IVAD, VADEvent, VADOptions } from '@voice-kit/core-types';

export interface EnergyVADOptions extends VADOptions {
  /** ZCR ceiling (0..0.5); voiced frames typically <0.1 */
  zcrCeiling?: number;
}

const DEFAULTS: Required<EnergyVADOptions> = {
  threshold: 0.02,
  minSpeechMs: 200,
  minSilenceMs: 700,
  preRollMs: 200,
  zcrCeiling: 0.3,
};

export class EnergyVAD implements IVAD {
  private opts: Required<EnergyVADOptions>;
  private listeners = new Set<(e: VADEvent) => void>();
  private inSpeech = false;
  private consecutiveSpeechFrames = 0;
  private consecutiveSilenceFrames = 0;
  private speechStartTs = 0;
  private frameMs: number;

  constructor(opts: EnergyVADOptions = {}, sampleRate = 16000, frameSize = 320) {
    this.opts = { ...DEFAULTS, ...opts };
    this.frameMs = (frameSize / sampleRate) * 1000;
  }

  configure(opts: VADOptions): void {
    this.opts = { ...this.opts, ...opts };
  }

  reset(): void {
    this.inSpeech = false;
    this.consecutiveSpeechFrames = 0;
    this.consecutiveSilenceFrames = 0;
    this.speechStartTs = 0;
  }

  push(frame: Float32Array): void {
    const r = rmsOfFloat(frame);
    const z = zcr(frame);
    const ts = Date.now();
    const isSpeechFrame = r > this.opts.threshold && z < this.opts.zcrCeiling;

    // Always emit confidence event for observability
    this.emit({ kind: 'confidence', ts, score: r });

    if (isSpeechFrame) {
      this.consecutiveSpeechFrames++;
      this.consecutiveSilenceFrames = 0;
      if (!this.inSpeech) {
        const speechMs = this.consecutiveSpeechFrames * this.frameMs;
        if (speechMs >= this.opts.minSpeechMs) {
          this.inSpeech = true;
          this.speechStartTs = ts - speechMs;
          this.emit({ kind: 'speech-start', ts: this.speechStartTs });
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

  events(): AsyncIterable<VADEvent> {
    const self = this;
    const queue: VADEvent[] = [];
    let waiter: (() => void) | null = null;
    const localListener = (e: VADEvent) => {
      queue.push(e);
      if (waiter) {
        const w = waiter;
        waiter = null;
        w();
      }
    };
    self.listeners.add(localListener);
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<VADEvent>> {
            while (true) {
              const e = queue.shift();
              if (e) return { value: e, done: false };
              await new Promise<void>((r) => (waiter = r));
            }
          },
        };
      },
    };
  }

  private emit(e: VADEvent): void {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        /* swallow */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rmsOfFloat(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < frame.length; i++) sumSq += frame[i] * frame[i];
  return Math.sqrt(sumSq / frame.length);
}

function zcr(frame: Float32Array): number {
  if (frame.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < frame.length; i++) {
    if ((frame[i - 1] >= 0) !== (frame[i] >= 0)) crossings++;
  }
  return crossings / (frame.length - 1);
}
