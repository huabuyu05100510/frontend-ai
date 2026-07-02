// ============================================================
// HTTP 协议对比 — 上传策略矩阵
// HTTP/1.1 (XHR) vs HTTP/2 (multiplex fetch) vs HTTP/3 (WebTransport QUIC)
// ============================================================

import type { UploadConfig } from './types'
import { retryWithBackoff } from './concurrency'
import { webTransportUpload, supportsWebTransport } from './webtransport-upload'

// ============================================================
// HTTP/1.1 策略 — XHR 基准方案
// 限制：6 连接上限、队头阻塞、无多路复用
// 优势：兼容性 100%、ProgressEvent 精确进度
// ============================================================
export async function http1Upload(
  file: File, config: UploadConfig, hash: string,
  signal?: AbortSignal,
  onProgress?: (pct: number) => void,
): Promise<{ url: string; protocol: string }> {
  const totalChunks = Math.ceil(file.size / config.chunkSize)
  const completed = new Set<number>()

  const uploadChunk = async (index: number): Promise<void> => {
    const chunk = file.slice(index * config.chunkSize, Math.min((index + 1) * config.chunkSize, file.size))
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const form = new FormData()
      form.append('chunk', chunk, `${hash}_${index}`)
      form.append('hash', hash)
      form.append('index', String(index))
      form.append('total', String(totalChunks))

      signal?.addEventListener('abort', () => { xhr.abort(); reject(new DOMException('Aborted', 'AbortError')) })
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) {
          const pct = Math.round(((completed.size + (e.loaded / e.total)) / totalChunks) * 100)
          onProgress?.(pct)
        }
      }
      xhr.onload = () => {
        if (xhr.status < 300) { completed.add(index); resolve() }
        else reject(new Error(`HTTP ${xhr.status}`))
      }
      xhr.onerror = () => reject(new Error('Network error'))
      xhr.open('POST', config.chunkUrl)
      if (config.headers) Object.entries(config.headers).forEach(([k, v]) => xhr.setRequestHeader(k, v))
      xhr.send(form)
    })
  }

  const concurrency = Math.min(3, totalChunks)
  const chunks = Array.from({ length: totalChunks }, (_, i) => i)
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency)
    await Promise.allSettled(batch.map(j => retryWithBackoff(() => uploadChunk(j), config.retry)))
  }

  // 合并
  const resp = await fetch(config.mergeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...config.headers },
    body: JSON.stringify({ hash, total: totalChunks, fileName: file.name }),
    signal,
  })
  return { url: (await resp.json()).url, protocol: 'HTTP/1.1' }
}

// ============================================================
// HTTP/2 策略 — Fetch 多路复用
// 优势：单连接多流、服务端推送、头部压缩
// 限制：仍有 TCP 队头阻塞（丢包影响所有流）
// ============================================================
export async function http2Upload(
  file: File, config: UploadConfig, hash: string,
  signal?: AbortSignal,
  onProgress?: (pct: number) => void,
): Promise<{ url: string; protocol: string }> {
  const totalChunks = Math.ceil(file.size / config.chunkSize)
  const completed = new Set<number>()

  function updateProgress(): void {
    onProgress?.(Math.round((completed.size / totalChunks) * 100))
  }

  const uploadChunk = async (index: number): Promise<void> => {
    const chunk = file.slice(index * config.chunkSize, Math.min((index + 1) * config.chunkSize, file.size))
    const form = new FormData()
    form.append('chunk', chunk, `${hash}_${index}`)
    form.append('hash', hash)
    form.append('index', String(index))
    form.append('total', String(totalChunks))

    await retryWithBackoff(async () => {
      const resp = await fetch(config.chunkUrl, {
        method: 'POST',
        headers: config.headers,
        body: form,
        signal,
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      completed.add(index)
      updateProgress()
    }, config.retry)
  }

  // HTTP/2 可真正并发所有分片（无 6 连接限制），但用 Semaphore 避免服务端过载
  const concurrency = Math.min(8, totalChunks) // HTTP/2 可有更高并发
  const chunks = Array.from({ length: totalChunks }, (_, i) => i)
  const promises: Promise<void>[] = []
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency)
    promises.push(...batch.map(j => uploadChunk(j)))
  }
  await Promise.allSettled(promises)

  // 合并
  const resp = await fetch(config.mergeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...config.headers },
    body: JSON.stringify({ hash, total: totalChunks, fileName: file.name }),
    signal,
  })
  return { url: (await resp.json()).url, protocol: 'HTTP/2' }
}

