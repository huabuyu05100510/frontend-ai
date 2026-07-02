/**
 * WebAudioCapture — Pillar #1 browser implementation.
 *
 * Wraps AudioWorklet with SharedArrayBuffer ring buffer when available, falls
 * back to MessagePort chunk transfer otherwise. Implements IAudioCapture.
 */

import type {
  IAudioCapture,
  AudioChunk,
  AudioFormat,
  CaptureStartOptions,
  CaptureStats,
} from '@voice-kit/core-types';

const DEFAULT_PROCESSOR_URL = '/capture-processor.js';

export interface WebAudioCaptureOptions {
  /** Override URL for the AudioWorklet processor module */
  processorUrl?: string;
  /** Target sample rate (down/up-sample from hardware rate) */
  targetRate?: 8000 | 16000 | 24000 | 44100 | 48000;
  /** Ring buffer capacity in samples (default: 4s at targetRate) */
  capacitySeconds?: number;
  /** Skip SAB even when available (debug) */
  disableSAB?: boolean;
}

export class WebAudioCapture implements IAudioCapture {
  readonly format: AudioFormat;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private dataSAB: SharedArrayBuffer | null = null;
  private indexSAB: SharedArrayBuffer | null = null;
  private capacity: number;
  private targetRate: number;
  private chunksEmitted = 0;
  private droppedFrames = 0;
  private bytesCaptured = 0;
  private activeStartedAt = 0;
  private chunkQueue: AudioChunk[] = [];
  private waiters: Array<() => void> = [];
  private sabConsumerStarted = false;
  private sabConsumerStopped = false;

  constructor(private opts: WebAudioCaptureOptions = {}) {
    this.targetRate = opts.targetRate ?? 16000;
    this.capacity = opts.capacitySeconds
      ? opts.capacitySeconds * this.targetRate
      : this.targetRate * 4;
    this.format = {
      sampleRate: this.targetRate as 8000 | 16000 | 24000 | 44100 | 48000,
      channels: 1,
      encoding: 'pcm-s16le',
    };
  }

  async start(opts: CaptureStartOptions = {}): Promise<void> {
    if (this.ctx) throw new Error('Capture already started');

    // Wire AbortSignal: abort → stop capture.
    if (opts.signal) {
      if (opts.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      opts.signal.addEventListener('abort', () => { void this.stop(); }, { once: true });
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: opts.echoCancellation ?? true,
        noiseSuppression: opts.noiseSuppression ?? true,
        autoGainControl: opts.autoGainControl ?? true,
        channelCount: 1,
      },
    });

    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule(
      this.opts.processorUrl ?? DEFAULT_PROCESSOR_URL
    );
    this.ctx = ctx;

    // Try SAB if crossOriginIsolated and not disabled
    const canSAB =
      !this.opts.disableSAB &&
      typeof SharedArrayBuffer !== 'undefined' &&
      typeof self !== 'undefined' &&
      (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated;

    let processorOptions: Record<string, unknown> = {
      targetRate: this.targetRate,
      capacity: this.capacity,
    };

    if (canSAB) {
      this.dataSAB = new SharedArrayBuffer(this.capacity * 2); // Int16 = 2 bytes
      this.indexSAB = new SharedArrayBuffer(16 * 4); // 16 Int32 slots = 1 cache line
      const idx = new Int32Array(this.indexSAB);
      idx.fill(0);
      processorOptions = { ...processorOptions, dataSAB: this.dataSAB, indexSAB: this.indexSAB };
    }

    const source = ctx.createMediaStreamSource(this.stream);
    const worklet = new AudioWorkletNode(ctx, 'vk-capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      processorOptions,
    });
    source.connect(worklet);
    this.source = source;
    this.worklet = worklet;

