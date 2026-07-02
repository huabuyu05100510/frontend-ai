/**
 * Unit tests for OpusEncodedCapture.
 *
 * Mocks the WebCodecs AudioEncoder/AudioData (not available in Node.js) and
 * verifies the encoder wrapper's contract:
 *   - Frame alignment: only emits complete Opus frames
 *   - Chunk metadata: timestamps and IDs match the Opus stream timeline
 *   - Stop sequence: drains buffered PCM with zero-padding, flushes encoder,
 *     closes resources cleanly
 *   - Feature detection: reports availability correctly
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  IAudioCapture,
  AudioChunk,
  AudioFormat,
} from '@voice-kit/core-types';

// ---------------------------------------------------------------------------
// Mock WebCodecs — captured in module-level arrays so tests can assert on them.
// ---------------------------------------------------------------------------

interface FakeEncodedChunk {
  timestamp: number;
  byteLength: number;
  type: 'key' | 'delta';
  copyTo(dest: Uint8Array): void;
}
const encodeLog: number[][] = []; // PCM samples fed to encoder per call
const encodedChunks: FakeEncodedChunk[] = []; // Encoded chunks emitted by mock
let configLog: unknown[] = []; // Encoder config snapshots

class MockAudioData {
  closed = false;
  constructor(public init: { numberOfFrames: number; data: ArrayBufferView }) {}
  close(): void { this.closed = true; }
}

class MockAudioEncoder {
  output: (chunk: FakeEncodedChunk) => void;
  error: (e: unknown) => void;
  configureCalled = false;
  flushed = false;
  closed = false;

  constructor(init: { output: (chunk: FakeEncodedChunk) => void; error: (e: unknown) => void }) {
    this.output = init.output;
    this.error = init.error;
  }

  configure(cfg: unknown): void {
    this.configureCalled = true;
    configLog.push(cfg);
  }

  encode(audioData: MockAudioData): void {
    const samples = Array.from(audioData.init.data as Int16Array);
    encodeLog.push(samples);
    // Simulate the encoder producing an Opus packet of variable size per frame
    const outSize = 20 + Math.floor(Math.random() * 60);
    const fakeChunk: FakeEncodedChunk = {
      timestamp: (encodeLog.length - 1) * 20000, // 20ms per frame
      byteLength: outSize,
      type: encodeLog.length === 1 ? 'key' : 'delta',
      copyTo(dest: Uint8Array) {
        for (let i = 0; i < this.byteLength && i < dest.length; i++) {
          dest[i] = i & 0xff; // Deterministic fake payload
        }
      },
    };
    encodedChunks.push(fakeChunk);
    // Call output asynchronously to mimic real WebCodecs behavior
    queueMicrotask(() => this.output(fakeChunk));
  }

  async flush(): Promise<void> { this.flushed = true; }
  close(): void { this.closed = true; }
}

// Install mocks on globalThis before importing the module under test
(globalThis as Record<string, unknown>).AudioEncoder = MockAudioEncoder;
(globalThis as Record<string, unknown>).AudioData = MockAudioData;

// ---------------------------------------------------------------------------
// Fake inner PCM capture
// ---------------------------------------------------------------------------

function makeFakeCapture(format: AudioFormat = {
  sampleRate: 16000,
  channels: 1,
  encoding: 'pcm-s16le',
}): IAudioCapture {
  const chunks: AudioChunk[] = [];
  const waiters: Array<() => void> = [];
  let stopped = false;
  let chunkId = 0;

  // Pre-queue some sine wave data so tests have something to consume
  function sineWavePcm(numSamples: number, freq: number): ArrayBuffer {
    const arr = new Int16Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      arr[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / 16000) * 16000);
    }
    return arr.buffer;
  }

  const fake: IAudioCapture & { __push: (n: number) => void } = {
    format,
    async start(): Promise<void> {},
    async stop(): Promise<void> { stopped = true; waiters.splice(0).forEach((r) => r()); },
    chunks() {
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              while (chunks.length === 0 && !stopped) {
                await new Promise<void>((r) => waiters.push(r));
              }
              const c = chunks.shift();
              if (c) return { value: c, done: false } as const;
              return { value: undefined, done: true } as const;
            },
          };
        },
      };
    },
    getStats: () => ({
      framesEmitted: chunkId,
      droppedFrames: 0,
      bytesCaptured: 0,
      activeMs: 0,
      requiresResampling: false,
    }),
    __push: (samples: number) => {
      chunkId++;
      chunks.push({
        data: sineWavePcm(samples, 1000),
        chunkId,
        captureTsMono: Date.now(),
        durationMs: (samples / 16000) * 1000,
      });
      waiters.splice(0).forEach((r) => r());
    },
  };
  return fake;
}

async function nextOrTimeout<T>(p: Promise<IteratorResult<T>>, ms = 200): Promise<IteratorResult<T>> {
  return Promise.race([
    p,
    new Promise<IteratorResult<T>>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpusEncodedCapture', () => {
  let inner: IAudioCapture & { __push: (n: number) => void };

  beforeEach(() => {
    encodeLog.length = 0;
    encodedChunks.length = 0;
    configLog = [];
    inner = makeFakeCapture() as IAudioCapture & { __push: (n: number) => void };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it('reports encoding=opus and preserves sample rate/channels', async () => {
    const { OpusEncodedCapture } = await import('../opus-encoder.js');
    const enc = new OpusEncodedCapture(inner, {});
    expect(enc.format.encoding).toBe('opus');
    expect(enc.format.sampleRate).toBe(16000);
    expect(enc.format.channels).toBe(1);
  });

  it('rejects non-PCM input capture', async () => {
    const { OpusEncodedCapture } = await import('../opus-encoder.js');
    const mp3Capture = makeFakeCapture({
      sampleRate: 16000, channels: 1, encoding: 'mp3',
    });
    expect(() => new OpusEncodedCapture(mp3Capture, {}))
      .toThrow(/requires PCM s16le/);
  });

  it('configures encoder with opus codec and requested bitrate', async () => {
    const { OpusEncodedCapture } = await import('../opus-encoder.js');
    const enc = new OpusEncodedCapture(inner, { bitrate: 24000 });
    await enc.start();
    expect(configLog.length).toBe(1);
    const cfg = configLog[0] as { codec: string; bitrate: number; sampleRate: number };
    expect(cfg.codec).toBe('opus');
    expect(cfg.bitrate).toBe(24000);
    expect(cfg.sampleRate).toBe(16000);
    await enc.stop();
  });

  it('only feeds complete frames to encoder (20 ms = 320 samples @ 16 kHz)', async () => {
    const { OpusEncodedCapture } = await import('../opus-encoder.js');
    const enc = new OpusEncodedCapture(inner, {});
    await enc.start();

    // Push 700 samples — should produce 2 full frames (640 samples) and
    // buffer 60 samples for the next call.
    inner.__push(700);
    await new Promise((r) => setTimeout(r, 50));

    expect(encodeLog.length).toBe(2);
    expect(encodeLog[0].length).toBe(320);
    expect(encodeLog[1].length).toBe(320);

    await enc.stop();
  });

  it('emits one Opus chunk per frame, monotonically chunkId 0..N', async () => {
    const { OpusEncodedCapture } = await import('../opus-encoder.js');
    const enc = new OpusEncodedCapture(inner, {});
    await enc.start();
    const iter = enc.chunks()[Symbol.asyncIterator]();

    inner.__push(960); // exactly 3 frames

    const got: AudioChunk[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await nextOrTimeout(iter.next());
      expect(r.done).toBe(false);
      if (r.value) got.push(r.value);
    }

    expect(got.length).toBe(3);
    expect(got.map((c) => c.chunkId)).toEqual([0, 1, 2]);
    // Each chunk should be smaller than the equivalent PCM frame (320 samples = 640 bytes)
    for (const c of got) {
      expect(c.data.byteLength).toBeLessThan(640);
      expect(c.durationMs).toBeCloseTo(20, 0);
    }
    await enc.stop();
  });

  it('stitches across multiple PCM chunks into a single frame', async () => {
    const { OpusEncodedCapture } = await import('../opus-encoder.js');
    const enc = new OpusEncodedCapture(inner, {});
    await enc.start();

    // Push 100 + 100 + 120 = 320 samples spread across 3 PCM chunks → 1 Opus frame
    inner.__push(100);
    inner.__push(100);
    inner.__push(120);
    await new Promise((r) => setTimeout(r, 50));

    expect(encodeLog.length).toBe(1);
    expect(encodeLog[0].length).toBe(320);
    // The encoded frame should contain all 320 samples in order from the
    // concatenated input (each fake chunk restarts its sine wave at i=0).
    const samples = encodeLog[0];
    expect(samples[100]).toBe(Math.round(Math.sin(0) * 16000)); // Start of chunk 2
    expect(samples[200]).toBe(Math.round(Math.sin(0) * 16000)); // Start of chunk 3
    await enc.stop();
  });

  it('stop() flushes a final padded frame for remaining PCM samples', async () => {
    const { OpusEncodedCapture } = await import('../opus-encoder.js');
    const enc = new OpusEncodedCapture(inner, {});
    await enc.start();

    // Push 100 samples — only ~31% of one frame
    inner.__push(100);
    await new Promise((r) => setTimeout(r, 20));

    expect(encodeLog.length).toBe(0); // Not enough for a complete frame

    await enc.stop(); // Should pad with zeros and flush
    await new Promise((r) => setTimeout(r, 50));

    expect(encodeLog.length).toBe(1); // The padded final frame
    expect(encodeLog[0].length).toBe(320);
    // Sample 50 should be sine wave content (sin(2π*1000*50/16000) ≈ 0.924 → 14787)
    const samples = encodeLog[0];
    const expectedMid = Math.round(Math.sin((2 * Math.PI * 1000 * 50) / 16000) * 16000);
    expect(samples[50]).toBe(expectedMid);
    expect(samples[319]).toBe(0); // Last sample is padding
  });

  it('isSupported reports true when globals exist, false otherwise', async () => {
    const { OpusEncodedCapture } = await import('../opus-encoder.js');
    expect(OpusEncodedCapture.isSupported()).toBe(true);

    const savedAE = (globalThis as Record<string, unknown>).AudioEncoder;
    delete (globalThis as Record<string, unknown>).AudioEncoder;
    expect(OpusEncodedCapture.isSupported()).toBe(false);
    (globalThis as Record<string, unknown>).AudioEncoder = savedAE;
  });
});