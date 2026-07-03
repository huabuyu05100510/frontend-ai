/**
 * StreamConsumer —— 把 AsyncIterable<StreamPart> 归约成 UI 可消费的聚合视图。
 *
 * 对标：
 *   - Vercel AI SDK 的 useChat 内部状态归约
 *   - Redux 的 reducer 模式
 *   - AG-UI 的 events → state 投影
 *
 * 核心职责：
 *   - text-delta：累积成完整文本
 *   - tool-call-*：聚合成 toolCall 列表（含半截 arg）
 *   - card-*：聚合成 card 列表（含半截 body）
 *   - done / error：终态
 *
 * 这是一个纯函数 reducer，可独立单元测试；上层（React hook / Vue composable）
 * 包一层订阅即可。sdk 包不依赖任何框架。
 */

import { Part, StreamPart, isTerminal } from './protocol';

export interface ToolCallView {
  id: string;
  name?: string;
  /** 累积的 arg delta（按 argName 累积字符串） */
  argParts: Record<string, string>;
  /** 终态 args（tool-call-end 时填） */
  args?: unknown;
  done: boolean;
}

export interface CardView {
  id: string;
  lang?: string;
  /** 累积的 body 原文（半截 JSON 也保留，前端 safeParse） */
  body: string;
  done: boolean;
}

export interface StreamState {
  text: string;
  toolCalls: Record<string, ToolCallView>;
  cards: Record<string, CardView>;
  status: 'streaming' | 'done' | 'error';
  error?: { code: string; message: string; retryable?: boolean };
  usage?: { inputTokens?: number; outputTokens?: number };
}

export const initialState: StreamState = {
  text: '',
  toolCalls: {},
  cards: {},
  status: 'streaming',
};

/** reducer：给定当前 state 与一个 part，返回新 state（不可变更新）。 */
export function reduce(state: StreamState, part: StreamPart): StreamState {
  switch (part.type) {
    case 'text-delta':
      return { ...state, text: state.text + part.text };

    case 'tool-call-start':
      return {
        ...state,
        toolCalls: {
          ...state.toolCalls,
          [part.id]: { id: part.id, name: part.name, argParts: {}, done: false },
        },
      };

    case 'tool-call-arg-delta': {
      const prev = state.toolCalls[part.id] ?? {
        id: part.id,
        argParts: {},
        done: false,
      };
      return {
        ...state,
        toolCalls: {
          ...state.toolCalls,
          [part.id]: {
            ...prev,
            argParts: {
              ...prev.argParts,
              [part.argName]: (prev.argParts[part.argName] ?? '') + part.argPartial,
            },
          },
        },
      };
    }

    case 'tool-call-end': {
      const prev = state.toolCalls[part.id] ?? {
        id: part.id,
        argParts: {},
        done: false,
      };
      return {
        ...state,
        toolCalls: {
          ...state.toolCalls,
          [part.id]: { ...prev, args: part.args, done: true },
        },
      };
    }

    case 'card-start':
      return {
        ...state,
        cards: {
          ...state.cards,
          [part.id]: { id: part.id, lang: part.lang, body: '', done: false },
        },
      };

    case 'card-delta': {
      const prev = state.cards[part.id];
      if (!prev) return state;
      return {
        ...state,
        cards: {
          ...state.cards,
          [part.id]: { ...prev, body: prev.body + part.body },
        },
      };
    }

    case 'card-end': {
      const prev = state.cards[part.id];
      if (!prev) return state;
      return {
        ...state,
        cards: {
          ...state.cards,
          [part.id]: { ...prev, done: true },
        },
      };
    }

    case 'error':
      return {
        ...state,
        status: 'error',
        error: { code: part.code, message: part.message, retryable: part.retryable },
      };

    case 'done':
      return {
        ...state,
        status: 'done',
        usage: part.usage,
      };
  }
}

/** 消费完整流，返回终态。取消时返回当前累积态（零丢失不变量）。 */
export async function consumeStream(
  iter: AsyncIterable<StreamPart>,
  opts: { onPart?: (state: StreamState, part: StreamPart) => void; signal?: AbortSignal } = {},
): Promise<StreamState> {
  let state: StreamState = initialState;
  for await (const part of iter) {
    if (opts.signal?.aborted) break;
    state = reduce(state, part);
    opts.onPart?.(state, part);
    if (isTerminal(part)) break;
  }
  return state;
}

/** 辅助：把一段 markdown 字符串「广播」成纯 text-delta 流（最简 broadcasting）。 */
export function textDeltaStream(
  s: string,
  chunkSize = 4,
  idPrefix = 'b',
): AsyncIterable<StreamPart> {
  return (async function* () {
    for (let i = 0; i < s.length; i += chunkSize) {
      yield Part.textDelta(`${idPrefix}-${i}`, s.slice(i, i + chunkSize));
    }
    yield Part.done();
  })();
}
