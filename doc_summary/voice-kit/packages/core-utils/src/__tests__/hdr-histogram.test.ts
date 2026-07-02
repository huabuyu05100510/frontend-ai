import { describe, expect, it } from 'vitest';
import { HDRHistogram } from '../hdr-histogram';

describe('HDRHistogram', () => {
  it('returns 0 for empty histogram', () => {
    const h = new HDRHistogram();
    expect(h.percentile(50)).toBe(0);
    expect(h.snapshot().p99).toBe(0);
  });

  it('records uniform values', () => {
    const h = new HDRHistogram(3, 1000);
    for (let i = 1; i <= 100; i++) h.record(i);
    const snap = h.snapshot();
    expect(snap.count).toBe(100);
    expect(snap.min).toBe(1);
    expect(snap.max).toBe(100);
    expect(snap.mean).toBeCloseTo(50.5, 0);
  });

  it('computes percentiles with ≤3% error at 3 sig figs', () => {
    const h = new HDRHistogram(3, 10000);
    // 1000 samples, log-distributed (typical latency distribution)
    for (let i = 1; i <= 1000; i++) {
      const v = Math.pow(10, i / 250); // 10..10000 log distribution
      h.record(v);
    }
    // Exact p50 of the input
    const p50exact = Math.pow(10, 500 / 250); // i=500 → 100
    const p50 = h.percentile(50);
    const relErr = Math.abs(p50 - p50exact) / p50exact;
    // 3 sig figs precision yields ≤1.5% relative error in theory; allow 3%
    // to accommodate bucket-center rounding at exact bucket boundaries
    expect(relErr).toBeLessThan(0.03);

    // p99 must be near max
    const p99 = h.percentile(99);
    expect(p99).toBeGreaterThan(5000);
  });

  it('handles out-of-range and invalid values gracefully', () => {
    const h = new HDRHistogram();
    h.record(0);
    h.record(-5);
    h.record(NaN);
    h.record(Infinity);
    expect(h.count).toBe(4); // all clamped & counted
  });

  it('reset clears everything', () => {
    const h = new HDRHistogram();
    h.record(10);
    h.record(20);
    h.reset();
    expect(h.count).toBe(0);
    expect(h.percentile(50)).toBe(0);
  });
});
