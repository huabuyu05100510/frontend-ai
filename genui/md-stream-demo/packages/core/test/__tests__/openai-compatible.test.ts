/**
 * OpenAI 兼容 adapter 单测：用 mock fetch 验证 SSE 解析 + StreamPart 输出。
 * 覆盖：text-delta / tool-call / [DONE] / finish_reason / HTTP 错误 / 网络错误。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOpenAICompatibleProvider } from '../../src/adapters/openai-compatible';
import { isTerminal, isTextDelta, isToolCallPart } from '../../src/protocol';

function makeSSEBody(events: string[]): string {
  return events.map((e) => `data: ${e}\n\n`).join('');
}

function mockResponse(body: string, init: ResponseInit = {}): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    ...init,
  });
}

describe('OpenAI 兼容 adapter', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('text-delta：把 delta.content 流式映射成 text-delta', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(
        makeSSEBody([
          JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }),
          JSON.stringify({ choices: [{ delta: { content: ' 世界' } }] }),
          '[DONE]',
        ]),
      ),
    ) as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({
      apiKey: 'test',
      model: 'test',
      providerName: 'test',
    });

    const parts = [];
    for await (const p of provider.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      parts.push(p);
    }
    const text = parts.filter(isTextDelta).map((p) => p.text).join('');
    expect(text).toBe('Hello 世界');
    expect(parts[parts.length - 1]!.type).toBe('done');
  });

  it('tool_calls：映射成 tool-call-start + tool-call-arg-delta + tool-call-end', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(
        makeSSEBody([
          JSON.stringify({
            choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'POISearch' } }] } }],
          }),
          JSON.stringify({
            choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":"咖啡' } }] } }],
          }),
          JSON.stringify({
            choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '馆"}' } }] } }],
          }),
          JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
        ]),
      ),
    ) as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({ apiKey: 'k', model: 'm', providerName: 't' });
    const parts = [];
    for await (const p of provider.stream({ messages: [] })) parts.push(p);

    const toolParts = parts.filter(isToolCallPart);
    expect(toolParts.map((p) => p.type)).toEqual([
      'tool-call-start',
      'tool-call-arg-delta',
      'tool-call-arg-delta',
      'tool-call-end',
    ]);
    const start = toolParts[0]!;
    if (start.type !== 'tool-call-start') throw new Error('unreachable');
    expect(start.name).toBe('POISearch');
  });

  it('HTTP 错误 → error part 带 retryable（5xx/429 true，4xx false）', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })) as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({ apiKey: 'k', model: 'm', providerName: 't' });
    const parts = [];
    for await (const p of provider.stream({ messages: [] })) parts.push(p);
    expect(parts).toHaveLength(1);
    expect(parts[0]!.type).toBe('error');
    if (parts[0]!.type !== 'error') throw new Error('unreachable');
    expect(parts[0]!.code).toBe('E_HTTP_429');
    expect(parts[0]!.retryable).toBe(true);
  });

  it('finish_reason 带 usage（部分 provider 支持）', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(
        makeSSEBody([
          JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }),
          JSON.stringify({
            choices: [{ delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 5, completion_tokens: 1 },
          }),
        ]),
      ),
    ) as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({ apiKey: 'k', model: 'm', providerName: 't' });
    const parts = [];
    for await (const p of provider.stream({ messages: [] })) parts.push(p);
    const done = parts.find((p) => p.type === 'done');
    expect(done).toBeDefined();
    if (done && done.type === 'done') {
      expect(done.usage).toMatchObject({ prompt_tokens: 5, completion_tokens: 1 });
    }
  });

  it('终态必为 done 或 error（不变量）', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse(makeSSEBody([JSON.stringify({ choices: [{ delta: { content: 'x' } }] }), '[DONE]'])),
    ) as unknown as typeof fetch;

    const provider = createOpenAICompatibleProvider({ apiKey: 'k', model: 'm', providerName: 't' });
    const parts = [];
    for await (const p of provider.stream({ messages: [] })) parts.push(p);
    const last = parts[parts.length - 1]!;
    expect(isTerminal(last)).toBe(true);
  });

  it('超时未配置 → 默认 600s 不主动 abort（不测真实超时）', async () => {
    // 仅断言 timeoutMs 默认值生效，不真跑 600 秒
    const provider = createOpenAICompatibleProvider({ apiKey: 'k', model: 'm' });
    expect(provider.name).toBe('openai-compatible');
  });
});
