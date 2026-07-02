import { describe, it, expect } from 'vitest';
import { IncrementalSegmenter } from '@/imd/segmenter';

function atomic(s: string) {
  const seg = new IncrementalSegmenter();
  seg.push(s);
  seg.end();
  return seg.getSegments();
}

describe('IncrementalSegmenter 基础切块', () => {
  it('单段落 → 1 段', () => {
    const segs = atomic('hello world');
    expect(segs.length).toBe(1);
    expect(segs[0].kind).toBe('paragraph');
    expect(segs[0].text).toBe('hello world');
  });

  it('空行分隔 → 2 段', () => {
    const segs = atomic('first para\n\nsecond para');
    expect(segs.length).toBe(2);
    expect(segs[0].text).toBe('first para');
    expect(segs[1].text).toBe('second para');
  });

  it('围栏内空行不切断', () => {
    const segs = atomic('```js\nconst a = 1;\n\nconst b = 2;\n```');
    expect(segs.length).toBe(1);
    expect(segs[0].kind).toBe('fence');
    expect(segs[0].text).toContain('const b = 2;');
  });

  it('卡片围栏识别 kind=card', () => {
    const segs = atomic('```amap\n{"name":"故宫"}\n```');
    expect(segs.length).toBe(1);
    expect(segs[0].kind).toBe('card');
    expect(segs[0].lang).toBe('amap');
  });

  it('多块混合', () => {
    const segs = atomic('# 标题\n\n段落\n\n- a\n- b\n\n```js\nx\n```');
    expect(segs.map((s) => s.kind)).toEqual(['heading', 'paragraph', 'list', 'fence']);
  });
});

describe('IncrementalSegmenter 不变式', () => {
  it('I3 未闭合围栏保持 active', () => {
    const seg = new IncrementalSegmenter();
    seg.push('```js\ncode here');
    const segs = seg.getSegments();
    expect(segs.length).toBe(1);
    expect(segs[0].status).toBe('active');
    expect(segs[0].kind).toBe('fence');
  });

  it('I2 至多一个 active 段', () => {
    const seg = new IncrementalSegmenter();
    seg.push('a\n\nb\n\nc');
    const actives = seg.getSegments().filter((s) => s.status === 'active');
    expect(actives.length).toBeLessThanOrEqual(1);
  });

  it('I1 final 段 id/hash 跨 push 稳定', () => {
    const seg = new IncrementalSegmenter();
    seg.push('first\n\nsecond');
    const finalsA = seg.getSegments().filter((s) => s.status === 'final');
    expect(finalsA.length).toBe(1);
    const snap = { id: finalsA[0].id, hash: finalsA[0].hash };
    seg.push(' more text');
    seg.push('\n\nthird');
    const finalsB = seg.getSegments().filter((s) => s.status === 'final');
    const first = finalsB.find((s) => s.text === 'first')!;
    expect(first.id).toBe(snap.id);
    expect(first.hash).toBe(snap.hash);
  });

  it('end() 后全部 final', () => {
    const seg = new IncrementalSegmenter();
    seg.push('a\n\nb');
    seg.end();
    expect(seg.getSegments().every((s) => s.status === 'final')).toBe(true);
  });

  it('reset 清空', () => {
    const seg = new IncrementalSegmenter();
    seg.push('a\n\nb');
    seg.reset();
    expect(seg.getSegments().length).toBe(0);
  });
});

describe('IncrementalSegmenter drainDirty', () => {
  it('首次返回全部变更，无变化时为空', () => {
    const seg = new IncrementalSegmenter();
    seg.push('a\n\nb');
    const d1 = seg.drainDirty();
    expect(d1.changed.length).toBe(2);
    const d2 = seg.drainDirty();
    expect(d2.changed.length).toBe(0);
  });

  it('新增字符只让 active 段进入 changed', () => {
    const seg = new IncrementalSegmenter();
    seg.push('done\n\nactive');
    seg.drainDirty();
    seg.push(' more');
    const d = seg.drainDirty();
    expect(d.changed.length).toBe(1);
    expect(d.changed[0].text).toBe('active more');
    expect(d.changed[0].status).toBe('active');
  });

  it('块完成（active→final）上报一次后不再出现', () => {
    const seg = new IncrementalSegmenter();
    seg.push('hello');
    seg.drainDirty();
    seg.end();
    const d1 = seg.drainDirty();
    expect(d1.changed.length).toBe(1);
    expect(d1.changed[0].status).toBe('final');
    const d2 = seg.drainDirty();
    expect(d2.changed.length).toBe(0);
  });
});