    worklet.port.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'chunk') {
        this.pushChunk({
          data: msg.data,
          chunkId: msg.chunkId,
          captureTsMono: msg.captureTsMono,
          durationMs: (msg.data.byteLength / 2 / this.targetRate) * 1000,
        });
      } else if (msg.type === 'underrun') {
        this.droppedFrames++;
      }
    };

    this.activeStartedAt = performance.now();

    if (canSAB) {
      this.startSABConsumer();
    }
  }

  async stop(): Promise<void> {
    this.sabConsumerStopped = true;
    try {
      this.worklet?.port.close();
      this.worklet?.disconnect();
      this.source?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      await this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.worklet = null;
    this.source = null;
    this.stream = null;
    // Wake pending chunk iterators
    const w = this.waiters;
    this.waiters = [];
    w.forEach((r) => r());
  }

  chunks(): AsyncIterable<AudioChunk> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<AudioChunk>> {
            while (true) {
              const c = self.chunkQueue.shift();
              if (c) return { value: c, done: false };
              if (self.sabConsumerStopped && self.chunkQueue.length === 0) {
                return { value: undefined, done: true };
              }
              await new Promise<void>((r) => self.waiters.push(r));
            }
          },
        };
      },
    };
  }

  getStats(): CaptureStats {
    return {
      framesEmitted: this.chunksEmitted,
      droppedFrames: this.droppedFrames,
      bytesCaptured: this.bytesCaptured,
      activeMs: this.activeStartedAt ? performance.now() - this.activeStartedAt : 0,
      requiresResampling:
        this.ctx?.sampleRate !== undefined && this.ctx.sampleRate !== this.targetRate,
    };
  }

  // -------------------------------------------------------------------------
  // SAB consumer — runs on main thread using Atomics.waitAsync when available,
  // falling back to setTimeout polling on older browsers.
  //
  // Index layout (Int32Array over indexSAB):
  //   slot 0 — writePos  : AudioWorklet write cursor (ring buffer position)
  //   slot 1 — readPos   : consumer read cursor (acknowledged back to worklet)
  //   slot 2 — chunkId   : monotonically incremented on every new chunk write;
  //                         Atomics.waitAsync watches this slot for changes.
  // -------------------------------------------------------------------------

  private startSABConsumer(): void {
    if (this.sabConsumerStarted || !this.dataSAB || !this.indexSAB) return;
    this.sabConsumerStarted = true;
    const data = new Int16Array(this.dataSAB);
    const idx = new Int32Array(this.indexSAB);
    let readPos = 0;
    let lastChunkId = 0;

    const CHUNK_ID_SLOT = 2;

    /** Drain any available data from the ring buffer and emit a chunk. */
    const processAvailable = () => {
      const writePos = Atomics.load(idx, 0);
      const chunkId = Atomics.load(idx, CHUNK_ID_SLOT);
      if (chunkId === lastChunkId) return;
      lastChunkId = chunkId;
      let len = writePos - readPos;
      if (len < 0) len += this.capacity;
      if (len <= 0) return;
      const chunk = new Int16Array(len);
      for (let i = 0; i < len; i++) {
        chunk[i] = data[(readPos + i) % this.capacity];
      }
      readPos = writePos;
      Atomics.store(idx, 1, readPos);
      this.pushChunk({
        data: chunk.buffer,
        chunkId,
        captureTsMono: performance.now(),
        durationMs: (len / this.targetRate) * 1000,
      });
    };

    // Prefer Atomics.waitAsync (Chrome 87+, no main-thread polling overhead).
    // TypeScript's lib.dom.d.ts doesn't yet include waitAsync, so we use an
    // explicit feature-detect + type-cast.
    const atomicsWaitAsync = (
      typeof Atomics !== 'undefined' &&
      typeof (Atomics as unknown as Record<string, unknown>)['waitAsync'] === 'function'
    )
      ? (Atomics as unknown as {
          waitAsync(
            ta: Int32Array,
            index: number,
            value: number,
            timeoutMs?: number
          ): { value: Promise<'ok' | 'not-equal' | 'timed-out'> };
        }).waitAsync.bind(Atomics)
      : null;

    if (atomicsWaitAsync) {
      // Zero-poll path: Atomics.waitAsync suspends until AudioWorklet notifies.
      // A 200 ms timeout lets the loop exit promptly after stop() is called.
      const loop = async () => {
        while (!this.sabConsumerStopped) {
          try {
            const expected = Atomics.load(idx, CHUNK_ID_SLOT);
            processAvailable();
            await atomicsWaitAsync(idx, CHUNK_ID_SLOT, expected, 200).value;
          } catch (e) {
            // SAB-backed Atomics.waitAsync can throw TypeError on some
            // browsers if the buffer isn't actually cross-agent-shareable
            // (e.g., a stale SharedArrayBuffer after cross-origin isolation
            // changes). Surface via observability + console so the user can
            // tell capture broke without rawCount moving.
            console.error('[WebAudioCapture] SAB consumer loop error', e);
            // Fall through to the next iteration so the loop keeps polling
            // (won't recover if SAB is permanently broken, but at least
            // keeps trying rather than dying silently).
            await new Promise<void>((r) => setTimeout(r, 100));
          }
        }
      };
      loop();
    } else {
      // Fallback: poll every 10 ms (older browsers / Safari <17.4).
      const tick = () => {
        if (this.sabConsumerStopped) return;
        try {
          processAvailable();
        } catch (e) {
          console.error('[WebAudioCapture] SAB poll tick error', e);
        }
        setTimeout(tick, 10);
      };
      tick();
    }
  }

  private pushChunk(chunk: AudioChunk): void {
    this.chunksEmitted++;
    this.bytesCaptured += chunk.data.byteLength;
    this.chunkQueue.push(chunk);
    const w = this.waiters;
    this.waiters = [];
    w.forEach((r) => r());
  }
}
