import { describe, expect, it } from 'vitest';
import { nextReconnectDelay } from '../index';

describe('nextReconnectDelay (jittered exponential)', () => {
  it('stays within [base*2^attempt*0.5, base*2^attempt] then capped', () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const base = 1000;
      const max = 30000;
      const delay = nextReconnectDelay(attempt, base, max);
      const rawExp = base * Math.pow(2, attempt);
      const expectedMax = Math.min(rawExp, max);
      const expectedMin = expectedMax * 0.5;
      expect(delay).toBeGreaterThanOrEqual(expectedMin - 1);
      expect(delay).toBeLessThanOrEqual(expectedMax + 1);
    }
  });

  it('caps at maxMs', () => {
    const delay = nextReconnectDelay(20, 1000, 5000);
    expect(delay).toBeLessThanOrEqual(5000);
  });

  it('returns random-ish values across calls', () => {
    const values = new Set<number>();
    for (let i = 0; i < 50; i++) {
      values.add(nextReconnectDelay(3, 1000, 30000));
    }
    expect(values.size).toBeGreaterThan(1); // jitter is working
  });
});
