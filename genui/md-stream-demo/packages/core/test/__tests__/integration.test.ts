/**
 * 集成测试 —— SDK 端到端落地证据：
 * 「业务方 defineCard + MockProvider 发 card part → StreamState → resolveCardViews → 命中注册 component」
 *
 * 这一条不变量是「零渲染层改动接入」的最直接证据。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineCard, _resetRegistry, getCard } from '../../src/CardRegistry';
import { createProvider } from '../../src/ProviderAdapter';
import { Part } from '../../src/protocol';
import { consumeStream } from '../../src/StreamConsumer';
import { resolveCardViews, runStream } from '../../src/runtime';

describe('SDK 端到端集成', () => {
  beforeEach(() => _resetRegistry());

  it('行中导游场景：defineCard(guide) → provider 发 card part → resolveCardViews 命中', async () => {
    const GuideComponent = vi.fn(() => null);
    defineCard({ name: 'guide', component: GuideComponent });

    // 模拟 LLM 把 guide 卡片的 JSON 流式吐出
    const fullBody = JSON.stringify({
      title: '国贸 → 颐和园',
      pois: [{ id: 'p1', name: '国家大剧院', durationMin: 6 }],
    });
    const chunks = splitChunks(fullBody, 12);

    const provider = createProvider('mock-guide', async function* () {
      yield Part.cardStart('card_1', 'guide');
      for (const c of chunks) yield Part.cardDelta('card_1', c);
      yield Part.cardEnd('card_1');
      yield Part.done();
    });

    const state = await runStream({ provider, messages: [{ role: 'user', content: '国贸到颐和园' }] });
    const views = resolveCardViews(state);

    expect(views).toHaveLength(1);
    expect(views[0]!.lang).toBe('guide');
    expect(views[0]!.done).toBe(true);
    expect(views[0]!.parseable).toBe(true);
    expect(views[0]!.data).toMatchObject({ title: '国贸 → 颐和园' });
    expect(views[0]!.def?.component).toBe(GuideComponent);
  });

  it('流式中途 state.cards.body 是半截 JSON，resolveCardViews.parseable=false（骨架态）', async () => {
    defineCard({ name: 'guide', component: () => null });

    const provider = createProvider('mock-partial', async function* () {
      yield Part.cardStart('c1', 'guide');
      yield Part.cardDelta('c1', '{"title":"路线","pois":['); // 半截
      // 没发 card-end，没发 done，故意不闭合
    });

    const state = await consumeStream(provider.stream({ messages: [] }));
    const views = resolveCardViews(state);
    expect(views[0]!.parseable).toBe(false);
    expect(views[0]!.data).toBeUndefined();
    expect(views[0]!.def?.component).toBeDefined();
  });

  it('未注册的 lang：resolveCardViews 返回 def=undefined，业务侧可走兜底', async () => {
    const provider = createProvider('mock-unknown', async function* () {
      yield Part.cardStart('c1', 'unknown-lang');
      yield Part.cardDelta('c1', '{}');
      yield Part.cardEnd('c1');
      yield Part.done();
    });
    const state = await runStream({ provider, messages: [] });
    const views = resolveCardViews(state);
    expect(views[0]!.def).toBeUndefined();
    expect(views[0]!.parseable).toBe(true);
  });

  it('在哪儿场景：图/视频混合多卡片流式，每张卡都能命中注册', async () => {
    defineCard({ name: 'discover', component: () => null });
    defineCard({ name: 'amap', component: () => null });

    const provider = createProvider('mock-multi', async function* () {
      yield Part.textDelta('t1', '为您找到这些结果：');
      yield Part.cardStart('c1', 'discover');
      yield Part.cardDelta('c1', '{"query":"故宫咖啡馆"');
      yield Part.cardDelta('c1', ',"total":128}');
      yield Part.cardEnd('c1');
      yield Part.textDelta('t2', '\n\n附近地图：');
      yield Part.cardStart('c2', 'amap');
      yield Part.cardDelta('c2', '{"name":"角楼咖啡","lng":116.4,"lat":39.9}');
      yield Part.cardEnd('c2');
      yield Part.done();
    });

    const state = await runStream({ provider, messages: [] });
    const views = resolveCardViews(state);

    expect(state.text).toBe('为您找到这些结果：\n\n附近地图：');
    expect(views).toHaveLength(2);
    expect(views[0]!.lang).toBe('discover');
    expect(views[0]!.data).toMatchObject({ query: '故宫咖啡馆', total: 128 });
    expect(views[1]!.lang).toBe('amap');
    expect(views[1]!.data).toMatchObject({ name: '角楼咖啡' });
    expect(getCard('discover')).toBeDefined();
    expect(getCard('amap')).toBeDefined();
  });

  it('不变量：流式等价 — 任意切法 == 一次性', async () => {
    defineCard({ name: 'guide', component: () => null });
    const full = JSON.stringify({
      title: 'x',
      pois: new Array(20).fill(0).map((_, i) => ({ id: `p${i}`, name: `景点${i}` })),
    });

    for (let seed = 1; seed <= 8; seed++) {
      const chunks = splitChunksSeeded(full, seed);
      const provider = createProvider(`seed-${seed}`, async function* () {
        yield Part.cardStart('c1', 'guide');
        for (const c of chunks) yield Part.cardDelta('c1', c);
        yield Part.cardEnd('c1');
        yield Part.done();
      });
      const state = await runStream({ provider, messages: [] });
      const view = resolveCardViews(state)[0]!;
      expect(view.body).toBe(full);
      expect(view.parseable).toBe(true);
      expect((view.data as { pois: unknown[] }).pois).toHaveLength(20);
    }
  });
});

function splitChunks(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

function splitChunksSeeded(s: string, seed: number): string[] {
  let st = seed + 1;
  const rng = () => {
    st = (st * 1664525 + 1013904223) >>> 0;
    return st / 0x100000000;
  };
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const size = 1 + Math.floor(rng() * 8);
    out.push(s.slice(i, i + size));
    i += size;
  }
  return out;
}
