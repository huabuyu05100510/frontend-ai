import { describe, test, expect } from 'vitest'
import { calcHeatmapAlpha } from '../pipeline/ConfidenceHeatmap.worker'

describe('calcHeatmapAlpha', () => {
  test('置信度 1.0 → alpha 接近 0（完全透明）', () => {
    expect(calcHeatmapAlpha(1.0)).toBeCloseTo(0, 2)
  })

  test('置信度 0.0 → alpha 接近 0.75（不透明红色）', () => {
    expect(calcHeatmapAlpha(0.0)).toBeCloseTo(0.75, 2)
  })

  test('置信度 0.85 → alpha 约 0.113', () => {
    // alpha = (1 - 0.85) * 0.75 = 0.15 * 0.75 = 0.1125
    expect(calcHeatmapAlpha(0.85)).toBeCloseTo(0.1125, 3)
  })

  test('置信度 0.5 → alpha 约 0.375', () => {
    expect(calcHeatmapAlpha(0.5)).toBeCloseTo(0.375, 3)
  })

  test('alpha 始终在 [0, 0.75] 范围内', () => {
    for (let c = 0; c <= 1; c += 0.1) {
      const a = calcHeatmapAlpha(c)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThanOrEqual(0.75)
    }
  })
})
