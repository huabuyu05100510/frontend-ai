/**
 * Doubao ASR streaming session — client-side.
 *
 * Connects to gateway (which signs and proxies the Volcengine WSS) using
 * the v3/sauc binary protocol. Implements IASRProvider.
 *
 * Lifecycle:
 *   openStream(config) → ASRStreamSession
 *   pushAudio(chunk)   → encode AUDIO_ONLY frame → gateway → volcengine
 *   finalize()         → encode AUDIO_LAST frame
 *   results()          → parseServerResponse → ASRResult stream
 *   close()            → close WS
 */

import type {
  IASRProvider,
  ASRStreamConfig,
  ASRStreamSession,
  ASRResult,
  IObservability,
} from '@voice-kit/core-types';
import {
  encodeFullClientRequest,
  encodeAudioOnly,
  encodeAudioLast,
  parseServerResponse,
  extractUtterances,
} from './codec';

export interface DoubaoASRClientOptions {
  /** Gateway URL, e.g. wss://my-app.com/api/asr/doubao */
  gatewayUrl: string;
  /** User id for telemetry */
  userId?: string;
  /** Optional custom WebSocket factory (for testing) */
  createWebSocket?: (url: string) => WebSocket;
  /**
   * Observability sink for RTT attribution and latency histograms.
   * When provided, each pushAudio() call stamps markCapture(chunkId) and the
   * first server response for that send-window stamps markAck(chunkId),
   * populating the 'asr.rtt.ms' HDR histogram.
   */
  observability?: IObservability;
}

export class DoubaoASRProvider implements IASRProvider {
  constructor(private opts: DoubaoASRClientOptions) {}

  async openStream(config: ASRStreamConfig): Promise<ASRStreamSession> {
    const session = new DoubaoASRSession(this.opts, config);
    await session.start();
    return session;
  }
}

class DoubaoASRSession implements ASRStreamSession {
  private ws: WebSocket;
  private resultsQueue: ASRResult[] = [];
  private resultWaiters: Array<() => void> = [];
  private closed = false;

  // RTT attribution: monotonic send counter + pending chunkId window.
  // We track the most recently sent chunkId and acknowledge it on the first
  // server result that arrives after it (best-effort approximation).
  private sendSeq = 0;
  private pendingAckChunkId: number | null = null;

