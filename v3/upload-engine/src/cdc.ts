// ============================================================
// Content-Defined Chunking — Rabin 指纹算法
// 对标：rsync / Dropbox / ZFS dedup
// 核心：分片边界由内容决定，而非固定偏移量
//       文件插入 1 字节 → 仅影响 1-2 片，其余命中缓存
// 跨文件秒传率从「同文件命中」提升到「同内容命中」
// ============================================================

// Rabin 多项式参数（32 位）
const WINDOW_SIZE = 48  // 滑动窗口字节数
const PRIME = 3n  // 基数
const MODULUS = 1n << 32n  // 2^32
const MASK = (1n << 20n) - 1n  // 低 20 位掩码（约 1MB 平均分片大小）

export interface CDCChunk {
  offset: number
  size: number
  hash: string  // SHA-256
  weakHash: number  // Rabin 指纹
}

/**
 * Content-Defined Chunking
 * 使用 Rabin 滚动哈希在内容边界处切分
 *
 * 平均分片大小 ≈ 2^20 = 1MB（由 MASK 控制）
 * 最小分片 = 256KB，最大分片 = 4MB（防止过碎/过大）
 *
 * @param buffer 文件内容
 * @param minSize 最小分片大小（默认 256KB）
 * @param maxSize 最大分片大小（默认 4MB）
 * @param avgSize 平均分片大小（控制 MASK 位数，默认 1MB → 20 位）
 */
export function cdcChunk(
  buffer: ArrayBuffer,
  minSize: number = 256 * 1024,
  maxSize: number = 4 * 1024 * 1024,
  avgSize: number = 1024 * 1024,
): ArrayBuffer[] {
  const data = new Uint8Array(buffer)
  const chunks: ArrayBuffer[] = []

  // 根据平均分片大小计算掩码位数
  const maskBits = Math.log2(avgSize)
  const mask = (1n << BigInt(maskBits)) - 1n

  let start = 0
  let window = 0n
  // 预计算：PRIME^WINDOW_SIZE mod MODULUS（用于滚动哈希的移出操作）
  let primePow = 1n
  for (let i = 0; i < WINDOW_SIZE; i++) {
    primePow = (primePow * PRIME) % MODULUS
  }

  for (let i = 0; i < data.length; i++) {
    // 滚动哈希：添加新字节
    window = ((window * PRIME) + BigInt(data[i])) % MODULUS

    // 移除超出窗口的字节
    if (i >= WINDOW_SIZE) {
      window = (window - BigInt(data[i - WINDOW_SIZE]) * primePow) % MODULUS
      if (window < 0n) window += MODULUS
    }

    const chunkSize = i - start + 1

    // 达到最大分片 → 强制切分
    if (chunkSize >= maxSize) {
      chunks.push(buffer.slice(start, i + 1))
      start = i + 1
      window = 0n
      continue
    }

    // 达到最小分片 且 指纹匹配 → 切分
    if (chunkSize >= minSize && (window & mask) === 0n) {
      chunks.push(buffer.slice(start, i + 1))
      start = i + 1
      window = 0n
    }
  }

  // 剩余尾部
  if (start < data.length) {
    chunks.push(buffer.slice(start))
  }

  return chunks
}

/**
 * 流式 CDC：通过 ReadableStream 逐块输出
 * 避免将整个文件加载到内存
 */
export function cdcChunkStream(
  file: File,
  minSize: number = 256 * 1024,
  maxSize: number = 4 * 1024 * 1024,
  avgSize: number = 1024 * 1024,
): ReadableStream<ArrayBuffer> {
  const maskBits = Math.log2(avgSize)
  const mask = (1n << BigInt(maskBits)) - 1n

  let primePow = 1n
  for (let i = 0; i < WINDOW_SIZE; i++) {
    primePow = (primePow * PRIME) % MODULUS
  }

  let window = 0n
  let buffer = new Uint8Array(0)
  let start = 0
  let bytesRead = 0

  return new ReadableStream({
    async start(controller) {
      const reader = file.stream().getReader()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            // 输出剩余尾部
            if (buffer.length > start) {
              controller.enqueue(buffer.slice(start).buffer)
            }
            controller.close()
            break
          }

          // 拼接新数据
          const newBuf = new Uint8Array(buffer.length + value.length)
          newBuf.set(buffer)
          newBuf.set(value, buffer.length)
          buffer = newBuf

          for (let i = bytesRead; i < buffer.length; i++) {
            window = ((window * PRIME) + BigInt(buffer[i])) % MODULUS

            if (i >= WINDOW_SIZE) {
              window = (window - BigInt(buffer[i - WINDOW_SIZE]) * primePow) % MODULUS
              if (window < 0n) window += MODULUS
            }

            const chunkSize = i - start + 1

            if (chunkSize >= maxSize) {
              controller.enqueue(buffer.slice(start, i + 1).buffer)
              start = i + 1
              window = 0n
            } else if (chunkSize >= minSize && (window & mask) === 0n) {
              controller.enqueue(buffer.slice(start, i + 1).buffer)
              start = i + 1
              window = 0n
            }
          }

          bytesRead = buffer.length

          // 内存管理：如果已处理的数据超过 2 * maxSize，回收
          if (start > maxSize * 2) {
            buffer = buffer.slice(start)
            bytesRead -= start
            start = 0
          }
        }
      } catch (err) {
        controller.error(err)
      }
    },
  })
}

/**
 * 计算 Rabin 弱哈希（用于快速比对）
 */
export function rabinWeakHash(data: Uint8Array): number {
  let hash = 0n
  for (let i = 0; i < data.length; i++) {
    hash = ((hash * PRIME) + BigInt(data[i])) % MODULUS
  }
  return Number(hash & 0xFFFFFFFFn)
}

/**
 * 简易 SHA-256（在 Worker 中用 crypto.subtle）
 */
export async function strongHash(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}