/**
 * A2UI Stream Protocol —— LLM 流式数据传输的类型安全契约。
 *
 * 对标：
 *   - Vercel AI SDK v5  Data Stream Protocol（stream parts discriminated union）
 *   - AG-UI Protocol     （Agent-User Interaction 事件规范）
 *   - Anthropic SDK      （input_json_delta / message_delta 事件族）
 *
 * 设计原则（14 年专家视角）：
 *   1. Discriminated Union + exhaustive switch：TS narrowing 自动收敛，漏分支编译期报错。
 *   2. SSE wire 编码可读（event: / data:），与纯文本 SSE 后向兼容。
 *   3. 不变量可测：encode → decode === identity（property test 守护）。
 *   4. 零依赖、框架无关、纯函数 —— src/sdk/ 不 import React，可独立搬到 Node / RN / 边缘函数。
 *   5. id 贯穿：每个流单元（文本块 / 工具调用 / 卡片）都有稳定 id，前端用作 React key 防重渲。
 *
 * 三个跨业务不变量（property test 守护）：
 *   - 流式等价：多次 yield 拼接 == 一次性 payload
 *   - 半截安全：任意 prefix 都能被 UI 安全渲染（不抛错）
 *   - 取消零丢失：AbortSignal 触发后，已 yield 的 part 不丢
 */

// ============================================================
// 1. StreamPart 联合类型 —— 协议核心
// ============================================================

export type StreamPart =
  | { type: 'text-delta'; id: string; text: string }
  | { type: 'tool-call-start'; id: string; name: string }
  | { type: 'tool-call-arg-delta'; id: string; argName: string; argPartial: string }
  | { type: 'tool-call-end'; id: string; args: unknown }
  | { type: 'card-start'; id: string; lang: string }
  | { type: 'card-delta'; id: string; body: string }
  | { type: 'card-end'; id: string }
  | { type: 'error'; code: string; message: string; retryable?: boolean }
  | { type: 'done'; usage?: { inputTokens?: number; outputTokens?: number } };

export type StreamPartType = StreamPart['type'];

/** 全部 part 类型字面量，用于协议自检 / 文档生成 */
export const ALL_PART_TYPES: readonly StreamPartType[] = [
  'text-delta',
  'tool-call-start',
  'tool-call-arg-delta',
  'tool-call-end',
  'card-start',
  'card-delta',
  'card-end',
  'error',
  'done',
] as const;

// ============================================================
// 2. 类型守卫 —— 让消费侧 switch 优雅收敛
// ============================================================

type PartOfType<T extends StreamPartType> = Extract<StreamPart, { type: T }>;

export function isPart<T extends StreamPartType>(
  p: StreamPart,
  type: T,
): p is PartOfType<T> {
  return p.type === type;
}

export function isTextDelta(p: StreamPart): p is PartOfType<'text-delta'> {
  return p.type === 'text-delta';
}

export function isToolCallPart(
  p: StreamPart,
): p is PartOfType<'tool-call-start'> | PartOfType<'tool-call-arg-delta'> | PartOfType<'tool-call-end'> {
  return (
    p.type === 'tool-call-start' ||
    p.type === 'tool-call-arg-delta' ||
    p.type === 'tool-call-end'
  );
}

export function isCardPart(
  p: StreamPart,
): p is PartOfType<'card-start'> | PartOfType<'card-delta'> | PartOfType<'card-end'> {
  return p.type === 'card-start' || p.type === 'card-delta' || p.type === 'card-end';
}

export function isTerminal(p: StreamPart): p is PartOfType<'done'> | PartOfType<'error'> {
  return p.type === 'done' || p.type === 'error';
}

// ============================================================
// 3. SSE wire 编码 / 解码
//
// 把 StreamPart 序列化为 SSE event block（与 EventSource 兼容）：
//   event: text-delta
//   data: {"id":"t1","text":"你好"}
//
// 双换行分隔事件，与 SSE 规范一致；可被本仓库 SSEParser 直接消费。
// ============================================================

export function encodePart(p: StreamPart): string {
  const { type, ...payload } = p;
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/** 解析单个 SSE event block（已由 SSEParser 切好）。block.data 是 JSON 字符串。 */
export function decodePart(block: { event: string; data: string }): StreamPart {
  const type = block.event as StreamPartType;
  if (!ALL_PART_TYPES.includes(type)) {
    throw new DecodeError(`unknown stream part type: ${type}`);
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(block.data);
  } catch (e) {
    throw new DecodeError(`invalid JSON in stream part data: ${(e as Error).message}`);
  }
  // 把 type 拼回；其他字段原样保留。运行时校验由消费侧 invariant test 兜底。
  return { type, ...(payload as Omit<StreamPart, 'type'>) } as StreamPart;
}

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

// ============================================================
// 4. 工厂函数 —— 业务侧构造 part 用，避免拼对象出错
// ============================================================

export const Part = {
  textDelta(id: string, text: string): StreamPart {
    return { type: 'text-delta', id, text };
  },
  toolCallStart(id: string, name: string): StreamPart {
    return { type: 'tool-call-start', id, name };
  },
  toolCallArgDelta(id: string, argName: string, argPartial: string): StreamPart {
    return { type: 'tool-call-arg-delta', id, argName, argPartial };
  },
  toolCallEnd(id: string, args: unknown): StreamPart {
    return { type: 'tool-call-end', id, args };
  },
  cardStart(id: string, lang: string): StreamPart {
    return { type: 'card-start', id, lang };
  },
  cardDelta(id: string, body: string): StreamPart {
    return { type: 'card-delta', id, body };
  },
  cardEnd(id: string): StreamPart {
    return { type: 'card-end', id };
  },
  error(code: string, message: string, retryable = false): StreamPart {
    return { type: 'error', code, message, retryable };
  },
  done(usage?: { inputTokens?: number; outputTokens?: number }): StreamPart {
    return { type: 'done', usage };
  },
} as const;