  constructor(
    private opts: DoubaoASRClientOptions,
    private config: ASRStreamConfig
  ) {
    const url = new URL(opts.gatewayUrl);
    // Pass config via query string for stateless gateway
    url.searchParams.set('lang', config.language ?? 'zh-CN');
    url.searchParams.set('domain', config.domain ?? 'general');
    if (config.diarization) url.searchParams.set('diar', '1');

    const factory = opts.createWebSocket ?? ((u: string) => new WebSocket(u));
    this.ws = factory(url.toString());
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (e) => this.handleMessage(e.data);
    // Mark the session as closed on any external close (network drop, server
    // timeout, gateway shutdown) so subsequent pushAudio()/finalize() calls
    // short-circuit instead of calling ws.send() on a CLOSING/CLOSED socket.
    // Also surface the close code as an error result so consumers can show
    // actionable messages instead of "0 frames received" on missing creds
    // (gateway uses code 4401) or upstream outages (4402).
    this.ws.onclose = (e: { code: number; reason: string }) => {
      this.closed = true;
      if (e.code !== 1000 && e.code !== 1005) {
        this.pushResult({
          kind: 'error',
          code: `WS_${e.code}`,
          message: this.describeClose(e.code, e.reason),
        });
      }
      this.signalDone();
    };
    this.ws.onerror = () => {
      // Don't reject pending audio; let onclose do the bookkeeping. We just
      // surface a debug breadcrumb via observability if attached.
      this.opts.observability?.counter('asr.ws.error', {
        readyState: this.ws.readyState,
      });
    };
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        this.ws.removeEventListener('open', onOpen);
        this.sendFullRequest();
        resolve();
      };
      const onError = (e: Event) => {
        this.ws.removeEventListener('error', onError);
        reject(new Error('ASR WebSocket connect failed: ' + String(e)));
      };
      this.ws.addEventListener('open', onOpen);
      this.ws.addEventListener('error', onError);
    });
  }

  private sendFullRequest(): void {
    const payload = {
      user: { uid: this.opts.userId ?? 'anonymous', platform: 'Web' },
      audio: {
        format: 'pcm',
        codec: 'raw',
        rate: this.config.audioFormat.sampleRate,
        bits: 16,
        channel: this.config.audioFormat.channels,
      },
      request: {
        model_name: 'bigmodel',
        enable_itn: this.config.itn ?? true,
        enable_punc: this.config.punctuation ?? true,
        show_utterances: true,
        result_type: 'full',
        enable_speaker_info: this.config.diarization ?? false,
        // ssd_version="200" enables 大模型SSD (speaker separation/clustering)
        // on ASR2.0 model. Without it, upstream returns speaker_id="0" for
        // every utterance regardless of actual speakers. Requires
        // enable_speaker_info=true + language=zh-CN (or unspecified).
        // Ref: https://www.volcengine.com/docs/6561/1354869
        ...(this.config.diarization
          ? {
              ssd_version: '200',
              // enable_nonstream is required for bigmodel_async endpoint to
              // emit `definite: true` per-segment re-recognition. With it
              // off, async endpoint collapses partial utterances and
              // loses per-segment speaker info.
              enable_nonstream: true,
              ...(this.config.language ? { language: this.config.language } : {}),
            }
          : {}),
      },
    };
    const frame = encodeFullClientRequest(payload);
    this.ws.send(frame);
  }

  pushAudio(chunk: ArrayBuffer): void {
    if (this.closed) return;
    // Defense-in-depth: in-flight race between the close-flag check and the
    // ws.send() call. WebSocket may have transitioned to CLOSING/CLOSED in the
    // microtask gap. readyState check prevents InvalidStateError throw.
    if (this.ws.readyState !== WebSocket.OPEN) {
      this.closed = true;
      this.signalDone();
      return;
    }
    // Stamp RTT send-side before the actual send so latency includes encode time.
    const chunkId = ++this.sendSeq;
    this.opts.observability?.markCapture(chunkId, Date.now());
    this.pendingAckChunkId = chunkId;
    try {
      this.ws.send(encodeAudioOnly(chunk));
    } catch {
      // Socket closed between the readyState check and the send call.
      // Treat the session as closed; future calls will short-circuit.
      this.closed = true;
      this.signalDone();
    }
  }

  finalize(): void {
    if (this.closed) return;
    if (this.ws.readyState !== WebSocket.OPEN) {
      this.closed = true;
      this.signalDone();
      return;
    }
    try {
      this.ws.send(encodeAudioLast(new ArrayBuffer(0)));
    } catch {
      this.closed = true;
      this.signalDone();
    }
  }

  results(): AsyncIterable<ASRResult> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<ASRResult>> {
            while (true) {
              const r = self.resultsQueue.shift();
              if (r) return { value: r, done: false };
              if (self.closed && self.resultsQueue.length === 0) {
                return { value: undefined, done: true };
              }
              await new Promise<void>((resolve) => self.resultWaiters.push(resolve));
            }
          },
        };
      },
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
    this.signalDone();
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'object' || data === null) return;
    if (!(data instanceof ArrayBuffer)) {
      // Text frame: error message?
      try {
        const json = JSON.parse(data as unknown as string);
        this.pushResult({
          kind: 'error',
          code: String(json.code ?? 'UNKNOWN'),
          message: String(json.message ?? ''),
        });
      } catch {
        /* ignore non-JSON text */
      }
      return;
    }
    const resp = parseServerResponse(data);
    if (!resp) return;
    const payload = resp.payload as Record<string, unknown> | undefined;
    if (!payload) return;

    // Determine if this is a final/partial/full response
    const text = String((payload as { result?: { text?: string } }).result?.text ?? '');
    const utterances = extractUtterances(payload);
    const isCumulative = (payload as { result?: { type?: string } }).result?.type === 'full';

    // DEBUG speaker trace: shows what speaker info Volcengine actually returns.
    // Stringified so the console renders actual values instead of `Array(N)`.
    const resultObj = (payload as { result?: Record<string, unknown> }).result ?? {};
    const firstUtt = utterances[0] as unknown as Record<string, unknown> | undefined;
    // eslint-disable-next-line no-console
    console.log('[asr]', JSON.stringify({
      type: resultObj.type,
      utteranceCount: utterances.length,
      speakerIds: utterances.map((u) => u.rawSpeakerId),
      texts: utterances.map((u) => u.text),
      firstUtteranceKeys: firstUtt ? Object.keys(firstUtt) : [],
      firstUtteranceRaw: firstUtt,
    }));

    // RTT ack: the first server result after a pushAudio() closes the RTT window.
    if (this.pendingAckChunkId !== null) {
      this.opts.observability?.markAck(this.pendingAckChunkId, Date.now());
      this.pendingAckChunkId = null;
    }

    if (utterances.length > 0) {
      this.pushResult({
        kind: 'final',
        text,
        isCumulative,
        // Map internal ExtractedUtterance (rawSpeakerId) → public ASRUtterance
        // (speakerId). The demo + reducer downstream consume these by their
        // public-type field names. Mapping here (instead of in the consumer)
        // keeps the codec's rawSpeakerId private and avoids a leak of the
        // internal "raw_*" prefix into ASRResult consumers.
        utterances: utterances.map((u) => ({
          text: u.text,
          startMs: u.startMs,
          endMs: u.endMs,
          speakerId: u.rawSpeakerId,
          words: u.words,
          definite: u.definite,
        })),
        ts: Date.now(),
      });
    } else if (text) {
      this.pushResult({
        kind: 'partial',
        text,
        isCumulative,
        ts: Date.now(),
      });
    }
  }

  private pushResult(r: ASRResult): void {
    this.resultsQueue.push(r);
    const waiters = this.resultWaiters;
    this.resultWaiters = [];
    waiters.forEach((w) => w());
  }

  private signalDone(): void {
    const waiters = this.resultWaiters;
    this.resultWaiters = [];
    waiters.forEach((w) => w());
  }

  /**
   * Translate gateway close codes into actionable messages. The gateway uses
   * codes in the 44xx range for configuration / upstream issues; standard
   * WebSocket codes (10xx) are passed through.
   */
  private describeClose(code: number, reason: string): string {
    switch (code) {
      case 4401:
        return 'ASR gateway rejected the request: Doubao credentials are not configured on the server. Set VK_DOUBAO_APP_ID and VK_DOUBAO_API_KEY (or VK_DOUBAO_ACCESS_TOKEN) and restart the gateway.';
      case 4402:
        return 'ASR gateway could not reach upstream Volcengine. Check network egress and Volcengine service status.';
      default:
        return reason || `WebSocket closed (code ${code})`;
    }
  }
}
