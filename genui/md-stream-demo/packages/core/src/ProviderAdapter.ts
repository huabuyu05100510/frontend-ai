/**
 * ProviderAdapter —— 统一 LLM provider 接口。
 *
 * 对标：
 *   - Vercel AI SDK LanguageModelV1（doStream/doGenerate 抽象）
 *   - LangChain.js BaseChatModel
 *   - Anthropic / OpenAI SDK 的 streaming 接口族
 *
 * 业务侧只面对 ChatMessage 与 StreamPart，不关心是哪家 LLM。
 * 新增 provider = 写一个 createXxxProvider 返回 ProviderAdapter。
 *
 * 不变量：
 *   - stream() 返回 AsyncIterable<StreamPart>，必须以 done 或 error 终结
 *   - signal.aborted 后异步链路尽快停止 yield（不强求同步）
 *   - 不重试：重试策略由消费侧决定（adapter 只暴露 retryable 标记）
 */

import type { StreamPart } from './protocol';
import { Part } from './protocol';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface StreamRequest {
  messages: ChatMessage[];
  signal?: AbortSignal;
  /** 业务侧声明的 tool 名（仅用于让 provider 决定是否切到 function-calling 模式） */
  tools?: string[];
}

export interface ProviderAdapter {
  readonly name: string;
  /** 异步流式迭代器；必须以 done / error 终结 */
  stream(req: StreamRequest): AsyncIterable<StreamPart>;
}

// ============================================================
// 工具：从 generator 函数构造 ProviderAdapter
// ============================================================

export function createProvider(
  name: string,
  gen: (req: StreamRequest) => AsyncGenerator<StreamPart>,
): ProviderAdapter {
  return {
    name,
    stream(req) {
      return gen(req);
    },
  };
}

// ============================================================
// Mock Provider —— 把字符串切片成 text-delta，用于离线 demo / 测试
//
// 设计要点：按 UTF-8 code point 切（不切代理对），随机每段 2-8 字符，
// 模拟 LLM token 流的不均匀节奏。这一层封装原本散落在 StreamRunner 里。
// ============================================================

export function createMockProvider(
  responder: (messages: ChatMessage[], turnIndex: number) => string,
  opts: { chunkMin?: number; chunkMax?: number; idPrefix?: string } = {},
): ProviderAdapter {
  const chunkMin = opts.chunkMin ?? 2;
  const chunkMax = opts.chunkMax ?? 8;
  const idPrefix = opts.idPrefix ?? 'mock';
  return createProvider('mock', async function* ({ messages, signal }) {
    const turnIndex = Math.max(0, messages.filter((m) => m.role === 'user').length - 1);
    const full = responder(messages, turnIndex);
    const chunks = sliceByCodePoint(full, chunkMin, chunkMax);
    for (let i = 0; i < chunks.length; i++) {
      if (signal?.aborted) return;
      // 让出主线程一小段，模拟网络节奏
      await microYield();
      yield Part.textDelta(`${idPrefix}-${i}`, chunks[i]!);
    }
    if (signal?.aborted) return;
    yield Part.done();
  });
}

// ============================================================
// 辅助：按 code point 切片（避免切坏代理对 / emoji / 4 字节 CJK）
// ============================================================

export function sliceByCodePoint(s: string, min: number, max: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const size = randInt(min, max);
    // 跳过半个代理对：String.prototype.slice 不会切坏 code point，这里仅做长度估算
    const chunk = s.slice(i, i + size);
    out.push(chunk);
    i += size;
  }
  return out;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function microYield(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
