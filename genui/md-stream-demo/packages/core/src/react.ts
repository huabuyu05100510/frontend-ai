/**
 * useA2UIStream —— React 绑定（基于 useSyncExternalStore，无 useState 闪烁）。
 *
 * 把 StreamConsumer reducer 的不可变 state 投影到 React，保证：
 *   - 每次 part 到达 → state 浅比较 → 仅对应族（text / toolCalls / cards）组件重渲
 *   - AbortController 集成
 *   - 组件 unmount 自动取消流
 *
 * 框架无关 core 不 import React；本文件作为独立 entry `@a2ui-stream/core/react`，
 * peerDep on react >=18。非 React 项目忽略此文件即可。
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ProviderAdapter } from './ProviderAdapter';
import type { ChatMessage } from './ProviderAdapter';
import { initialState, reduce } from './StreamConsumer';
import type { StreamState } from './StreamConsumer';
import type { StreamPart } from './protocol';

export interface UseA2UIStreamOptions {
  provider: ProviderAdapter;
  messages: ChatMessage[];
  /** 是否自动启动；false 时通过 send() 触发 */
  auto?: boolean;
  /** signal 透传给 provider.stream；外部可借此取消 */
  externalSignal?: AbortSignal;
  /** 每个 part 到达时回调（用于协议调试器） */
  onPart?: (part: StreamPart) => void;
}

export interface UseA2UIStreamResult {
  state: StreamState;
  /** 主动触发（auto=false 时用） */
  send: () => void;
  /** 主动取消 */
  cancel: () => void;
  /** 是否正在流式 */
  isStreaming: boolean;
}

/**
 * 简易 emitter（避免引外部依赖）。reducer state 不可变，每次 part 浅比较即可。
 */
function createStore() {
  let state: StreamState = initialState;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: StreamState) {
      state = next;
      listeners.forEach((l) => l());
    },
    reset() {
      state = { ...initialState };
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function useA2UIStream(opts: UseA2UIStreamOptions): UseA2UIStreamResult {
  const storeRef = useRef<ReturnType<typeof createStore> | null>(null);
  if (storeRef.current === null) storeRef.current = createStore();
  const store = storeRef.current;

  const ctrlRef = useRef<AbortController | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const [running, setRunning] = useState(false);

  const run = async () => {
    // 重置 state 并标记 running（避免上一次 run 的残留 + 解除初始 'streaming' 态的误导）
    store.reset();
    setRunning(true);
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    if (opts.externalSignal) {
      if (opts.externalSignal.aborted) ctrl.abort();
      else opts.externalSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    try {
      const iter = optsRef.current.provider.stream({
        messages: optsRef.current.messages,
        signal: ctrl.signal,
      });
      for await (const part of iter) {
        const current = store.get();
        const next = reduce(current, part as StreamPart);
        store.set(next);
        optsRef.current.onPart?.(part as StreamPart);
        if (next.status === 'done' || next.status === 'error') break;
      }
    } catch (e) {
      const current = store.get();
      store.set({
        ...current,
        status: 'error',
        error: { code: 'E_RUNTIME', message: e instanceof Error ? e.message : String(e) },
      });
    } finally {
      setRunning(false);
    }
  };

  const send = () => {
    void run();
  };

  const cancel = () => {
    ctrlRef.current?.abort();
  };

  useEffect(() => {
    if (opts.auto) void run();
    return () => {
      ctrlRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.auto]);

  return {
    state,
    send,
    cancel,
    isStreaming: running,
  };
}
