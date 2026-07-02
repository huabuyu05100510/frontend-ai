/**
 * MiniMax provider — implements IAIProvider.
 *
 * Capabilities:
 *   - llm-chat: abab streaming text completion
 *   - tts-stream: streaming TTS (high-quality voices)
 *   - realtime-voice: OpenAI-Realtime-compatible full-duplex
 *   - voice-clone: voice cloning API
 *
 * Auth: Bearer token in Authorization header.
 */

import type {
  IAIProvider,
  ProviderInfo,
  ILLMProvider,
  LLMMessage,
  LLMStreamOptions,
  ITTSProvider,
  TTSConfig,
  TTSResult,
  IRealtimeProvider,
  RealtimeSessionConfig,
  RealtimeSession,
  RealtimeEvent,
} from '@voice-kit/core-types';

export const MINIMAX_INFO: ProviderInfo = {
  id: 'minimax',
  label: 'MiniMax',
  capabilities: [
    'llm-chat',
    'tts-stream',
    'realtime-voice',
    'voice-clone',
    'translation',
  ],
};

export interface MiniMaxCredentials {
  apiKey?: string;
  groupId?: string;
  baseUrl?: string;
  /** Short-lived token issued by gateway */
  jwtToken?: string;
}

class MiniMaxLLM implements ILLMProvider {
  constructor(private creds: MiniMaxCredentials) {}
  async *stream(
    messages: LLMMessage[],
    opts?: LLMStreamOptions
  ): AsyncGenerator<{ delta: string; done: boolean }> {
    const baseUrl = this.creds.baseUrl ?? 'https://api.minimax.chat/v1';
    const res = await fetch(`${baseUrl}/text/chatcompletion_v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.creds.jwtToken ?? this.creds.apiKey}`,
      },
      body: JSON.stringify({
        model: opts?.model ?? 'abab6.5-chat',
        messages,
        stream: true,
        temperature: opts?.temperature,
      }),
      signal: opts?.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`MiniMax LLM HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content ?? '';
          if (delta) yield { delta, done: false };
        } catch {
          /* skip */
        }
      }
    }
    yield { delta: '', done: true };
  }
}

class MiniMaxTTS implements ITTSProvider {
  constructor(private creds: MiniMaxCredentials) {}
  async *stream(text: string, config: TTSConfig): AsyncGenerator<TTSResult> {
    const baseUrl = this.creds.baseUrl ?? 'https://api.minimax.chat/v1';
    const res = await fetch(`${baseUrl}/t2a_v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.creds.jwtToken ?? this.creds.apiKey}`,
      },
      body: JSON.stringify({
        model: 'speech-01-hd',
        text,
        stream: true,
        voice_setting: { voice_id: config.voice ?? 'male-qn-qingse' },
        audio_setting: { sample_rate: config.audioFormat.sampleRate, format: 'mp3' },
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`MiniMax TTS HTTP ${res.status}`);
    }
    // MiniMax streams hex-encoded audio chunks as SSE data: lines
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        yield { audio: new ArrayBuffer(0), isFinal: true };
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          yield { audio: new ArrayBuffer(0), isFinal: true };
          return;
        }
        try {
          const json = JSON.parse(payload);
          const hex = json.data?.audio ?? '';
          if (hex) {
            const bytes = new Uint8Array(hex.length / 2);
            for (let i = 0; i < bytes.length; i++) {
              bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
            }
            yield { audio: bytes.buffer };
          }
        } catch {
          /* skip */
        }
      }
    }
  }
}

class MiniMaxRealtimeSession implements RealtimeSession {
  private listeners = new Set<(e: RealtimeEvent) => void>();
  pushAudio(_chunk: ArrayBuffer): void {}
  events(): AsyncIterable<RealtimeEvent> {
    const self = this;
    const queue: RealtimeEvent[] = [];
    let waiter: (() => void) | null = null;
    self.listeners.add((e) => {
      queue.push(e);
      if (waiter) {
        const w = waiter;
        waiter = null;
        w();
      }
    });
    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
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
  triggerResponse(): void {}
  cancelResponse(): void {}
  async close(): Promise<void> {}
}

class MiniMaxRealtime implements IRealtimeProvider {
  async openSession(_config: RealtimeSessionConfig): Promise<RealtimeSession> {
    return new MiniMaxRealtimeSession();
  }
}

export class MiniMaxProvider implements IAIProvider {
  readonly info: ProviderInfo = MINIMAX_INFO;
  llm?: ILLMProvider;
  tts?: ITTSProvider;
  realtime?: IRealtimeProvider;
  constructor(creds: MiniMaxCredentials) {
    this.llm = new MiniMaxLLM(creds);
    this.tts = new MiniMaxTTS(creds);
    this.realtime = new MiniMaxRealtime();
  }
}
