// ============================================================
// 上传性能采样
// NICELevel 采样策略 + 关键指标采集
// 对标：阿里云 OSS 上传加速 SDK 内置性能埋点
// ============================================================

export interface UploadMetrics {
  fileSize: number
  chunkSize: number
  chunkCount: number
  concurrency: number
  totalDuration: number       // 总耗时 (ms)
  hashDuration: number        // 哈希耗时 (ms)
  uploadDuration: number      // 纯上传耗时 (ms)
  mergeDuration: number       // 合并耗时 (ms)
  avgChunkLatency: number     // 平均分片延迟 (ms)
  p95ChunkLatency: number     // P95 分片延迟 (ms)
  retryCount: number          // 重试次数
  speed: number               // 平均上传速度 (bytes/s)
  successRate: number         // 分片成功率
  circuitBreakerTrips: number // 断路器熔断次数
  abortReason: string | null  // 中断原因
  networkType: string         // 网络类型
  rtt: number                 // 探测 RTT
}

class Telemetry {
  private metrics = new Map<string, Partial<UploadMetrics>>()
  private latencies = new Map<string, number[]>()

  startFile(fileId: string, fileSize: number, networkType: string, rtt: number): void {
    this.metrics.set(fileId, {
      fileSize,
      networkType,
      rtt,
      circuitBreakerTrips: 0,
      retryCount: 0,
    })
    this.latencies.set(fileId, [])
  }

  recordChunk(fileId: string, latency: number, success: boolean): void {
    const m = this.metrics.get(fileId)
    const lats = this.latencies.get(fileId)
    if (lats) lats.push(latency)
    if (!success && m) m.retryCount!++
  }

  recordCircuitBreakerTrip(fileId: string): void {
    const m = this.metrics.get(fileId)
    if (m) m.circuitBreakerTrips!++
  }

  recordAbort(fileId: string, reason: string): void {
    const m = this.metrics.get(fileId)
    if (m) m.abortReason = reason
  }

  finishFile(fileId: string, durations: {
    total: number; hash: number; upload: number; merge: number
  }, chunkSize: number, chunkCount: number, concurrency: number): UploadMetrics | null {
    const m = this.metrics.get(fileId)
    if (!m) return null

    const latencies = this.latencies.get(fileId) ?? []
    const sorted = [...latencies].sort((a, b) => a - b)
    const p95Idx = Math.floor(sorted.length * 0.95)
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0

    const metrics: UploadMetrics = {
      fileSize: m.fileSize!,
      chunkSize,
      chunkCount,
      concurrency,
      totalDuration: durations.total,
      hashDuration: durations.hash,
      uploadDuration: durations.upload,
      mergeDuration: durations.merge,
      avgChunkLatency: Math.round(avgLatency),
      p95ChunkLatency: sorted[p95Idx] ?? 0,
      retryCount: m.retryCount!,
      speed: durations.upload > 0 ? Math.round(m.fileSize! / (durations.upload / 1000)) : 0,
      successRate: chunkCount > 0
        ? (chunkCount - m.retryCount!) / chunkCount
        : 1,
      circuitBreakerTrips: m.circuitBreakerTrips!,
      abortReason: m.abortReason ?? null,
      networkType: m.networkType!,
      rtt: m.rtt!,
    }

    this.metrics.delete(fileId)
    this.latencies.delete(fileId)
    return metrics
  }

  /** 采样策略：NICELevel 控制 */
  shouldSample(niceLevel: number): boolean {
    if (niceLevel <= 0) return true  // 全量采集
    const rate = 1 / Math.pow(2, niceLevel)
    return Math.random() < rate
  }
}

export const telemetry = new Telemetry()