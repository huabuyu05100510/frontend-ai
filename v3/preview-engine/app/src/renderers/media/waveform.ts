// ============================================================================
// computePeaks — PCM 采样降采样为分桶 min/max 峰值（真实波形数据）
//   渲染时每桶画一条从 min 到 max 的竖线，即得波形图。
//   在 Worker 中跑可避免阻塞主线程。
// ============================================================================

export type Peak = [min: number, max: number]

export function computePeaks(samples: Float32Array, buckets: number): Peak[] {
  const peaks: Peak[] = new Array(buckets)
  if (samples.length === 0) {
    for (let i = 0; i < buckets; i++) peaks[i] = [0, 0]
    return peaks
  }

  const per = samples.length / buckets
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per)
    const end = Math.min(samples.length, Math.floor((b + 1) * per))
    if (end <= start) {
      // 采样数少于桶数时，取最近的单个样本
      const v = samples[Math.min(start, samples.length - 1)]
      peaks[b] = [Math.min(v, 0), Math.max(v, 0)]
      continue
    }
    let min = Infinity
    let max = -Infinity
    for (let i = start; i < end; i++) {
      const v = samples[i]
      if (v < min) min = v
      if (v > max) max = v
    }
    peaks[b] = [min, max]
  }
  return peaks
}
