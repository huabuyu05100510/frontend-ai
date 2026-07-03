/**
 * OpenAI 兼容协议 Adapter —— 一份实现覆盖：
 *   OpenAI / MiniMax / DeepSeek / 通义 Qwen / 豆包 / Kimi / GLM（智谱）
 *
 * 这些 provider 都遵循 OpenAI Chat Completions 流式协议：
 *   POST {baseUrl}/chat/completions
 *   body: { model, messages, stream: true, tools? }
 *   resp: text/event-stream，每事件 data: {choices:[{delta:{content, tool_calls}}]}
 *   终止：data: [DONE]
 *
 * Adapter 把它们统一映射成 StreamPart：
 *   delta.content           → text-delta
 *   delta.tool_calls[].function.name → tool-call-start
 *   delta.tool_calls[].function.arguments → tool-call-arg-delta（按 index 分流）
 *   [DONE] / finish_reason  → done
 *   非 200 / 解析错          → error(retryable)
 *
 * 零依赖：直接用浏览器原生 fetch + TextDecoder + 内联 SSE 切块（30 行）。
 */

import type { ProviderAdapter, StreamRequest, ChatMessage } from '../ProviderAdapter';
import { createProvider } from '../ProviderAdapter';
import { Part } from '../protocol';

export interface OpenAICompatibleOptions {
  apiKey: string;
  /** 完整端点 URL（设置后忽略 baseUrl；用于 Edge Function 代理隐藏 key） */
  endpoint?: string;
  /** 默认 https://api.openai.com/v1 */
  baseUrl?: string;
  model: string;
  /** 自定义 header（如 org id / project id） */
  headers?: Record<string, string>;
  /** 请求超时 ms（默认 600000 = 10 分钟，LLM 长流式） */
  timeoutMs?: number;
  /** provider 显示名（用于 telemetry） */
  providerName?: string;
}

const DEFAULT_TIMEOUT = 600_000;

export function createOpenAICompatibleProvider(
  opts: OpenAICompatibleOptions,
): ProviderAdapter {
  const url = opts.endpoint ?? `${opts.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`;
  const useEdge = Boolean(opts.endpoint);
  const name = opts.providerName ?? 'openai-compatible';

  return createProvider(name, async function* ({ messages, signal, tools }: StreamRequest) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...opts.headers,
    };
    if (!useEdge) headers.Authorization = `Bearer ${opts.apiKey}`;

    const body = JSON.stringify({
      model: opts.model,
      messages: messages.map(toOpenAIMessage),
      stream: true,
      ...(tools && tools.length > 0 ? { tools: tools.map((t) => ({ type: 'function', function: { name: t } })) } : {}),
    });

    const timeoutCtrl = new AbortController();
    const timeoutId = setTimeout(() => timeoutCtrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
    // 任一信号触发：合并 abort
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutCtrl.signal])
      : timeoutCtrl.signal;

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: combinedSignal,
      });
    } catch (e) {
      clearTimeout(timeoutId);
      if (isAbort(e)) return;
      yield Part.error('E_NETWORK', errMsg(e), true);
      return;
    }

    if (!resp.ok) {
      clearTimeout(timeoutId);
      const text = await resp.text().catch(() => '');
      const retryable = resp.status >= 500 || resp.status === 429;
      yield Part.error(`E_HTTP_${resp.status}`, `provider ${name} ${resp.status}: ${text.slice(0, 200)}`, retryable);
      return;
    }

    if (!resp.body) {
      clearTimeout(timeoutId);
      yield Part.error('E_NO_BODY', `provider ${name} returned no body`, false);
      return;
    }

    // 内联 SSE 切块（避免引外部依赖）：跨 chunk 行边界 + [DONE] 终止
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let lineBuf = '';
    const toolCallState = new Map<number, { id: string; name: string }>();

    try {
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (e) {
          if (isAbort(e)) return;
          yield Part.error('E_READ', errMsg(e), true);
          return;
        }
        if (chunk.done) break;
        lineBuf += decoder.decode(chunk.value, { stream: true });

        let nl: number;
        while ((nl = lineBuf.indexOf('\n')) >= 0) {
          const rawLine = lineBuf.slice(0, nl);
          lineBuf = lineBuf.slice(nl + 1);
          const line = rawLine.replace(/\r$/, '').trim();
          if (!line) continue;
          if (line.startsWith(':')) continue; // SSE comment
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            clearTimeout(timeoutId);
            yield Part.done();
            return;
          }
          try {
            const json = JSON.parse(data);
            const choice = json.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta ?? {};

            if (typeof delta.content === 'string' && delta.content.length > 0) {
              yield Part.textDelta(`t-${Math.random().toString(36).slice(2, 9)}`, delta.content);
            }

            if (Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx: number = tc.index ?? 0;
                const fn = tc.function ?? {};
                let state = toolCallState.get(idx);
                if (fn.name && !state) {
                  state = { id: tc.id ?? `call_${idx}`, name: fn.name };
                  toolCallState.set(idx, state);
                  yield Part.toolCallStart(state.id, state.name);
                }
                if (typeof fn.arguments === 'string' && fn.arguments.length > 0 && state) {
                  // OpenAI 协议是整段 arguments delta 流式；按整段切两个字段名粒度
                  yield Part.toolCallArgDelta(state.id, 'arguments', fn.arguments);
                }
              }
            }

            if (choice.finish_reason) {
              // 把累积的 tool-call 收尾
              for (const [, st] of toolCallState) {
                yield Part.toolCallEnd(st.id, { _pending: true });
              }
              toolCallState.clear();
              clearTimeout(timeoutId);
              yield Part.done({ ...(json.usage ?? {}) });
              return;
            }
          } catch {
            // 单事件 JSON 解析失败跳过，继续消费下一事件（容错）
            continue;
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }

    // 流自然结束（无 [DONE] 无 finish_reason）
    yield Part.done();
  });
}

// ============================================================
// 预置快捷工厂
// ============================================================

export function createOpenAIProvider(apiKey: string, model = 'gpt-4o-mini'): ProviderAdapter {
  return createOpenAICompatibleProvider({
    apiKey,
    baseUrl: 'https://api.openai.com/v1',
    model,
    providerName: 'openai',
  });
}

export function createMiniMaxProvider(apiKey: string, model = 'MiniMax-Text-01'): ProviderAdapter {
  return createOpenAICompatibleProvider({
    apiKey,
    baseUrl: 'https://api.minimaxi.com/v1',
    model,
    providerName: 'minimax',
  });
}

export function createDeepSeekProvider(apiKey: string, model = 'deepseek-chat'): ProviderAdapter {
  return createOpenAICompatibleProvider({
    apiKey,
    baseUrl: 'https://api.deepseek.com/v1',
    model,
    providerName: 'deepseek',
  });
}

export function createQwenProvider(apiKey: string, model = 'qwen-plus'): ProviderAdapter {
  return createOpenAICompatibleProvider({
    apiKey,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model,
    providerName: 'qwen',
  });
}

// ============================================================
// 内部辅助
// ============================================================

function toOpenAIMessage(m: ChatMessage): { role: string; content: string } {
  return { role: m.role, content: m.content };
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException
    ? e.name === 'AbortError'
    : e instanceof Error && e.name === 'AbortError';
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
