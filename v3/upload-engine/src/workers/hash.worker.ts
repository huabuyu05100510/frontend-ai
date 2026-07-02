// ============================================================
// Web Worker — 采样 SHA-256 指纹
// 策略：首 2MB + 尾 2MB + size + lastModified
// 1GB 文件 < 50ms，主线程零阻塞
// 生产可替换为 WASM MD5（150-300 MB/s），接口不变
// ============================================================

async function computeFingerprint(file: File): Promise<string> {
  const SAMPLE_SIZE = 2 * 1024 * 1024 // 2MB
  const sizeBytes = new ArrayBuffer(8)
  new DataView(sizeBytes).setBigUint64(0, BigInt(file.size), false)

  const modBytes = new ArrayBuffer(8)
  new DataView(modBytes).setBigUint64(0, BigInt(file.lastModified), false)

  async function readChunk(start: number, size: number): Promise<ArrayBuffer> {
    const blob = file.slice(start, start + size)
    return blob.arrayBuffer()
  }

  const parts: ArrayBuffer[] = []

  // 首部采样
  parts.push(await readChunk(0, Math.min(SAMPLE_SIZE, file.size)))

  // 尾部采样（文件 > 首部采样大小时才读）
  if (file.size > SAMPLE_SIZE) {
    const tailStart = Math.max(file.size - SAMPLE_SIZE, SAMPLE_SIZE)
    parts.push(await readChunk(tailStart, Math.min(SAMPLE_SIZE, file.size - tailStart)))
  }

  parts.push(sizeBytes)
  parts.push(modBytes)

  // 合并所有 buffer
  const totalLen = parts.reduce((sum, p) => sum + p.byteLength, 0)
  const merged = new Uint8Array(totalLen)
  let offset = 0
  for (const p of parts) {
    merged.set(new Uint8Array(p), offset)
    offset += p.byteLength
  }

  const hash = await crypto.subtle.digest('SHA-256', merged)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

self.onmessage = async (e: MessageEvent<{ file: File }>) => {
  try {
    const hash = await computeFingerprint(e.data.file)
    self.postMessage({ type: 'done', hash } as HashResult)
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err) } as HashResult)
  }
}

export type HashResult =
  | { type: 'done'; hash: string }
  | { type: 'error'; error: string }