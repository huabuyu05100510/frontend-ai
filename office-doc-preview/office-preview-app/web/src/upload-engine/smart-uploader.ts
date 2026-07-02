// ============================================================
// SmartUploader v2 — 七层管道调度器
// 魔数校验 → 自适应分片 → 流式哈希 → 断路器 → 并发控制 → 上传 → 校验
// ============================================================

import type { UploadConfig, UploadFile, UploadEvent, ChunkStatus } from './types'
import { validateFiles } from './validator'
import { compressImage, isImageFile, renameByMime } from './image-compressor'
import { computeHash } from './fingerprint'
import { directUpload } from './strategies/direct-upload'
import { chunkedUpload } from './strategies/chunked-upload'
import { probeNetwork, calcChunkSize, AdaptiveChunker } from './adaptive-chunk'
import { ConnectionManager } from './connection-manager'
import { CircuitBreaker } from './circuit-breaker'
import { StreamingMerkleTree } from './merkle'
import { telemetry, UploadMetrics } from './telemetry'

type EventHandler = (e: UploadEvent) => void

export interface UploadOptions {
  config: UploadConfig
  onMetrics?: (metrics: UploadMetrics) => void
}

export class SmartUploader {
  private handlers = new Set<EventHandler>()
  private files = new Map<string, UploadFile>()
  private controllers = new Map<string, AbortController>()
  private fileStore = new Map<string, { file: File; opts: UploadOptions }>()
  private connectionManager = new ConnectionManager()
  private circuitBreaker = new CircuitBreaker({
    onStateChange: (from, to) => {
      if (to === 'OPEN') {
        console.warn(`[CircuitBreaker] 熔断触发: ${from} → ${to}`)
      }
    },
  })

  on(fn: EventHandler): () => void {
    this.handlers.add(fn)
    return () => this.handlers.delete(fn)
  }

  private emit(e: UploadEvent): void {
    this.handlers.forEach(h => h(e))
  }

  private createFile(file: File, config: UploadConfig): UploadFile {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const totalChunks = config.chunkSize > 0
      ? Math.ceil(file.size / config.chunkSize)
      : 0
    const chunks: ChunkStatus[] = Array.from({ length: totalChunks }, (_, i) => ({
      index: i, uploaded: false, progress: 0, retries: 0,
    }))

    const uf: UploadFile = {
      id, name: file.name, size: file.size, type: file.type,
      status: 'idle', progress: 0, hash: null, url: null,
      error: null, previewUrl: null, compressedSize: null,
      compressMeta: null,
      chunks, createdAt: Date.now(),
    }

    if (file.type.startsWith('image/')) {
      uf.previewUrl = URL.createObjectURL(file)
    }

    this.files.set(id, uf)
    return uf
  }

  async upload(file: File, opts: UploadOptions): Promise<UploadFile> {
    const { config, onMetrics } = opts
    const uf = this.createFile(file, config)
    const ac = new AbortController()
    this.controllers.set(uf.id, ac)
    this.fileStore.set(uf.id, { file, opts })

    const startTime = performance.now()

    try {
      // 网络探测 + 自适应分片
      const probe = await probeNetwork(config.chunkUrl || config.uploadUrl)
      const adaptiveChunkSize = config.chunkSize > 0
        ? calcChunkSize(probe, file.size)
        : config.chunkSize

      // 覆盖 config 中的 chunkSize（运行时自适应）
      const effectiveConfig = { ...config, chunkSize: adaptiveChunkSize }

      // 重新计算分片
      if (adaptiveChunkSize > 0 && adaptiveChunkSize !== config.chunkSize) {
        const newTotal = Math.ceil(file.size / adaptiveChunkSize)
        const u = this.files.get(uf.id)!
        u.chunks = Array.from({ length: newTotal }, (_, i) => ({
          index: i, uploaded: false, progress: 0, retries: 0,
        }))
      }

      telemetry.startFile(uf.id, file.size, probe.effectiveType, probe.rtt)

      await this.runPipeline(uf, file, effectiveConfig, ac.signal, startTime, onMetrics)
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message === 'Aborted') {
        if (this.files.get(uf.id)?.status !== 'paused') {
          this.updateStatus(uf.id, 'cancelled')
        }
        telemetry.recordAbort(uf.id, 'user_cancel')
      } else {
        this.updateStatus(uf.id, 'failed')
        this.files.get(uf.id)!.error = err.message ?? String(err)
        telemetry.recordAbort(uf.id, err.message ?? 'unknown')
      }
    }

