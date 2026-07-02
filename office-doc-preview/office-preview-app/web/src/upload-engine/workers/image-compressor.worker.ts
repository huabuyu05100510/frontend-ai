// ============================================================
// Web Worker — 顶级图片压缩管线
//   解码(EXIF 自动矫正) → 降采样 → 格式自适应择优 → 目标体积自适应质量
//   全程 OffscreenCanvas，主线程零阻塞；对标 squoosh / veImageX 前端管线
// ============================================================

export interface CompressRequest {
  id: number
  file: File
  maxPx: number
  quality: number
  format: 'auto' | 'image/avif' | 'image/webp' | 'image/jpeg' | 'image/png'
  targetKB?: number
  exifCorrect: boolean
}

export interface CompressDone {
  id: number
  type: 'done'
  blob: Blob
  width: number
  height: number
  fromFormat: string
  toFormat: string
  quality: number
  originalSize: number
  compressedSize: number
  changed: boolean
  durationMs: number
}

export interface CompressError {
  id: number
  type: 'error'
  error: string
}

export type CompressResponse = CompressDone | CompressError

// ---- 浏览器编码能力探测（结果缓存）----
const ENCODE_SUPPORT = new Map<string, boolean>()

async function canEncode(type: string): Promise<boolean> {
  if (ENCODE_SUPPORT.has(type)) return ENCODE_SUPPORT.get(type)!
  let ok = false
  try {
    const probe = new OffscreenCanvas(2, 2)
    const ctx = probe.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, 2, 2)
      const blob = await probe.convertToBlob({ type, quality: 0.5 })
      // convertToBlob 对不支持的类型会静默降级为 image/png
      ok = blob.type === type
    }
  } catch {
    ok = false
  }
  ENCODE_SUPPORT.set(type, ok)
  return ok
}

/** 透明通道格式：避免被编码成不支持透明的 JPEG */
function sourceHasAlpha(mime: string): boolean {
  return /png|webp|gif|avif|svg|image\/png|image\/webp/i.test(mime)
}

/**
 * 选择最优输出格式：
 *  - 用户指定且浏览器可编码 → 用之
 *  - auto：含透明 → [avif, webp, png]，否则 [avif, webp, jpeg]，按浏览器能力降级
 */
async function pickFormat(
  requested: CompressRequest['format'],
  sourceMime: string,
): Promise<string> {
  if (requested !== 'auto' && (await canEncode(requested))) return requested

  const alpha = sourceHasAlpha(sourceMime)
  const prefs = alpha
    ? ['image/avif', 'image/webp', 'image/png']
    : ['image/avif', 'image/webp', 'image/jpeg']
  for (const fmt of prefs) {
    if (await canEncode(fmt)) return fmt
  }
  return 'image/jpeg'
}

async function encode(
  canvas: OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Blob> {
  // PNG 为无损，quality 参数被忽略
  return canvas.convertToBlob({ type, quality })
}

/**
 * 目标体积自适应：在 [0.4, 0.95] 间二分质量，逼近 targetKB。
 * 最多 6 次迭代（log2(0.55/0.01)≈6），收敛快、不卡顿。
 */
async function encodeToTarget(
  canvas: OffscreenCanvas,
  type: string,
  targetBytes: number,
): Promise<{ blob: Blob; quality: number }> {
  let lo = 0.4
  let hi = 0.95
  let best: Blob | null = null
  let bestQ = hi

  for (let i = 0; i < 6; i++) {
    const q = (lo + hi) / 2
    const blob = await encode(canvas, type, q)
    if (blob.size <= targetBytes) {
      best = blob
      bestQ = q
      lo = q // 还能再提质量
    } else {
      hi = q // 体积超标，降质量
    }
  }
  if (!best) {
    best = await encode(canvas, type, lo)
    bestQ = lo
  }
  return { blob: best, quality: bestQ }
}

async function compress(req: CompressRequest): Promise<CompressDone> {
  const t0 = performance.now()
  const { file, maxPx, quality, format, targetKB, exifCorrect } = req

  // 解码：imageOrientation:'from-image' 让浏览器自动应用 EXIF 方向，
  // 比手写变换矩阵更可靠，且在 compositor 线程解码
  const bitmap = await createImageBitmap(file, {
    imageOrientation: exifCorrect ? 'from-image' : 'none',
  })

  let { width, height } = bitmap
  const maxDim = Math.max(width, height)
  if (maxPx > 0 && maxDim > maxPx) {
    const scale = maxPx / maxDim
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2D context 不可用')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const toFormat = await pickFormat(format, file.type)

  let blob: Blob
  let usedQuality: number
  const lossy = toFormat !== 'image/png'
  if (targetKB && lossy) {
    const res = await encodeToTarget(canvas, toFormat, targetKB * 1024)
    blob = res.blob
    usedQuality = res.quality
  } else {
    usedQuality = lossy ? quality : 1
    blob = await encode(canvas, toFormat, usedQuality)
  }

  // 反向保护：压缩后反而更大（小图/已高度压缩）→ 回退原图
  const changed = blob.size < file.size
  if (!changed) {
    return {
      id: req.id, type: 'done',
      blob: file,
      width: bitmap.width, height: bitmap.height,
      fromFormat: file.type || 'unknown',
      toFormat: file.type || 'unknown',
      quality: 1,
      originalSize: file.size,
      compressedSize: file.size,
      changed: false,
      durationMs: performance.now() - t0,
    }
  }

  return {
    id: req.id, type: 'done',
    blob,
    width, height,
    fromFormat: file.type || 'unknown',
    toFormat,
    quality: usedQuality,
    originalSize: file.size,
    compressedSize: blob.size,
    changed: true,
    durationMs: performance.now() - t0,
  }
}

self.onmessage = async (e: MessageEvent<CompressRequest>) => {
  try {
    const result = await compress(e.data)
    ;(self as unknown as Worker).postMessage(result)
  } catch (err) {
    const resp: CompressError = {
      id: e.data.id, type: 'error', error: String((err as Error)?.message ?? err),
    }
    ;(self as unknown as Worker).postMessage(resp)
  }
}
