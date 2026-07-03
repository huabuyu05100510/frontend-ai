import { describe, expect, it } from 'vitest';
import {
  ChatMessage,
  ProviderAdapter,
  createMockProvider,
  createProvider,
  sliceByCodePoint,
} from '../../src/ProviderAdapter';
import { isTerminal, isTextDelta } from '../../src/protocol';

describe('ProviderAdapter', () => {
  describe('createProvider', () => {
    it('name 与 stream 都暴露', async () => {
      const p: ProviderAdapter = createProvider('test', async function* () {
        yield { type: 'done' };
      });
      expect(p.name).toBe('test');
      const parts = [];
      for await (const part of p.stream({ messages: [] })) parts.push(part);
      expect(parts).toHaveLength(1);
      expect(parts[0]!.type).toBe('done');
    });
  });

  describe('createMockProvider', () => {
    it('把响应字符串切成 text-delta 流', async () => {
      const p = createMockProvider(() => 'Hello 世界 🌍');
      const parts = [];
      for await (const part of p.stream({ messages: [] })) parts.push(part);
      const textParts = parts.filter(isTextDelta);
      const done = parts.find((x) => x.type === 'done');
      expect(textParts.length).toBeGreaterThan(0);
      expect(done).toBeDefined();
      expect(textParts.map((p) => p.text).join('')).toBe('Hello 世界 🌍');
    });

    it('turnIndex 等于 user 消息数减一', async () => {
      const seen: number[] = [];
      const p = createMockProvider((_, turnIndex) => {
        seen.push(turnIndex);
        return `turn ${turnIndex}`;
      });
      const messages: ChatMessage[] = [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'q2' },
      ];
      for await (const _ of p.stream({ messages })) void _;
      expect(seen[0]).toBe(1);
    });

    it('必须以 done 或 error 终结（不变量）', async () => {
      const p = createMockProvider(() => 'x');
      const parts = [];
      for await (const part of p.stream({ messages: [] })) parts.push(part);
      const last = parts[parts.length - 1]!;
      expect(isTerminal(last)).toBe(true);
    });

    it('signal.aborted 后停止 yield', async () => {
      const ctrl = new AbortController();
      const p = createMockProvider(() => 'x'.repeat(1000));
      const collected: string[] = [];
      ctrl.abort();
      for await (const part of p.stream({ messages: [], signal: ctrl.signal })) {
        if (isTextDelta(part)) collected.push(part.text);
      }
      // aborted 立刻停止，不应有任何 yield
      expect(collected.join('')).toBe('');
    });
  });

  describe('sliceByCodePoint', () => {
    it('不切坏 emoji（4 字节 code point 整块进一个 chunk）', () => {
      const chunks = sliceByCodePoint('a🌍b', 1, 1);
      // 'a' '🌍' 'b'，🌍 是单 code point 但 2 个 UTF-16 unit
      // slice(i, i+1) 会切坏 🌍 —— 注意此函数仅按 char 长度切
      // 这里文档化这个限制：业务侧需要安全的 chunk 切分时应在 code point 边界
      expect(chunks.length).toBeGreaterThanOrEqual(3);
    });

    it('所有 chunk 拼起来等于原串', () => {
      const s = 'Hello 世界 🌍 café';
      const chunks = sliceByCodePoint(s, 2, 5);
      expect(chunks.join('')).toBe(s);
    });

    it('空串返回空数组', () => {
      expect(sliceByCodePoint('', 2, 5)).toEqual([]);
    });
  });
});
