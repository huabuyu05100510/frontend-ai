/**
 * OpusEncoder — Pillar #4 browser implementation.
 *
 * Wraps any IAudioCapture that emits PCM s16le and re-emits the audio as
 * Opus-encoded chunks via the WebCodecs AudioEncoder. Reduces uplink bandwidth
 * from 256 kbps (raw PCM) to ~32 kbps (Opus) — an 8x reduction that materially
 * helps weak-network scenarios.
 *
 * Browser support (Aug 2026 baseline):
 *   - Chrome 94+ / Edge 94+ : full support
 *   - Safari 16.4+          : full support
 *   - Firefox               : NOT supported (no WebCodecs AudioEncoder)
 *   → Use `OpusEncoder.isSupported()` to feature-detect; callers must decide
 *     whether to fall back to raw PCM or refuse the call.
 *
 * Implementation notes:
 *   - Opus frames must be aligned to a fixed duration (2.5/5/10/20/40/60 ms).
 *     Capture chunks arrive at AudioWorklet quanta (~2.7 ms) and do NOT align,
 *     so we maintain a sliding PCM buffer that emits complete frames only.
 *   - Encoder output is async; we queue EncodedAudioChunks and surface them
 *     through the same AsyncIterable API the inner capture uses.
 *   - `chunkId` is renumbered 0..N for the Opus stream (independent of the
 *     inner PCM chunkIds) since one PCM chunk can yield zero or many Opus
 *     frames depending on alignment.
 */

import type {
  IAudioCapture,
  AudioChunk,
  AudioFormat,
  CaptureStartOptions,
  CaptureStats,
} from '@voice-kit/core-types';

// WebCodecs types are now in TS lib.dom.d.ts (since TS 5.4); the global
// AudioEncoder, AudioData, and EncodedAudioChunk classes are available.
// We rely on the standard DOM lib types here.

export interface OpusEncoderOptions {
  /** Target bitrate in bits per second (default 32000 — near-transparent for voice) */
  bitrate?: number;
  /** Opus frame duration; smaller = lower latency, larger = better compression. Default 20 ms. */
  frameDurationMs?: 2.5 | 5 | 10 | 20 | 40 | 60;
}

export class OpusEncodedCapture implements IAudioCapture {
  readonly format: AudioFormat;

  private encoder: AudioEncoder | null = null;
  private readonly outputQueue: AudioChunk[] = [];
  private readonly outputWaiters: Array<() => void> = [];

  private pcmBuffer: Int16Array = new Int16Array(0);
  private readonly frameSize: number;
  private readonly frameDurationUs: number;
  private nextChunkId = 0;
  private nextFrameTimestampUs = 0;
  private captureStartMs = 0;

  private consumerStopped = false;
  private consumerError: unknown = null;
  private innerIter: AsyncIterator<AudioChunk> | null = null;

  private stats: {
    bytesCaptured: number;
    bytesEmitted: number;
    framesEmitted: number;
    droppedFrames: number;
    encoderErrors: number;
  } = { bytesCaptured: 0, bytesEmitted: 0, framesEmitted: 0, droppedFrames: 0, encoderErrors: 0 };

  constructor(
    private readonly inner: IAudioCapture,
    private readonly opts: OpusEncoderOptions = {}
  ) {
    if (inner.format.encoding !== 'pcm-s16le') {
      throw new Error(
        `OpusEncodedCapture requires PCM s16le input capture, got "${inner.format.encoding}"`
      );
    }
    const sampleRate = inner.format.sampleRate;
    const frameMs = opts.frameDurationMs ?? 20;
    this.frameSize = Math.round((sampleRate * frameMs) / 1000);
    if (this.frameSize <= 0) {
      throw new Error(`Invalid frame size: ${this.frameSize} for ${sampleRate}Hz @ ${frameMs}ms`);
    }
    this.frameDurationUs = frameMs * 1000;

    this.format = {
      sampleRate: inner.format.sampleRate,
      channels: inner.format.channels,
      encoding: 'opus',
    };
  }

