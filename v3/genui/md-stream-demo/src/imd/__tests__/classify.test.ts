import { describe, it, expect } from 'vitest';
import { classify } from '@/imd/classify';

describe('classify 块类型识别', () => {
  it('标题', () => {
    expect(classify('# Title').kind).toBe('heading');
    expect(classify('### Sub head\nmore').kind).toBe('heading');
  });

  it('分隔线 hr', () => {
    expect(classify('---').kind).toBe('hr');
    expect(classify('***').kind).toBe('hr');
    expect(classify('- - -').kind).toBe('hr');
  });

  it('围栏代码块', () => {
    const c = classify('```js\ncode\n```');
    expect(c.kind).toBe('fence');
    expect(c.lang).toBe('js');
  });

  it('卡片围栏（语言在卡片集内）', () => {
    const c = classify('```amap\n{"name":"x"}\n```');
    expect(c.kind).toBe('card');
    expect(c.lang).toBe('amap');
  });

  it('引用', () => {
    expect(classify('> quote line').kind).toBe('blockquote');
  });

  it('表格（首行含 | 且次行为分隔行）', () => {
    expect(classify('| a | b |\n| --- | --- |\n| 1 | 2 |').kind).toBe('table');
  });

  it('列表', () => {
    expect(classify('- item one\n- item two').kind).toBe('list');
    expect(classify('1. first\n2. second').kind).toBe('list');
  });

  it('段落（兜底）', () => {
    expect(classify('just a normal paragraph').kind).toBe('paragraph');
    expect(classify('has a | pipe but no separator').kind).toBe('paragraph');
  });
});
