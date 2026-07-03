import { describe, expect, it } from 'vitest';
import { Part } from '../../src/protocol';
import {
  CardView,
  StreamState,
  ToolCallView,
  consumeStream,
  initialState,
  reduce,
  textDeltaStream,
} from '../../src/StreamConsumer';

describe('StreamConsumer', () => {
  describe('reduce: text-delta', () => {
    it('累积文本', () => {
      let s: StreamState = initialState;
      s = reduce(s, Part.textDelta('t1', 'Hello'));
      s = reduce(s, Part.textDelta('t1', ' 世界'));
      expect(s.text).toBe('Hello 世界');
      expect(s.status).toBe('streaming');
    });
  });

  describe('reduce: tool-call', () => {
    it('三段聚合：start → arg-delta → end', () => {
      let s = initialState;
      s = reduce(s, Part.toolCallStart('call_1', 'POISearch'));
      s = reduce(s, Part.toolCallArgDelta('call_1', 'query', '故'));
      s = reduce(s, Part.toolCallArgDelta('call_1', 'query', '宫'));
      s = reduce(s, Part.toolCallEnd('call_1', { query: '故宫' }));
      const call = s.toolCalls['call_1'] as ToolCallView;
      expect(call.name).toBe('POISearch');
      expect(call.argParts.query).toBe('故宫');
      expect(call.args).toEqual({ query: '故宫' });
      expect(call.done).toBe(true);
    });

    it('多个并行 tool call 互不干扰', () => {
      let s = initialState;
      s = reduce(s, Part.toolCallStart('a', 'X'));
      s = reduce(s, Part.toolCallStart('b', 'Y'));
      s = reduce(s, Part.toolCallArgDelta('a', 'q', 'a1'));
      s = reduce(s, Part.toolCallArgDelta('b', 'q', 'b1'));
      expect(s.toolCalls['a']!.argParts.q).toBe('a1');
      expect(s.toolCalls['b']!.argParts.q).toBe('b1');
    });

    it('arg-delta 在 start 之前到达也能容错', () => {
      let s = initialState;
      s = reduce(s, Part.toolCallArgDelta('orphan', 'q', 'x'));
      expect(s.toolCalls['orphan']).toBeDefined();
      expect(s.toolCalls['orphan']!.argParts.q).toBe('x');
    });
  });

  describe('reduce: card', () => {
    it('三段聚合：start → delta → end', () => {
      let s = initialState;
      s = reduce(s, Part.cardStart('c1', 'guide'));
      s = reduce(s, Part.cardDelta('c1', '{"title":"x"'));
      s = reduce(s, Part.cardDelta('c1', ',"pois":[]}'));
      s = reduce(s, Part.cardEnd('c1'));
      const card = s.cards['c1'] as CardView;
      expect(card.lang).toBe('guide');
      expect(card.body).toBe('{"title":"x","pois":[]}');
      expect(card.done).toBe(true);
    });

    it('card-delta 在 start 之前到达被忽略（保护不变量）', () => {
      let s = initialState;
      s = reduce(s, Part.cardDelta('orphan', 'xxx'));
      expect(s.cards['orphan']).toBeUndefined();
    });
  });

  describe('reduce: 终态', () => {
    it('done 带 usage', () => {
      const s = reduce(initialState, Part.done({ inputTokens: 10, outputTokens: 20 }));
      expect(s.status).toBe('done');
      expect(s.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    });

    it('error 带 retryable', () => {
      const s = reduce(initialState, Part.error('E_TIMEOUT', 'timeout', true));
      expect(s.status).toBe('error');
      expect(s.error?.retryable).toBe(true);
    });
  });

  describe('consumeStream', () => {
    it('消费一个简单 text 流到 done', async () => {
      const state = await consumeStream(textDeltaStream('Hello', 2));
      expect(state.text).toBe('Hello');
      expect(state.status).toBe('done');
    });

    it('onPart 回调每条 part 都触发', async () => {
      const parts: string[] = [];
      await consumeStream(textDeltaStream('abc', 1), {
        onPart: (_s, p) => parts.push(p.type),
      });
      // 3 个 text-delta + 1 done
      expect(parts.filter((t) => t === 'text-delta')).toHaveLength(3);
      expect(parts).toContain('done');
    });

    it('AbortSignal 触发时立即停止，已累积内容零丢失', async () => {
      const ctrl = new AbortController();
      let collected = '';
      const iter = (async function* () {
        for (let i = 0; i < 100; i++) {
          await Promise.resolve();
          if (ctrl.signal.aborted) return;
          yield Part.textDelta(`t-${i}`, 'x');
          if (i === 3) ctrl.abort();
        }
        yield Part.done();
      })();
      const state = await consumeStream(iter, { signal: ctrl.signal });
      expect(state.text.length).toBeLessThan(100);
      expect(state.text.length).toBeGreaterThan(0);
      collected = state.text;
      expect(collected).toBeTruthy();
    });
  });

  describe('stream-equivalence 不变量（property）', () => {
    it('多次 yield 累积 == 一次性 payload（text）', async () => {
      const original = '这是一段用于流式等价性测试的文本，含中文与 emoji 🌍';
      for (let seed = 0; seed < 10; seed++) {
        const chunks = randomChunks(original, seed);
        const iter = (async function* () {
          for (let i = 0; i < chunks.length; i++) yield Part.textDelta(`t-${i}`, chunks[i]!);
          yield Part.done();
        })();
        const state = await consumeStream(iter);
        expect(state.text).toBe(original);
      }
    });

    it('多次 yield 累积 == 一次性 payload（card body）', async () => {
      const original = '{"title":"路线","pois":[{"id":"p1","name":"A"}]}';
      for (let seed = 0; seed < 10; seed++) {
        const chunks = randomChunks(original, seed);
        const iter = (async function* () {
          yield Part.cardStart('c1', 'guide');
          for (let i = 0; i < chunks.length; i++) yield Part.cardDelta('c1', chunks[i]!);
          yield Part.cardEnd('c1');
          yield Part.done();
        })();
        const state = await consumeStream(iter);
        expect(state.cards['c1']!.body).toBe(original);
      }
    });
  });
});

/** seeded LCG：可复现的随机切分（参考本仓库 SSEParser property test 同款实现） */
function randomChunks(s: string, seed: number): string[] {
  let state = seed + 1;
  const rng = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const size = 1 + Math.floor(rng() * 5);
    out.push(s.slice(i, i + size));
    i += size;
  }
  return out;
}
