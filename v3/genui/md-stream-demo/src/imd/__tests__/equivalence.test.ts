import { describe, it, expect } from 'vitest';
import { IncrementalSegmenter } from '@/imd/segmenter';
import type { Segment } from '@/imd/types';

/** 确定性 RNG（mulberry32），保证 property 测试可复现 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function norm(segs: readonly Segment[]) {
  return segs.map((s) => ({ kind: s.kind, text: s.text, lang: s.lang, status: s.status }));
}

function atomic(s: string) {
  const seg = new IncrementalSegmenter();
  seg.push(s);
  seg.end();
  return norm(seg.getSegments());
}

function streamed(s: string, chunk: () => number) {
  const seg = new IncrementalSegmenter();
  let i = 0;
  while (i < s.length) {
    const n = Math.max(1, Math.floor(chunk() * 7));
    seg.push(s.slice(i, i + n));
    i += n;
  }
  seg.end();
  return norm(seg.getSegments());
}

function charByChar(s: string) {
  const seg = new IncrementalSegmenter();
  for (const ch of s) seg.push(ch);
  seg.end();
  return norm(seg.getSegments());
}

const CORPUS = [
  '# 标题\n\n这是一个段落，包含 **粗体** 和 `行内码`。',
  '段落一\n\n段落二\n\n段落三',
  '```ts\nconst x: number = 1;\n\nconst y = x + 1;\n```\n\n收尾段落',
  '| 城市 | 温度 |\n| --- | --- |\n| 北京 | 20 |\n| 上海 | 24 |\n\n下面是说明',
  '- 第一项\n- 第二项\n- 第三项\n\n> 引用一行\n> 引用二行',
  '```amap\n{"name":"故宫","lng":116.39,"lat":39.92}\n```',
  '前言\n\n---\n\n## 小节\n\n内容 [链接](https://example.com) 结束。',
  '混合 `code` 与 **bold** 与普通文字\n\n```py\nprint("hi")\n```\n\n结尾',
];

describe('流式等价性（streaming == atomic）', () => {
  it('随机切片 ≥200 组与原子解析逐段相等', () => {
    let cases = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const rng = mulberry32(seed);
      for (const src of CORPUS) {
        const a = atomic(src);
        const b = streamed(src, rng);
        expect(b).toEqual(a);
        cases++;
      }
    }
    expect(cases).toBeGreaterThanOrEqual(200);
  });

  it('逐字符切片与原子解析逐段相等', () => {
    for (const src of CORPUS) {
      expect(charByChar(src)).toEqual(atomic(src));
    }
  });
});
