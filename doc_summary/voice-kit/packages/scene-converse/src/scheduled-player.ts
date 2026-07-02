/**
 * ScheduledPlayer — Pillar #4 of voice-kit.
 *
 * Time-scheduled audio playback queue using monotonic nextStartTime.
 * Each chunk is scheduled via start(atTime) where atTime >= lastEnd, with a
 * SAFETY_EPSILON guard against underrun. Drift detection records gap_ms.
 *
 * Barge-in integration: rejects chunks whose responseId < currentResponseId,
 * and interrupt() stops all scheduled AudioBufferSourceNodes atomically.
 *
 * Platform abstraction: in real adapter-web this wraps AudioContext + BufferSource;
 * here we accept an `AudioContextLike` interface so the player is unit-testable
 * without a real AudioContext.
 */

import type { IAudioPlayer, PlaybackChunk, PlayerStats } from '@voice-kit/core-types';

export interface AudioBufferLike {
  duration: number; // seconds
}

export interface AudioBufferSourceLike {
  buffer: AudioBufferLike | null;
  onended: (() => void) | null;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AudioContextLike {
  readonly currentTime: number; // seconds, monotonic
  createBufferSource(): AudioBufferSourceLike;
}

export interface ScheduledPlayerOptions {
  ctx: AudioContextLike;
  /** Decode raw audio bytes to AudioBufferLike */
  decode: (data: ArrayBuffer) => AudioBufferLike;
  /** Time to wait before scheduling first chunk, seconds */
  safetyEpsilon?: number;
  /** Called when scheduling drift is detected (chunk arrived too late) */
  onDrift?: (gapMs: number) => void;
  /** Called when a stale chunk is dropped */
  onStaleDrop?: (responseId: string, seq: number) => void;
  /** Called when playback of a responseId completes */
  onEnded?: (responseId: string) => void;
  /** Clock function to read currentTime; defaults to ctx.currentTime */
  now?: () => number;
}

interface ScheduledEntry {
  responseId: string;
  seq: number;
  src: AudioBufferSourceLike;
  startTime: number;
  endTime: number;
  ended: boolean;
}

export class ScheduledPlayer implements IAudioPlayer {
  private currentResponseId = 0;
  private nextStartTime = 0;
  private scheduled = new Map<string, ScheduledEntry>();
  private stats: PlayerStats = {
    scheduled: 0,
    droppedStale: 0,
    underruns: 0,
    gapMs: 0,
  };
  private endedListeners = new Set<(responseId: string) => void>();
  private readonly safetyEpsilon: number;
  private readonly now: () => number;

  constructor(private readonly opts: ScheduledPlayerOptions) {
    this.safetyEpsilon = opts.safetyEpsilon ?? 0.005;
    this.now = opts.now ?? (() => opts.ctx.currentTime);
  }

  enqueue(chunk: PlaybackChunk): boolean {
    if (Number(chunk.responseId) <= this.currentResponseId) {
      this.stats.droppedStale++;
      this.opts.onStaleDrop?.(chunk.responseId, chunk.seq);
      return false;
    }

    const buf = this.opts.decode(chunk.data);
    const src = this.opts.ctx.createBufferSource();
    src.buffer = buf;

    const now = this.now();

    // Drift detection: if the previous schedule ended in the past, the
    // incoming chunk arrived too late and we have an underrun gap.
    if (this.nextStartTime !== 0 && this.nextStartTime < now) {
      const gapMs = (now - this.nextStartTime) * 1000;
      this.stats.underruns++;
      this.stats.gapMs += gapMs;
      this.opts.onDrift?.(gapMs);
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
      ended: false,
    };
    this.scheduled.set(key, entry);
    this.stats.scheduled++;

    src.onended = () => {
      entry.ended = true;
      this.scheduled.delete(key);
      if (Number(chunk.responseId) >= this.currentResponseId) {
        this.opts.onEnded?.(chunk.responseId);
        for (const l of this.endedListeners) l(chunk.responseId);
      }
    };

    return true;
  }

  interrupt(responseId?: string): void {
    if (responseId === undefined) {
      this.currentResponseId++;
      // Stop everything currently scheduled
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
      // Stop only chunks belonging to a specific responseId
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
      // Recompute nextStartTime from remaining scheduled
      this.nextStartTime = this.computeNextEndTime();
    }
  }

  async flush(responseId?: string): Promise<void> {
    const matching = responseId
      ? [...this.scheduled.values()].filter((e) => e.responseId === responseId)
      : [...this.scheduled.values()];
    const maxEnd = matching.reduce((m, e) => Math.max(m, e.endTime), 0);
    if (maxEnd === 0) return;
    const waitMs = Math.max(0, (maxEnd - this.now()) * 1000);
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

  /** For testing: set currentResponseId explicitly */
  _setCurrentResponseId(n: number): void {
    this.currentResponseId = n;
  }

  /** For testing: peek current responseId */
  get _currentResponseId(): number {
    return this.currentResponseId;
  }

  private computeNextEndTime(): number {
    let max = 0;
    for (const e of this.scheduled.values()) {
      if (e.endTime > max) max = e.endTime;
    }
    return max;
  }
}
