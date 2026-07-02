import { describe, it, expect } from 'vitest';
import { cyrb53 } from '@/imd/hash';

describe('cyrb53 指纹', () => {
  it('相同输入产生相同 hash', () => {
    expect(cyrb53('hello world')).toBe(cyrb53('hello world'));
  });

  it('不同输入产生不同 hash', () => {
    expect(cyrb53('a')).not.toBe(cyrb53('b'));
    expect(cyrb53('hello')).not.toBe(cyrb53('world'));
  });

  it('空串稳定且返回非空字符串', () => {
    expect(cyrb53('')).toBe(cyrb53(''));
    expect(typeof cyrb53('x')).toBe('string');
    expect(cyrb53('x').length).toBeGreaterThan(0);
  });

  it('对单字符差异敏感', () => {
    expect(cyrb53('streaming')).not.toBe(cyrb53('streaminh'));
  });
});
