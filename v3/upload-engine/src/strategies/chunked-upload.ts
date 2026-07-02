// ============================================================
// 大文件分片上传 v2
// 集成断路器 + 自适应并发 + Merkle Tree 完整性校验
// ============================================================

import type { UploadConfig } from '../types'
import { Semaphore, retryWithBackoff, NonRetryableError } from '../concurrency'
import { ResumeStore } from '../resume-store'
import { CircuitBreaker } from '../circuit-breaker'
import { ConnectionManager } from '../connection-manager'
import { StreamingMerkleTree, sha256Hex } from '../merkle'

interface ChunkedUploadOptions {
  file: File
  config: UploadConfig
  hash: string
  signal?: AbortSignal
  circuitBreaker: CircuitBreaker
  connectionManager: ConnectionManager
  merkle: StreamingMerkleTree
  onChunk: (index: number, progress: number) => void
  onProgress: (pct: number) => void
  onChunkComplete: (index: number, latencyMs: number, success: boolean) => void
}

export async function chunkedUpload(opts: ChunkedUploadOptions): Promise<string> {
  const {
    file, config, hash, signal, circuitBreaker, connectionManager, merkle,
    onChunk, onProgress, onChunkComplete,
  } = opts

  const totalChunks = Math.ceil(file.size / config.chunkSize)

  // 断点续传
  let resume = ResumeStore.get(hash)
  if (!resume) {
    resume = { fileName: file.name, fileSize: file.size, totalChunks, uploadedIndexes: [], hash }
    ResumeStore.set(hash, resume)
  }

  const completedSet = new Set(resume.uploadedIndexes)
  function updateOverallProgress(): void {
    onProgress(Math.round((completedSet.size / totalChunks) * 100))
  }
  updateOverallProgress()

  const pending = Array.from({ length: totalChunks }, (_, i) => i)
    .filter(i => !completedSet.has(i))

  // 为已完成的分片补充 Merkle Tree（恢复场景）
  // 这里简化：已完成分片已在服务端，只需上传剩余分片

  const uploadChunk = async (index: number): Promise<void> => {
    const start = index * config.chunkSize
    const end = Math.min(start + config.chunkSize, file.size)
    const blob = file.slice(start, end)
    const chunkStart = performance.now()

    // 断路器包裹
    await circuitBreaker.call(async () => {
      await retryWithBackoff(async () => {
        return new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          const form = new FormData()
          form.append('chunk', blob, `${hash}_${index}`)
          form.append('hash', hash)
          form.append('index', String(index))
          form.append('total', String(totalChunks))

          signal?.addEventListener('abort', () => {
            xhr.abort()
            reject(new DOMException('Aborted', 'AbortError'))
          })

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onChunk(index, Math.round((e.loaded / e.total) * 100))
          }

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              // 计算此片真实 SHA-256，按分片序号写入 Merkle 叶子（与完成顺序无关）
              blob.arrayBuffer()
                .then(buf => sha256Hex(buf))
                .then(chunkHash => {
                  merkle.setLeaf(index, chunkHash)
                  completedSet.add(index)
                  ResumeStore.markUploaded(hash, index)
                  updateOverallProgress()
                  onChunkComplete(index, performance.now() - chunkStart, true)
                  resolve()
                })
                .catch(reject)
            } else if (xhr.status >= 400 && xhr.status < 500) {
              // 4xx 客户端错误：不可重试，直接判定失败（避免缺片仍 merge）
              onChunkComplete(index, performance.now() - chunkStart, false)
              reject(new NonRetryableError(`Chunk ${index} HTTP ${xhr.status}`))
            } else {
              onChunkComplete(index, performance.now() - chunkStart, false)
              reject(new Error(`Chunk ${index} HTTP ${xhr.status}`))
            }
          }

          xhr.onerror = () => {
            onChunkComplete(index, performance.now() - chunkStart, false)
            reject(new Error(`Chunk ${index} network error`))
          }
          xhr.ontimeout = () => {
            onChunkComplete(index, performance.now() - chunkStart, false)
            reject(new Error(`Chunk ${index} timeout`))
          }

          xhr.open('POST', config.chunkUrl)
          if (config.headers) {
            for (const [k, v] of Object.entries(config.headers)) {
              xhr.setRequestHeader(k, v)
            }
          }
          xhr.send(form)
        })
      }, config.retry)
    })
  }

  // 自适应并发上传
  const semaphore = new Semaphore(connectionManager.maxConcurrent)
  const offChange = connectionManager.onChange((_, newVal) => {
    semaphore.setCapacity(newVal)
  })

  try {
    await Promise.all(
      pending.map(index => semaphore.run(() => uploadChunk(index)))
    )
  } finally {
    offChange?.()
  }

  // 全部分片就位后构建 Merkle 根（按序号有序，真实 SHA-256）
  const merkleRoot = await merkle.finalize(totalChunks)
  if (merkleRoot == null) {
    throw new Error('分片缺失，无法构建完整性校验根')
  }

  // 合并
  const mergeResult = await retryWithBackoff(async () => {
    const resp = await fetch(config.mergeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...config.headers },
      body: JSON.stringify({
        hash,
        total: totalChunks,
        fileName: file.name,
        merkleRoot,
      }),
      signal,
    })
    if (!resp.ok) throw new Error(`Merge HTTP ${resp.status}`)
    const data = await resp.json()
    return data.url ?? ''
  }, 3)

  ResumeStore.remove(hash)
  return mergeResult
}