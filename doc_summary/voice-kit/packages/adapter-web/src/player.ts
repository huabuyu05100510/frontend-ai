/**
 * WebAudioPlayer — Pillar #4 browser implementation.
 *
 * Wraps browser AudioContext + AudioBufferSourceNode for time-scheduled playback.
 * Implements IAudioPlayer with responseId-gated barge-in.
 */

import type {
  IAudioPlayer,
  PlaybackChunk,
  PlayerStats,
} from '@voice-kit/core-types';

export interface WebAudioPlayerOptions {
  /** Existing AudioContext (e.g. shared with capture); if omitted, creates one */
  ctx?: AudioContext;
  /** Target sample rate for the playback context */
  sampleRate?: number;
  /** Safety epsilon in seconds (default 5ms) */
  safetyEpsilon?: number;
}

interface ScheduledEntry {
  responseId: string;
  seq: number;
  src: AudioBufferSourceNode;
  startTime: number;
  endTime: number;
}

export class WebAudioPlayer implements IAudioPlayer {
  private ctx: AudioContext;
  private currentResponseId = 0;
  private nextStartTime = 0;
  private scheduled = new Map<string, ScheduledEntry>();
  private endedListeners = new Set<(responseId: string) => void>();
  private stats: PlayerStats = {
    scheduled: 0,
    droppedStale: 0,
    underruns: 0,
    gapMs: 0,
  };
  private readonly safetyEpsilon: number;
  private ownsCtx: boolean;

  constructor(opts: WebAudioPlayerOptions = {}) {
    if (opts.ctx) {
      this.ctx = opts.ctx;
      this.ownsCtx = false;
    } else {
      this.ctx = new AudioContext({ sampleRate: opts.sampleRate, latencyHint: 'balanced' });
      this.ownsCtx = true;
    }
    this.safetyEpsilon = opts.safetyEpsilon ?? 0.005;
  }

  enqueue(chunk: PlaybackChunk): boolean {
    if (Number(chunk.responseId) <= this.currentResponseId) {
      this.stats.droppedStale++;
      return false;
    }

    // Decode based on format
    const buf = this.decodeToAudioBuffer(chunk.data, chunk.format.sampleRate);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const now = this.ctx.currentTime;

    // Drift detection: check OLD nextStartTime BEFORE overwriting.
    // If the last scheduled chunk ended in the past, a chunk arrived too
    // late and we have an underrun gap — same logic as ScheduledPlayer.
    if (this.nextStartTime !== 0 && this.nextStartTime < now) {
      const gapMs = (now - this.nextStartTime) * 1000;
      this.stats.underruns++;
      this.stats.gapMs += gapMs;
    }

    const start =
      this.nextStartTime === 0
        ? now + this.safetyEpsilon
        : Math.max(now + this.safetyEpsilon, this.nextStartTime);

    src.start(start);

    const endTime = start + buf.duration;
    this.nextStartTime = endTime;

    const key = `${chunk.responseId}:${chunk.seq}`;
    const entry: ScheduledEntry = {
      responseId: chunk.responseId,
      seq: chunk.seq,
      src,
      startTime: start,
      endTime,
    };
    this.scheduled.set(key, entry);
    this.stats.scheduled++;

    src.onended = () => {
      this.scheduled.delete(key);
      if (Number(chunk.responseId) >= this.currentResponseId) {
        for (const l of this.endedListeners) l(chunk.responseId);
      }
    };
    return true;
  }

  interrupt(responseId?: string): void {
    if (responseId === undefined) {
      this.currentResponseId++;
      for (const [key, entry] of this.scheduled) {
        try {
          entry.src.stop();
        } catch {
          /* already stopped */
        }
        this.scheduled.delete(key);
      }
      this.nextStartTime = 0;
    } else {
      for (const [key, entry] of this.scheduled) {
        if (entry.responseId === responseId) {
          try {
            entry.src.stop();
          } catch {
            /* ignore */
          }
          this.scheduled.delete(key);
        }
      }
      this.nextStartTime = this.computeMaxEnd();
    }
  }

  async flush(responseId?: string): Promise<void> {
    const matching = responseId
      ? [...this.scheduled.values()].filter((e) => e.responseId === responseId)
      : [...this.scheduled.values()];
    if (matching.length === 0) return;
    const maxEnd = matching.reduce((m, e) => Math.max(m, e.endTime), 0);
    const waitMs = Math.max(0, (maxEnd - this.ctx.currentTime) * 1000);
    await new Promise((r) => setTimeout(r, waitMs + 10));
  }

  getScheduledEndTime(responseId?: string): number | null {
    const matching = responseId
      ? [...this.scheduled.values()].filter((e) => e.responseId === responseId)
      : [...this.scheduled.values()];
    if (matching.length === 0) return null;
    return matching.reduce((m, e) => Math.max(m, e.endTime), 0);
  }

  onEnded(cb: (responseId: string) => void): () => void {
    this.endedListeners.add(cb);
    return () => this.endedListeners.delete(cb);
  }

  getStats(): PlayerStats {
    return { ...this.stats };
  }

  async close(): Promise<void> {
    if (this.ownsCtx) {
      try {
        await this.ctx.close();
      } catch {
        /* ignore */
      }
    }
  }

  /** Resume the context (must be called from a user gesture on some browsers) */
  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  private decodeToAudioBuffer(data: ArrayBuffer, sampleRate: number): AudioBuffer {
    // PCM Int16 → Float32 AudioBuffer
    const view = new Int16Array(data);
    const buf = this.ctx.createBuffer(1, view.length, sampleRate);
    const channel = buf.getChannelData(0);
    for (let i = 0; i < view.length; i++) {
      channel[i] = view[i] / 0x8000;
    }
    return buf;
  }

  private computeMaxEnd(): number {
    let max = 0;
    for (const e of this.scheduled.values()) {
      if (e.endTime > max) max = e.endTime;
    }
    return max;
  }
}