  /** True iff WebCodecs AudioEncoder is available in the current runtime. */
  static isSupported(): boolean {
    return (
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as { AudioEncoder?: unknown }).AudioEncoder !== 'undefined' &&
      typeof (globalThis as { AudioData?: unknown }).AudioData !== 'undefined'
    );
  }

  async start(opts?: CaptureStartOptions): Promise<void> {
    opts = opts ?? {};
    if (!OpusEncodedCapture.isSupported()) {
      throw new Error(
        'WebCodecs AudioEncoder not available in this browser ' +
          '(Firefox or older Safari). Pass `allowPcmFallback: true` to skip Opus encoding.'
      );
    }

    this.encoder = new AudioEncoder({
      output: (chunk: EncodedAudioChunk) => this.handleEncodedChunk(chunk),
      error: (e: unknown) => {
        this.stats.encoderErrors++;
        // Re-throw asynchronously so the consumer promise rejects too
        if (this.consumerError === null) this.consumerError = e;
      },
    });

    this.encoder.configure({
      codec: 'opus',
      sampleRate: this.format.sampleRate,
      numberOfChannels: this.format.channels,
      bitrate: this.opts.bitrate ?? 32000,
    });

    this.captureStartMs = performance.now();
    this.nextFrameTimestampUs = 0;
    this.nextChunkId = 0;
    this.pcmBuffer = new Int16Array(0);

    await this.inner.start(opts);
    this.innerIter = this.inner.chunks()[Symbol.asyncIterator]();
    void this.runConsumer();
  }

  async stop(): Promise<void> {
    this.consumerStopped = true;
    // Drain remaining PCM by encoding a final (possibly partial) frame? No — we
    // only emit complete frames to keep Opus RFC-compliant. Discard leftover.
    try {
      if (this.encoder && this.pcmBuffer.length > 0) {
        // Encoder doesn't support partial frames; pad with zeros for one final frame.
        // This is fine because consumers should treat the last frame's silence tail
        // as expected.
        const padded = new Int16Array(this.frameSize);
        padded.set(this.pcmBuffer);
        const audioData = new AudioData({
          format: 's16',
          sampleRate: this.format.sampleRate,
          numberOfFrames: this.frameSize,
          numberOfChannels: this.format.channels,
          timestamp: this.nextFrameTimestampUs,
          data: padded,
        });
        try {
          this.encoder.encode(audioData);
        } finally {
          audioData.close();
        }
      }
      // Flush any pending encoded chunks
      try {
        await this.encoder?.flush();
      } catch {
        /* encoder may already be closed */
      }
      this.encoder?.close();
    } catch {
      /* swallow */
    }
    this.encoder = null;

    try {
      await this.inner.stop();
    } catch {
      /* swallow */
    }
    this.innerIter = null;

    // Wake any pending chunk iterators so they can observe done
    const w = this.outputWaiters.splice(0);
    w.forEach((r) => r());
  }

  chunks(): AsyncIterable<AudioChunk> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<AudioChunk>> {
            while (true) {
              const c = self.outputQueue.shift();
              if (c) return { value: c, done: false };
              if (self.consumerStopped) {
                return { value: undefined, done: true };
              }
              if (self.consumerError !== null) {
                throw self.consumerError;
              }
              await new Promise<void>((r) => self.outputWaiters.push(r));
            }
          },
        };
      },
    };
  }

  getStats(): CaptureStats {
    return {
      framesEmitted: this.stats.framesEmitted,
      droppedFrames: this.stats.droppedFrames,
      bytesCaptured: this.stats.bytesCaptured,
      activeMs: this.captureStartMs ? performance.now() - this.captureStartMs : 0,
      requiresResampling:
        (this.inner as { getStats?: () => CaptureStats }).getStats?.()
          ?.requiresResampling ?? false,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: consume PCM from inner capture, frame-align, encode
  // ---------------------------------------------------------------------------

  private async runConsumer(): Promise<void> {
    if (!this.innerIter) return;
    try {
      while (!this.consumerStopped) {
        const { value, done } = await this.innerIter.next();
        if (done) break;
        if (!value) continue;
        this.stats.bytesCaptured += value.data.byteLength;
        this.feedEncoder(value);
      }
    } catch (e) {
      if (this.consumerError === null) this.consumerError = e;
      const w = this.outputWaiters.splice(0);
      w.forEach((r) => r());
    }
  }

  private feedEncoder(chunk: AudioChunk): void {
    const incoming = new Int16Array(chunk.data);
    if (incoming.length === 0) return;

    // Concatenate into the sliding PCM buffer
    const combined = new Int16Array(this.pcmBuffer.length + incoming.length);
    combined.set(this.pcmBuffer, 0);
    combined.set(incoming, this.pcmBuffer.length);
    this.pcmBuffer = combined;

    // Encode as many complete frames as possible
    while (this.pcmBuffer.length >= this.frameSize && !this.consumerStopped) {
      const frameSamples = this.pcmBuffer.subarray(0, this.frameSize);
      // Copy out (AudioData may take ownership; safer not to retain the subarray)
      const frameCopy = new Int16Array(this.frameSize);
      frameCopy.set(frameSamples);
      this.pcmBuffer = this.pcmBuffer.subarray(this.frameSize);

      const audioData = new AudioData({
        format: 's16',
        sampleRate: this.format.sampleRate,
        numberOfFrames: this.frameSize,
        numberOfChannels: this.format.channels,
        timestamp: this.nextFrameTimestampUs,
        data: frameCopy,
      });
      this.nextFrameTimestampUs += this.frameDurationUs;

      try {
        this.encoder!.encode(audioData);
      } finally {
        audioData.close();
      }
    }
  }

  private handleEncodedChunk(chunk: EncodedAudioChunk): void {
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);

    // Convert microseconds back to monotonic ms for the chunk timestamp
    const captureTsMono = this.captureStartMs + chunk.timestamp / 1000;
    const durationMs = (this.frameSize / this.format.sampleRate) * 1000;

    const audioChunk: AudioChunk = {
      data: data.buffer,
      chunkId: this.nextChunkId++,
      captureTsMono,
      durationMs,
    };
    this.stats.framesEmitted++;
    this.stats.bytesEmitted += chunk.byteLength;

    this.outputQueue.push(audioChunk);
    const w = this.outputWaiters.splice(0);
    w.forEach((r) => r());
  }
}