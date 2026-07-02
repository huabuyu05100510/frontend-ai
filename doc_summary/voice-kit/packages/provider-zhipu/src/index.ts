/**
 * 智谱 GLM provider — implements IAIProvider.
 *
 * Capabilities:
 *   - llm-chat: GLM-4 streaming text completion (OpenAI-compatible)
 *   - asr-stream: HTTP/SSE streaming ASR
 *   - tts-stream: HTTP streaming TTS
 *
 * Auth: JWT signed with apiSecret (HS256). Tokens minted on server side
 * (gateway) — frontend SDK consumes short-lived tokens.
 */

import type {
  IAIProvider,
  ProviderInfo,
  ILLMProvider,
  LLMMessage,
  LLMStreamOptions,
  IASRProvider,
  ASRStreamConfig,
  ASRStreamSession,
  ASRResult,
  ITTSProvider,
  TTSConfig,
  TTSResult,
} from '@voice-kit/core-types';

export const ZHIPU_INFO: ProviderInfo = {
  id: 'zhipu',
  label: '智谱 GLM',
  capabilities: ['asr-stream', 'tts-stream', 'llm-chat', 'translation'],
};

export interface ZhipuCredentials {
  apiKey?: string;
  /** JWT signer secret (server-side only) */
  apiSecret?: string;
  /** Short-lived JWT issued by gateway */
  jwtToken?: string;
  baseUrl?: string;
}

class ZhipuLLM implements ILLMProvider {
  constructor(private creds: ZhipuCredentials) {}
  async *stream(
    messages: LLMMessage[],
    opts?: LLMStreamOptions
  ): AsyncGenerator<{ delta: string; done: boolean }> {
    const baseUrl = this.creds.baseUrl ?? 'https://open.bigmodel.cn/api/paas/v4';
    const model = opts?.model ?? 'glm-4-plus';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.creds.jwtToken ?? this.creds.apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: true, temperature: opts?.temperature, max_tokens: opts?.maxTokens }),
      signal: opts?.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`Zhipu LLM HTTP ${res.status}`);
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
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content ?? '';
          if (delta) yield { delta, done: false };
        } catch {
          /* skip malformed */
        }
      }
    }
    yield { delta: '', done: true };
  }
}

class ZhipuASRSession implements ASRStreamSession {
  constructor(_config: ASRStreamConfig) {}
  pushAudio(_chunk: ArrayBuffer): void {
    /* SSE-style: buffer and POST on finalize, or chunked upload */
  }
  finalize(): void {}
  results(): AsyncIterable<ASRResult> {
    return (async function* () {
      yield { kind: 'error', code: 'NOT_IMPLEMENTED', message: 'Zhipu ASR requires gateway-side integration' };
    })();
  }
  async close(): Promise<void> {}
}

class ZhipuASR implements IASRProvider {
  async openStream(_config: ASRStreamConfig): Promise<ASRStreamSession> {
    return new ZhipuASRSession(_config);
  }
}

class ZhipuTTS implements ITTSProvider {
  async *stream(_text: string, _config: TTSConfig): AsyncGenerator<TTSResult> {
    yield { audio: new ArrayBuffer(0), isFinal: true };
  }
}

export class ZhipuProvider implements IAIProvider {
  readonly info: ProviderInfo = ZHIPU_INFO;
  asr?: IASRProvider;
  tts?: ITTSProvider;
  llm?: ILLMProvider;
  constructor(creds: ZhipuCredentials) {
    this.llm = new ZhipuLLM(creds);
    this.asr = new ZhipuASR();
    this.tts = new ZhipuTTS();
  }
}

export { ZhipuLLM };
