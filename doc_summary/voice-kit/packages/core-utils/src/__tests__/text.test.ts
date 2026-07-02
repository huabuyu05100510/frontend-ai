import { describe, expect, it } from 'vitest';
import { djb2Hash, normalizeForCompare, prefixOverlap, getSpeakerColor } from '../text';

describe('djb2Hash', () => {
  it('returns unsigned 32-bit values', () => {
    const h = djb2Hash('hello');
    expect(h).toBeGreaterThan(0);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it('is deterministic', () => {
    expect(djb2Hash('speaker-1')).toBe(djb2Hash('speaker-1'));
  });

  it('does NOT exhibit Math.abs(-2^31) bug', () => {
    // Some inputs would produce -2^31 = -2147483648 in signed form;
    // >>> 0 must convert to 2147483648, not Math.abs result.
    const h = djb2Hash('xxx-xxx-xxx-xxx-xxx-xxx-xxx-xxx-xxx-xxx');
    expect(h).toBeGreaterThanOrEqual(0);
  });

  it('different inputs produce different hashes (sanity)', () => {
    expect(djb2Hash('a')).not.toBe(djb2Hash('b'));
  });
});

describe('normalizeForCompare', () => {
  it('strips punctuation and whitespace', () => {
    expect(normalizeForCompare('hello, world!')).toBe('helloworld');
    expect(normalizeForCompare('你好，世界！')).toBe('你好世界');
    expect(normalizeForCompare('a b\tc\nd')).toBe('abcd');
  });

  it('strips currency and math symbols', () => {
    expect(normalizeForCompare('$100+200=300')).toBe('100200300');
  });

  it('empty stays empty', () => {
    expect(normalizeForCompare('!!! ???')).toBe('');
  });
});

describe('prefixOverlap', () => {
  // prefixOverlap(prefix, text) returns the fraction of `text` covered by the
  // matching prefix of `prefix`. Used by transcriptionReducer Path C to decide
  // whether the new frame is a continuation (≥0.7) of the previous one.
  it('returns fraction of text covered by matching prefix', () => {
    // 'hello' matches first 5 chars of 'hello world' (10 chars) → 5/10 = 0.5
    expect(prefixOverlap('hello', 'hello world')).toBe(0.5);
  });

  it('returns 1 when prefix covers entire text', () => {
    // Old card fully contains new text's prefix → text fully covered
    expect(prefixOverlap('hello world', 'hello')).toBe(1);
  });

  it('returns 0 when no overlap', () => {
    expect(prefixOverlap('abc', 'xyz')).toBe(0);
  });

  it('ignores punctuation differences', () => {
    // Both normalize to '你好世界' → full coverage of text
    const r = prefixOverlap('你好,世界', '你好世界');
    expect(r).toBe(1);
  });

  it('handles empty strings', () => {
    expect(prefixOverlap('', 'abc')).toBe(0);
    expect(prefixOverlap('abc', '')).toBe(0);
  });
});

describe('getSpeakerColor', () => {
  it('returns a hex color', () => {
    expect(getSpeakerColor('spk-1')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('is stable across calls', () => {
    expect(getSpeakerColor('spk-1')).toBe(getSpeakerColor('spk-1'));
  });

  it('different speakers may get same color (12-color palette, hash collision ok)', () => {
    // Just ensure it doesn't throw on many speakers
    const colors = new Set<string>();
    for (let i = 0; i < 100; i++) {
      colors.add(getSpeakerColor(`spk-${i}`));
    }
    expect(colors.size).toBeGreaterThan(0);
    expect(colors.size).toBeLessThanOrEqual(12);
  });
});
