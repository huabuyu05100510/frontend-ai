import { describe, it, expect } from 'vitest';
import { speculativeClose } from '@/imd/speculative';

describe('speculativeClose 投机闭合', () => {
  it('未闭合围栏补 ```', () => {
    expect(speculativeClose('```js\ncode')).toContain('```');
    expect(speculativeClose('```js\ncode').match(/```/g)!.length).toBe(2);
  });

  it('奇数行内反引号补反引号', () => {
    const out = speculativeClose('inline `code');
    expect(out.endsWith('`')).toBe(true);
  });

  it('奇数粗体补 **', () => {
    const out = speculativeClose('this is **bold');
    expect(out.endsWith('**')).toBe(true);
  });

  it('未闭合链接括号 [text 补 ]', () => {
    expect(speculativeClose('see [link').includes(']')).toBe(true);
  });

  it('未闭合链接圆括号 [t](u 补 )', () => {
    const out = speculativeClose('see [t](http://x');
    expect(out.endsWith(')')).toBe(true);
  });

  it('已闭合输入幂等不变', () => {
    const closed = 'normal **bold** and `code` and [t](http://x)';
    expect(speculativeClose(closed)).toBe(closed);
  });

  it('围栏内的反引号不被当作行内码误补', () => {
    // 偶数围栏 + 无行内码 → 不变
    const s = '```\ncode\n```';
    expect(speculativeClose(s)).toBe(s);
  });
});
