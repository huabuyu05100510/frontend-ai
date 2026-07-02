import { describe, it, expect } from 'vitest'
import { computePeaks } from '../waveform'

describe('computePeaks（PCM → min/max 分桶峰值）', () => {
  it('按桶数输出', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.2, -0.2, 0])
    const peaks = computePeaks(samples, 4)
    expect(peaks).toHaveLength(4)
  })

  it('每桶取真实 min/max', () => {
    const samples = new Float32Array([0.1, 0.9, -0.3, -0.8])
    const peaks = computePeaks(samples, 2)
    expect(peaks[0][0]).toBeCloseTo(0.1, 5) // 桶0 min
    expect(peaks[0][1]).toBeCloseTo(0.9, 5) // 桶0 max
    expect(peaks[1][0]).toBeCloseTo(-0.8, 5) // 桶1 min
    expect(peaks[1][1]).toBeCloseTo(-0.3, 5) // 桶1 max
  })

  it('samples 少于桶数不报错', () => {
    const peaks = computePeaks(new Float32Array([0.5, -0.5]), 8)
    expect(peaks.length).toBe(8)
    expect(peaks.every(([min, max]) => min <= max)).toBe(true)
  })

  it('空输入返回零峰值', () => {
    const peaks = computePeaks(new Float32Array(0), 3)
    expect(peaks).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
    ])
  })

  it('全正弦近似：min<0<max', () => {
    const n = 4410
    const s = new Float32Array(n)
    for (let i = 0; i < n; i++) s[i] = Math.sin((i / n) * Math.PI * 2 * 10)
    const peaks = computePeaks(s, 100)
    expect(peaks.length).toBe(100)
    const mid = peaks[50]
    expect(mid[0]).toBeLessThan(0)
    expect(mid[1]).toBeGreaterThan(0)
  })
})
