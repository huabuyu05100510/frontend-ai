import { describe, expect, it, vi } from 'vitest';
import { ScheduledPlayer, AudioContextLike, AudioBufferLike } from '../scheduled-player';
import type { PlaybackChunk } from '@voice-kit/core-types';

class FakeCtx implements AudioContextLike {
  _time = 0;
  sources: Array<{
    buffer: AudioBufferLike | null;
    started: number | null;
    stopped: number | null;
    onended: (() => void) | null;
  }> = [];

  get currentTime(): number {
    return this._time;
  }
  advance(seconds: number): void {
    this._time += seconds;
  }
  createBufferSource() {
    const src = {
      buffer: null as AudioBufferLike | null,
      started: null as number | null,
      stopped: null as number | null,
      onended: null as (() => void) | null,
    };
    this.sources.push(src);
    return {
      get buffer() {
        return src.buffer;
      },
      set buffer(v) {
        src.buffer = v;
      },
      get onended() {
        return src.onended;
      },
      set onended(v) {
        src.onended = v;
      },
      start: (when?: number) => {
        src.started = when ?? null;
      },
      stop: (when?: number) => {
        // Use a sentinel (ctx.currentTime) when no `when` is passed so that
        // tests can distinguish "stop was called" from "never called".
        src.stopped = when !== undefined ? when : -1;
        // Trigger onended synchronously in test
        queueMicrotask(() => src.onended?.());
      },
    };
  }
}

function makeChunk(responseId: string, seq: number, durationSec = 0.5): PlaybackChunk {
  return {
    data: new ArrayBuffer(0), // fake; decode will return a fake buffer
    responseId,
    seq,
    format: { sampleRate: 24000, channels: 1, encoding: 'pcm-s16le' },
  };
}

describe('ScheduledPlayer', () => {
  it('schedules first chunk at currentTime + epsilon', () => {
    const ctx = new FakeCtx();
    const decode = () => ({ duration: 0.5 });
    const player = new ScheduledPlayer({ ctx, decode, safetyEpsilon: 0.01 });
    player.enqueue(makeChunk('1', 1));
    expect(ctx.sources[0].started).toBe(0.01);
    expect(ctx.sources[0].buffer?.duration).toBe(0.5);
  });

  it('schedules subsequent chunks back-to-back', () => {
    const ctx = new FakeCtx();
    const decode = () => ({ duration: 0.5 });
    const player = new ScheduledPlayer({ ctx, decode, safetyEpsilon: 0.01 });
    player.enqueue(makeChunk('1', 1));
    player.enqueue(makeChunk('1', 2));
    player.enqueue(makeChunk('1', 3));
    // First starts at 0.01, each chunk 0.5s long
    expect(ctx.sources[0].started).toBe(0.01);
    expect(ctx.sources[1].started).toBe(0.51);
    expect(ctx.sources[2].started).toBe(1.01);
  });

  it('rejects stale chunks after interrupt()', () => {
    const ctx = new FakeCtx();
    const decode = () => ({ duration: 0.5 });
    const player = new ScheduledPlayer({ ctx, decode });
    player.enqueue(makeChunk('1', 1)); // currentResponseId bumped to 1 internally on interrupt
    expect(player.getStats().scheduled).toBe(1);
    player.interrupt();
    expect(player._currentResponseId).toBe(1);
    const accepted = player.enqueue(makeChunk('1', 2)); // stale responseId '1'
    expect(accepted).toBe(false);
    expect(player.getStats().droppedStale).toBe(1);
  });

  it('interrupt() stops all currently scheduled sources', () => {
    const ctx = new FakeCtx();
    const decode = () => ({ duration: 0.5 });
    const player = new ScheduledPlayer({ ctx, decode });
    player.enqueue(makeChunk('1', 1));
    player.enqueue(makeChunk('1', 2));
    player.enqueue(makeChunk('1', 3));
    player.interrupt();
    expect(ctx.sources[0].stopped).not.toBeNull();
    expect(ctx.sources[1].stopped).not.toBeNull();
    expect(ctx.sources[2].stopped).not.toBeNull();
    expect(player.getScheduledEndTime()).toBeNull();
  });

  it('interrupt(responseId) stops only matching responseId', () => {
    const ctx = new FakeCtx();
    const decode = () => ({ duration: 0.5 });
    const player = new ScheduledPlayer({ ctx, decode });
    player.enqueue(makeChunk('1', 1));
    player.enqueue(makeChunk('1', 2));
    player.enqueue(makeChunk('2', 1));
    player.interrupt('1'); // stop only responseId=1
    expect(ctx.sources[0].stopped).not.toBeNull();
    expect(ctx.sources[1].stopped).not.toBeNull();
    expect(ctx.sources[2].stopped).toBeNull(); // responseId=2 still playing
  });

  it('getScheduledEndTime returns latest scheduled end', () => {
    const ctx = new FakeCtx();
    const decode = () => ({ duration: 0.5 });
    const player = new ScheduledPlayer({ ctx, decode, safetyEpsilon: 0.01 });
    player.enqueue(makeChunk('1', 1));
    player.enqueue(makeChunk('1', 2));
    expect(player.getScheduledEndTime()).toBe(1.01); // 0.01 + 0.5 + 0.5
  });

  it('detects drift when nextStartTime is behind currentTime', () => {
    const ctx = new FakeCtx();
    const decode = () => ({ duration: 0.5 });
    const drifts: number[] = [];
    const player = new ScheduledPlayer({
      ctx,
      decode,
      safetyEpsilon: 0.01,
      onDrift: (gapMs) => drifts.push(gapMs),
    });
    player.enqueue(makeChunk('1', 1));
    // Advance clock past nextStartTime
    ctx.advance(2.0);
    player.enqueue(makeChunk('1', 2));
    expect(drifts.length).toBe(1);
    expect(drifts[0]).toBeGreaterThan(0);
    expect(player.getStats().underruns).toBe(1);
  });

  it('onEnded fires after chunk finishes', async () => {
    const ctx = new FakeCtx();
    const decode = () => ({ duration: 0.5 });
    const ended: string[] = [];
    const player = new ScheduledPlayer({ ctx, decode, onEnded: (rid) => ended.push(rid) });
    player.enqueue(makeChunk('1', 1));
    // Simulate the source finishing
    ctx.sources[0].onended?.();
    expect(ended).toEqual(['1']);
  });
});