// ============================================================
// HTTP/3 策略 — WebTransport QUIC
// 优势：0-RTT 握、真正独立流、无队头阻塞
// 限制：需要 QUIC 服端 + 证书
// ============================================================
export async function http3Upload(
  file: File, config: UploadConfig, hash: string,
  signal?: AbortSignal,
  onProgress?: (pct: number) => void,
): Promise<{ url: string; protocol: string }> {
  if (!supportsWebTransport()) {
    throw new Error('WebTransport not supported')
  }

  const url = await webTransportUpload({
    url: config.chunkUrl.replace('/chunk', '/wt'),
    file,
    chunkSize: config.chunkSize,
    signal,
    onProgress: onProgress ?? (() => {}),
    onChunk: () => {},
  })
  return { url, protocol: 'HTTP/3 (WebTransport/QUIC)' }
}

// ============================================================
// 协议选择器 — 自动降级
// ============================================================
export type HttpProtocol = 'http1' | 'http2' | 'http3' | 'auto'

export async function uploadWithProtocol(
  protocol: HttpProtocol,
  file: File, config: UploadConfig, hash: string,
  signal?: AbortSignal,
  onProgress?: (pct: number) => void,
): Promise<{ url: string; protocol: string }> {
  if (protocol === 'http3') {
    try { return await http3Upload(file, config, hash, signal, onProgress) } catch {}
  }
  if (protocol === 'http2') {
    return http2Upload(file, config, hash, signal, onProgress)
  }
  if (protocol === 'http1') {
    return http1Upload(file, config, hash, signal, onProgress)
  }

  // auto: http3 → http2 → http1 逐级降级
  try { return await http3Upload(file, config, hash, signal, onProgress) } catch {}
  try { return await http2Upload(file, config, hash, signal, onProgress) } catch {}
  return http1Upload(file, config, hash, signal, onProgress)
}

// ============================================================
// 协议对比指标
// ============================================================
export interface ProtocolMetrics {
  protocol: string
  totalChunks: number
  concurrency: number
  duration: number
  avgChunkTime: number
  throughput: number  // bytes/s
  overheadPerChunk: number  // HTTP 头开销 / 片
}

export const ProtocolInfo: Record<string, {
  name: string
  connectionLimit: string
  multiplexing: string
  headOfLineBlocking: string
  progressSupport: string
  browserSupport: string
}> = {
  'HTTP/1.1': {
    name: 'HTTP/1.1 (XHR)',
    connectionLimit: '6 个连接/域',
    multiplexing: '无（每次请求占一个连接）',
    headOfLineBlocking: '有（TCP + HTTP 双层队头阻塞）',
    progressSupport: '✅ xhr.upload.onprogress',
    browserSupport: '100%',
  },
  'HTTP/2': {
    name: 'HTTP/2 (Fetch Multiplex)',
    connectionLimit: '1 连接/域（无限流）',
    multiplexing: '✅ 单连接多 Stream',
    headOfLineBlocking: '部分（TCP 层仍有队头阻塞）',
    progressSupport: '❌ fetch 无上传进度',
    browserSupport: '97%+',
  },
  'HTTP/3 (WebTransport/QUIC)': {
    name: 'HTTP/3 (WebTransport/QUIC)',
    connectionLimit: '1 连接/域（无限流）',
    multiplexing: '✅ 真正独立流，无队头阻塞',
    headOfLineBlocking: '无（QUIC 独立流重传）',
    progressSupport: '自定义 ACK 协议',
    browserSupport: 'Chrome 97+',
  },
}