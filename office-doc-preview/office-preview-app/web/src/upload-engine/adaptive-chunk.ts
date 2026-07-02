// ============================================================
// 自适应分片策略
// 网络预探测 → 动态分片大小 → 运行时自适应调整
// 对标：阿里云 OSS 推荐 100KB-10MB 自适应
// ============================================================

export interface NetworkProbe {
  rtt: number        // 往返延迟 (ms)
  bandwidth: number  // 上行带宽估算 (bytes/s)
  effectiveType: string  // navigator.connection.effectiveType
}

/**
 * 网络预探测：HEAD 请求测 RTT + 小数据测上行带宽
 */
export async function probeNetwork(apiUrl: string): Promise<NetworkProbe> {
  // RTT 探测：3 次 HEAD 请求取中位数
  const rttSamples: number[] = []
  for (let i = 0; i < 3; i++) {
    const start = performance.now()
    try {
      await fetch(apiUrl, { method: 'HEAD' })
      rttSamples.push(performance.now() - start)
    } catch {
      rttSamples.push(2000) // 失败默认 2s
    }
  }
  const rtt = median(rttSamples)

  // 带宽探测：上传 128KB 探测包
  const probeSize = 128 * 1024
  const probeData = new Uint8Array(probeSize)
  const start = performance.now()
  try {
    await fetch(apiUrl + '/probe', {
      method: 'POST',
      body: probeData,
    })
    const elapsed = (performance.now() - start) / 1000
    const bandwidth = probeSize / Math.max(elapsed, 0.1)
    return { rtt, bandwidth, effectiveType: getEffectiveType() }
  } catch {
    // 探测失败，基于 connection API 估算
    return { rtt, bandwidth: estimateBandwidth(), effectiveType: getEffectiveType() }
  }
}

/**
 * 计算最优分片大小
 * 黄金法则：每片上传时间应在 2-8 秒之间
 * 片太小 → HTTP 请求开销占比高
 * 片太大 → 失败重传成本高，并发利用率低
 */
export function calcChunkSize(probe: NetworkProbe, fileSize: number): number {
  const TARGET_TIME = 5 // 目标 5 秒/片

  // 基于带宽计算
  const bySpeed = probe.bandwidth * TARGET_TIME

  // 基于 RTT 调整（高延迟 → 放大分片以减少请求数）
  const rttFactor = 1 + (probe.rtt / 1000) * 0.5

  const optimal = bySpeed * rttFactor

  // 约束在 256KB - 16MB，且总片数不超过 10000
  const minChunk = 256 * 1024
  const maxChunk = Math.min(16 * 1024 * 1024, Math.ceil(fileSize / 10))
  return clamp(Math.round(optimal), minChunk, maxChunk)
}

/**
 * 运行时自适应调整
 * 监控每片实际上传耗时，动态调整分片大小
 */
export class AdaptiveChunker {
  private chunkSize: number
  private probe: NetworkProbe
  private recentLatencies: number[] = [] // 最近 10 片的耗时
  private adjustCounter = 0

  constructor(initialChunkSize: number, probe: NetworkProbe) {
    this.chunkSize = initialChunkSize
    this.probe = probe
  }

  getChunkSize(): number {
    return this.chunkSize
  }

  /** 记录一片的实际上传耗时 */
  recordLatency(ms: number): void {
    this.recentLatencies.push(ms)
    if (this.recentLatencies.length > 10) {
      this.recentLatencies.shift()
    }

    this.adjustCounter++
    if (this.adjustCounter >= 3) {
      this.adjustCounter = 0
      this.adapt()
    }
  }

  private adapt(): void {
    if (this.recentLatencies.length < 3) return

    const avgLatency = this.recentLatencies.reduce((a, b) => a + b, 0) / this.recentLatencies.length
    const TARGET = 5000 // 目标 5 秒/片

    if (avgLatency > 10000) {
      // 连续超时 → 缩小分片
      this.chunkSize = Math.max(128 * 1024, Math.round(this.chunkSize * 0.5))
    } else if (avgLatency < 1000 && this.recentLatencies.length >= 5) {
      // 连续快速 → 放大分片
      this.chunkSize = Math.min(16 * 1024 * 1024, Math.round(this.chunkSize * 1.5))
    } else if (avgLatency > TARGET * 1.5) {
      this.chunkSize = Math.max(128 * 1024, Math.round(this.chunkSize * 0.75))
    } else if (avgLatency < TARGET * 0.5) {
      this.chunkSize = Math.min(16 * 1024 * 1024, Math.round(this.chunkSize * 1.25))
    }
  }
}

// ---- helpers ----

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function getEffectiveType(): string {
  return (navigator as any).connection?.effectiveType ?? '4g'
}

function estimateBandwidth(): number {
  const map: Record<string, number> = {
    'slow-2g': 50 * 1024,
    '2g': 100 * 1024,
    '3g': 500 * 1024,
    '4g': 5 * 1024 * 1024,
    '5g': 20 * 1024 * 1024,
  }
  return map[getEffectiveType()] ?? 2 * 1024 * 1024
}