    return this.files.get(uf.id)!
  }

  private async runPipeline(
    uf: UploadFile,
    file: File,
    config: UploadConfig,
    signal: AbortSignal,
    startTime: number,
    onMetrics?: (m: UploadMetrics) => void,
  ): Promise<void> {
    const checkSignal = () => { if (signal.aborted) throw new DOMException('Aborted', 'AbortError') }

    // 1. 校验（含魔数）
    this.updateStatus(uf.id, 'validating')
    const errors = await validateFiles([file], config)
    if (errors.length > 0) throw new Error(errors[0].message)
    checkSignal()

    // 2. 图片处理（按文件类型驱动，与场景白名单解耦：任意图片均可压缩/矫正）
    let targetFile: File = file
    if ((config.compress || config.exifCorrect) && isImageFile(file)) {
      this.updateStatus(uf.id, 'processing')
      try {
        const result = await compressImage(file, {
          maxPx: config.compressMaxPx,
          quality: config.compressQuality,
          format: config.compressFormat,
          targetKB: config.compressTargetKB,
          exifCorrect: config.exifCorrect,
        })
        if (result.changed) {
          targetFile = new File(
            [result.blob],
            renameByMime(file.name, result.toFormat),
            { type: result.toFormat },
          )
          const u = this.files.get(uf.id)!
          u.compressedSize = result.compressedSize
          u.compressMeta = {
            fromFormat: result.fromFormat,
            toFormat: result.toFormat,
            quality: result.quality,
            ratio: result.ratio,
            width: result.width,
            height: result.height,
            durationMs: result.durationMs,
            engine: result.engine,
          }
        }
      } catch (err) {
        // 压缩失败不阻断上传，回退原图
        console.warn('[compress] 失败，回退原图:', err)
      }
      checkSignal()
    }

    // 3. 指纹计算
    const hashStart = performance.now()
    this.updateStatus(uf.id, 'hashing')
    const hash = await computeHash(targetFile)
    const hashDuration = performance.now() - hashStart
    checkSignal()
    const u = this.files.get(uf.id)!
    u.hash = hash
    this.emit({ type: 'hash', fileId: uf.id, hash })

    // 4. 秒传检查（适配器模式跳过：交由存储侧自身的去重/覆盖策略）
    this.updateStatus(uf.id, 'checking')
    const instantUrl = config.adapter
      ? null
      : await this.checkInstant(hash, targetFile.name, config, signal)
    checkSignal()
    if (instantUrl) {
      const u = this.files.get(uf.id)!
      u.url = instantUrl
      u.status = 'instant'
      u.progress = 100
      this.emit({ type: 'instant', fileId: uf.id, url: instantUrl })
      return
    }

    // 5. 上传
    const uploadStart = performance.now()
    this.updateStatus(uf.id, 'uploading')
    const uploadFile = targetFile

    // 5a. 存储适配器接管（OSS/COS/S3 等）——绕过内置 REST 策略
    if (config.adapter) {
      const { url } = await config.adapter.upload(uploadFile, {
        hash,
        signal,
        onProgress: (pct) => this.updateProgress(uf.id, pct),
      })
      const u = this.files.get(uf.id)!
      u.url = url
      u.progress = 100
      this.emit({ type: 'done', fileId: uf.id, url })
      onMetrics?.(telemetry.finishFile(uf.id, {
        total: performance.now() - startTime,
        hash: hashDuration,
        upload: performance.now() - uploadStart,
        merge: 0,
      }, 0, 1, 1)!)
      this.updateStatus(uf.id, 'done')
      return
    }

    const merkle = new StreamingMerkleTree()

    if (config.chunkSize > 0) {
      const url = await chunkedUpload({
        file: uploadFile,
        config,
        hash,
        signal,
        circuitBreaker: this.circuitBreaker,
        connectionManager: this.connectionManager,
        merkle,
        onChunk: (index, progress) => {
          this.emit({ type: 'chunk', fileId: uf.id, index, progress })
          const u = this.files.get(uf.id)
          if (u && u.chunks[index]) u.chunks[index].progress = progress
        },
        onProgress: (pct) => this.updateProgress(uf.id, pct),
        onChunkComplete: (index, latency, success) => {
          this.connectionManager.recordChunk(latency, success)
          telemetry.recordChunk(uf.id, latency, success)
        },
      })

      const uploadDuration = performance.now() - uploadStart
      // chunkedUpload 内部已完成 merge（含 Merkle root 校验），无需二次合并

      const u = this.files.get(uf.id)!
      u.url = url
      u.progress = 100
      this.emit({ type: 'done', fileId: uf.id, url })

      onMetrics?.(telemetry.finishFile(uf.id, {
        total: performance.now() - startTime,
        hash: hashDuration,
        upload: uploadDuration,
        merge: 0,
      }, config.chunkSize, merkle.getLeafCount(), this.connectionManager.maxConcurrent)!)
    } else {
      const url = await directUpload({
        file: uploadFile,
        config,
        hash,
        signal,
        onProgress: (pct) => this.updateProgress(uf.id, pct),
      })

      const uploadDuration = performance.now() - uploadStart
      const u = this.files.get(uf.id)!
      u.url = url
      u.progress = 100
      this.emit({ type: 'done', fileId: uf.id, url })

      onMetrics?.(telemetry.finishFile(uf.id, {
        total: performance.now() - startTime,
        hash: hashDuration,
        upload: uploadDuration,
        merge: 0,
      }, 0, 1, 1)!)
    }

    this.updateStatus(uf.id, 'done')
  }

  private async checkInstant(
    hash: string, fileName: string, config: UploadConfig, signal?: AbortSignal,
  ): Promise<string | null> {
    try {
      const resp = await fetch(config.checkUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...config.headers },
        body: JSON.stringify({ hash, fileName }),
        signal,
      })
      if (resp.ok) {
        const data = await resp.json()
        return data.url ?? null
      }
      return null
    } catch { return null }
  }

  // ---- 状态更新 ----

  private updateStatus(id: string, status: UploadFile['status']) {
    const u = this.files.get(id)
    if (u) u.status = status
    this.emit({ type: 'status', fileId: id, status })
  }

  private updateProgress(id: string, progress: number) {
    const u = this.files.get(id)
    if (u) u.progress = progress
    this.emit({ type: 'progress', fileId: id, progress })
  }

  // ---- 控制 ----

  pause(id: string) {
    this.controllers.get(id)?.abort()
    this.updateStatus(id, 'paused')
  }

  resume(id: string) {
    const stored = this.fileStore.get(id)
    if (!stored) return
    // 清理旧暂停条目，upload() 会创建新条目
    this.files.delete(id)
    this.controllers.delete(id)
    this.upload(stored.file, stored.opts)
  }

  cancel(id: string) {
    this.controllers.get(id)?.abort()
    const u = this.files.get(id)
    if (u?.previewUrl) URL.revokeObjectURL(u.previewUrl)
    this.files.delete(id)
    this.controllers.delete(id)
    this.fileStore.delete(id)
    this.emit({ type: 'cancel', fileId: id })
  }

  cancelAll() {
    for (const [id] of this.files) this.cancel(id)
  }

  clearCompleted() {
    for (const [id, f] of this.files) {
      if (f.status === 'done' || f.status === 'instant') {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
        this.files.delete(id)
        this.controllers.delete(id)
        this.fileStore.delete(id)
      }
    }
    this.emit({ type: 'cancel', fileId: '' })
  }

  getFile(id: string): UploadFile | undefined { return this.files.get(id) }
  getAllFiles(): UploadFile[] { return Array.from(this.files.values()) }
  getConnectionManager(): ConnectionManager { return this.connectionManager }
  getCircuitBreaker(): CircuitBreaker { return this.circuitBreaker }
}