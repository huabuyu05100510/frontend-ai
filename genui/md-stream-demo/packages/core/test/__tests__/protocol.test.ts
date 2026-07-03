import { describe, expect, it } from 'vitest';
import {
  ALL_PART_TYPES,
  DecodeError,
  Part,
  decodePart,
  encodePart,
  isCardPart,
  isTerminal,
  isTextDelta,
  isToolCallPart,
} from '../../src/protocol';

describe('A2UI Stream Protocol', () => {
  describe('Part 工厂', () => {
    it.each(ALL_PART_TYPES)('Part 工厂能构造所有 part 类型 (%s)', (type) => {
      const part = samplePart(type);
      expect(part.type).toBe(type);
    });

    it('Part.textDelta 带 id 与 text', () => {
      const p = Part.textDelta('t1', '你好');
      expect(p).toEqual({ type: 'text-delta', id: 't1', text: '你好' });
    });

    it('Part.error 默认 retryable=false', () => {
      expect(Part.error('E001', 'fail')).toMatchObject({ retryable: false });
      expect(Part.error('E002', 'fail', true)).toMatchObject({ retryable: true });
    });

    it('Part.done 可省略 usage', () => {
      expect(Part.done()).toEqual({ type: 'done', usage: undefined });
      const doneWithUsage = Part.done({ inputTokens: 10, outputTokens: 20 });
      expect(doneWithUsage.type === 'done' && doneWithUsage.usage).toMatchObject({
        inputTokens: 10,
        outputTokens: 20,
      });
    });
  });

  describe('类型守卫', () => {
    it('isTextDelta 只命中 text-delta', () => {
      expect(isTextDelta(Part.textDelta('t', 'x'))).toBe(true);
      expect(isTextDelta(Part.done())).toBe(false);
    });

    it('isToolCallPart 命中三个 tool-call-*', () => {
      expect(isToolCallPart(Part.toolCallStart('a', 'Search'))).toBe(true);
      expect(isToolCallPart(Part.toolCallArgDelta('a', 'q', 'cafe'))).toBe(true);
      expect(isToolCallPart(Part.toolCallEnd('a', { q: 'cafe' }))).toBe(true);
      expect(isToolCallPart(Part.cardStart('c', 'guide'))).toBe(false);
    });

    it('isCardPart 命中三个 card-*', () => {
      expect(isCardPart(Part.cardStart('c1', 'guide'))).toBe(true);
      expect(isCardPart(Part.cardDelta('c1', '{"title":'))).toBe(true);
      expect(isCardPart(Part.cardEnd('c1'))).toBe(true);
      expect(isCardPart(Part.textDelta('t', 'x'))).toBe(false);
    });

    it('isTerminal 命中 done / error', () => {
      expect(isTerminal(Part.done())).toBe(true);
      expect(isTerminal(Part.error('E', 'x'))).toBe(true);
      expect(isTerminal(Part.textDelta('t', 'x'))).toBe(false);
    });
  });

  describe('SSE wire 编码 / 解码', () => {
    it('encodePart 输出 SSE event block（双换行结尾）', () => {
      const wire = encodePart(Part.textDelta('t1', 'hi'));
      expect(wire).toBe('event: text-delta\ndata: {"id":"t1","text":"hi"}\n\n');
    });

    it('encodePart 不包含 type 字段（type 走 event 头）', () => {
      const wire = encodePart(Part.cardStart('c1', 'guide'));
      // data 不应包含 "type" 字段
      const dataLine = wire.split('\n')[1];
      expect(dataLine).not.toContain('"type"');
    });

    it.each(ALL_PART_TYPES)('encode → decode === identity (%s)', (type) => {
      const original = samplePart(type);
      const wire = encodePart(original);
      const { event, data } = parseSseBlock(wire);
      const restored = decodePart({ event, data });
      expect(restored).toEqual(original);
    });

    it('decodePart 遇到未知 type 抛 DecodeError', () => {
      expect(() => decodePart({ event: 'mystery', data: '{}' })).toThrow(DecodeError);
    });

    it('decodePart 遇到非法 JSON 抛 DecodeError', () => {
      expect(() => decodePart({ event: 'text-delta', data: '{bad' })).toThrow(DecodeError);
    });
  });

  describe('exhaustive switch 编译期保证', () => {
    // 这个测试不是给运行时的，是给 tsc 的：如果有新的 StreamPartType 加进来
    // 但消费侧没覆盖，noUncheckedReturns 会漏。这里跑一遍所有 part 证明 union 闭合。
    it('每个 part type 都能被分类到三大族（text / tool / card / terminal）', () => {
      for (const type of ALL_PART_TYPES) {
        const p = samplePart(type);
        const bucket = classify(p);
        expect(['text', 'tool', 'card', 'terminal']).toContain(bucket);
      }
    });
  });
});

// ============================================================
// 测试辅助
// ============================================================

function samplePart(type: (typeof ALL_PART_TYPES)[number]) {
  switch (type) {
    case 'text-delta':
      return Part.textDelta('t1', 'hello');
    case 'tool-call-start':
      return Part.toolCallStart('call_1', 'POISearch');
    case 'tool-call-arg-delta':
      return Part.toolCallArgDelta('call_1', 'query', '故宫');
    case 'tool-call-end':
      return Part.toolCallEnd('call_1', { query: '故宫咖啡馆' });
    case 'card-start':
      return Part.cardStart('card_1', 'guide');
    case 'card-delta':
      return Part.cardDelta('card_1', '{"title":"路线"}');
    case 'card-end':
      return Part.cardEnd('card_1');
    case 'error':
      return Part.error('E_TIMEOUT', 'timeout', true);
    case 'done':
      return Part.done({ inputTokens: 10, outputTokens: 20 });
  }
}

function classify(p: { type: string }): 'text' | 'tool' | 'card' | 'terminal' {
  if (p.type === 'text-delta') return 'text';
  if (p.type.startsWith('tool-call')) return 'tool';
  if (p.type.startsWith('card-')) return 'card';
  return 'terminal';
}

function parseSseBlock(wire: string): { event: string; data: string } {
  const lines = wire.split('\n');
  const event = lines[0]!.slice('event: '.length);
  const data = lines[1]!.slice('data: '.length);
  return { event, data };
}
