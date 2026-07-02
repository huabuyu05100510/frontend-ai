// ============================================================
// 图片压缩编排层
//   - 优先用 Web Worker（OffscreenCanvas）压缩，主线程零阻塞
//   - 不支持 Worker/OffscreenCanvas 时降级到主线程 Canvas
//   - 单 Worker 复用 + id 路由，避免反复创建销毁开销
// ============================================================

import CompressWorker from './workers/image-compressor.worker?worker'
import type {
  CompressRequest,
  CompressResponse,
} from './workers/image-compressor.worker'
import type { CompressFormat } from './types'

export interface CompressOptions {
  maxPx: number
  quality: number
  format?: CompressFormat
  targetKB?: number
  exifCorrect: boolean
  /** 强制执行环境（基准测试用）：auto 默认优先 worker */
  engine?: 'auto' | 'worker' | 'main'
}

export interface CompressResult {
  blob: Blob
  width: number
  height: number
  fromFormat: string
  toFormat: string
  quality: number
  originalSize: number
  compressedSize: number
  ratio: number
  changed: boolean
  durationMs: number
  engine: 'worker' | 'main'
}

const EXT_BY_MIME: Record<string, string> = {
  'image/avif': 'avif',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

/** 按输出 MIME 重写文件扩展名（格式变更时） */
export function renameByMime(name: string, mime: string): string {
  const ext = EXT_BY_MIME[mime]
  if (!ext) return name
  const dot = name.lastIndexOf('.')
  const base = dot >= 0 ? name.slice(0, dot) : name
  return `${base}.${ext}`
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif'].includes(ext)
}

const workerSupported =
  typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, (r: CompressResponse) => void>()

function getWorker(): Worker {
  if (worker) return worker
  const w = new CompressWorker()
  w.onmessage = (e: MessageEvent<CompressResponse>) => {
    const cb = pending.get(e.data.id)
    if (cb) {
      pending.delete(e.data.id)
      cb(e.data)
    }
  }
  w.onerror = () => {
    // 整体崩溃：拒绝所有挂起请求，下次重建
    for (const cb of pending.values()) {
      cb({ id: -1, type: 'error', error: 'worker crashed' } as CompressResponse)
    }
    pending.clear()
    w.terminate()
    worker = null
  }
  worker = w
  return w
}

export async function compressImage(
  file: File,
  opts: CompressOptions,
): Promise<CompressResult> {
  const engine = opts.engine ?? 'auto'
  if (engine === 'main') return compressOnMain(file, opts)
  if (workerSupported) {
    try {
      return await compressInWorker(file, opts)
    } catch (err) {
      if (engine === 'worker') throw err // 显式要求 worker 则不静默兜底
      // auto：worker 异常 → 主线程兜底
    }
  }
  return compressOnMain(file, opts)
}

function compressInWorker(file: File, opts: CompressOptions): Promise<CompressResult> {
  return new Promise((resolve, reject) => {
    const id = ++seq
    const req: CompressRequest = {
      id,
      file,
      maxPx: opts.maxPx,
      quality: opts.quality,
      format: opts.format ?? 'auto',
      targetKB: opts.targetKB,
      exifCorrect: opts.exifCorrect,
    }
    pending.set(id, (resp) => {
      if (resp.type === 'error') {
        reject(new Error(resp.error))
        return
      }
      resolve({
        blob: resp.blob,
        width: resp.width,
        height: resp.height,
        fromFormat: resp.fromFormat,
        toFormat: resp.toFormat,
        quality: resp.quality,
        originalSize: resp.originalSize,
        compressedSize: resp.compressedSize,
        ratio: resp.originalSize > 0 ? 1 - resp.compressedSize / resp.originalSize : 0,
        changed: resp.changed,
        durationMs: resp.durationMs,
        engine: 'worker',
      })
    })
    getWorker().postMessage(req)
  })
}

// ---- 主线程兜底（无 Worker/OffscreenCanvas 时）----
async function compressOnMain(file: File, opts: CompressOptions): Promise<CompressResult> {
  const t0 = performance.now()
  const bitmap = await createImageBitmap(file, {
    imageOrientation: opts.exifCorrect ? 'from-image' : 'none',
  })
  let { width, height } = bitmap
  const maxDim = Math.max(width, height)
  if (opts.maxPx > 0 && maxDim > opts.maxPx) {
    const scale = opts.maxPx / maxDim
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const alpha = /png|webp|gif/i.test(file.type)
  let toFormat: string = opts.format && opts.format !== 'auto'
    ? opts.format
    : (alpha ? 'image/webp' : 'image/jpeg')

  const quality = toFormat === 'image/png' ? 1 : opts.quality
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob 失败'))),
      toFormat,
      quality,
    )
  })
  // toBlob 对不支持类型会回退 png
  if (blob.type !== toFormat) toFormat = blob.type

  const changed = blob.size < file.size
  const out = changed ? blob : file
  return {
    blob: out,
    width: changed ? width : bitmap.width,
    height: changed ? height : bitmap.height,
    fromFormat: file.type || 'unknown',
    toFormat: changed ? toFormat : (file.type || 'unknown'),
    quality: changed ? quality : 1,
    originalSize: file.size,
    compressedSize: out.size,
    ratio: file.size > 0 ? 1 - out.size / file.size : 0,
    changed,
    durationMs: performance.now() - t0,
    engine: 'main',
  }
}
