// ============================================================
// EXIF 方向矫正 + OffscreenCanvas 压缩
// 核心问题：iOS 相机 EXIF Orientation 导致模型接收旋转 90° 图片
// 只读 APP1 头 64KB，零依赖，gzip < 1KB
// ============================================================

/** EXIF Orientation 值 → 变换含义 */
const ORIENTATION_DESC: Record<number, string> = {
  1: '正常',
  3: '旋转 180°',
  6: '顺时针 90°（竖拍）',
  8: '逆时针 90°',
}

export interface ProcessResult {
  blob: Blob
  originalSize: number
  compressedSize: number
  originalOrientation: number
  compressed: boolean
}

export interface ProcessOptions {
  exifCorrect: boolean
  compress: boolean
  compressQuality: number
  compressMaxPx: number
}

/**
 * 读取 EXIF Orientation 标签
 * 只解析 APP1 段，只读前 64KB，不引入第三方库
 */
export function readExifOrientation(buffer: ArrayBuffer): number {
  const view = new DataView(buffer)
  if (view.getUint16(0, false) !== 0xffd8) return 1 // 不是 JPEG

  let offset = 2
  while (offset < Math.min(buffer.byteLength, 65536)) {
    if (offset + 4 > buffer.byteLength) break
    const marker = view.getUint16(offset, false)
    offset += 2
    const length = view.getUint16(offset, false)
    offset += 2

    // APP1 (0xFFE1) 且包含 "Exif\0\0"
    if (marker === 0xffe1 && offset + 6 <= buffer.byteLength) {
      const exifId = String.fromCharCode(...new Uint8Array(buffer, offset, 6))
      if (exifId === 'Exif\x00\x00') {
        return parseOrientation(buffer, offset + 6)
      }
    }
    offset += length - 2
  }
  return 1
}

function parseOrientation(buffer: ArrayBuffer, start: number): number {
  const view = new DataView(buffer)
  // 读取字节序
  const littleEndian = view.getUint16(start, false) === 0x4949
  const tiffOffset = start + 4
  // 跳到 IFD
  const ifd0Offset = tiffOffset + view.getUint32(tiffOffset + (littleEndian ? 0 : 4), littleEndian)
  const entryCount = view.getUint16(ifd0Offset, littleEndian)

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = ifd0Offset + 2 + i * 12
    if (entryOffset + 12 > buffer.byteLength) break
    const tag = view.getUint16(entryOffset, littleEndian)
    if (tag === 0x0112) { // Orientation
      return view.getUint16(entryOffset + 8, littleEndian)
    }
  }
  return 1
}

/**
 * 处理图片：EXIF 矫正 + 压缩
 * 使用 OffscreenCanvas 或 Canvas 执行变换
 */
export async function processImage(
  file: File,
  options: ProcessOptions,
): Promise<ProcessResult> {
  const { exifCorrect, compress, compressQuality, compressMaxPx } = options

  // 只读前 64KB 获取 EXIF
  const head = await file.slice(0, 65536).arrayBuffer()
  const orientation = exifCorrect ? readExifOrientation(head) : 1

  if (!exifCorrect && !compress) {
    return {
      blob: file,
      originalSize: file.size,
      compressedSize: file.size,
      originalOrientation: orientation,
      compressed: false,
    }
  }

  // 使用 Canvas 处理
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  // 创建 ImageBitmap（性能更好，在 compositor 线程解码）
  const bitmap = await createImageBitmap(file)

  let { width, height } = bitmap

  // 计算目标尺寸（压缩）
  if (compress) {
    const maxDim = Math.max(width, height)
    if (maxDim > compressMaxPx) {
      const scale = compressMaxPx / maxDim
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }
  }

  // EXIF 方向 5-8 需要交换宽高
  const needsSwap = orientation >= 5
  canvas.width = needsSwap ? height : width
  canvas.height = needsSwap ? width : height

  // 应用 EXIF 变换矩阵
  ctx.save()
  applyExifTransform(ctx, orientation, canvas.width, canvas.height, bitmap.width, bitmap.height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  ctx.restore()

  bitmap.close()

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => b ? resolve(b) : reject(new Error('Canvas toBlob failed')),
      'image/jpeg',
      compress ? compressQuality : 1,
    )
  })

  return {
    blob,
    originalSize: file.size,
    compressedSize: blob.size,
    originalOrientation: orientation,
    compressed: blob.size !== file.size,
  }
}

/**
 * EXIF Orientation → Canvas 2D 变换矩阵
 * 对照表：
 *   1: identity
 *   3: 旋转 180°  → translate(W,H) + scale(-1,-1)
 *   6: 顺时针 90° → translate(W,0) + rotate(π/2)  (竖拍)
 *   8: 逆时针 90° → translate(0,H) + rotate(-π/2)
 */
function applyExifTransform(
  ctx: CanvasRenderingContext2D,
  orientation: number,
  canvasW: number,
  canvasH: number,
  _imgW: number,
  _imgH: number,
): void {
  switch (orientation) {
    case 3:
      ctx.translate(canvasW, canvasH)
      ctx.rotate(Math.PI)
      break
    case 6:
      ctx.translate(canvasW, 0)
      ctx.rotate(Math.PI / 2)
      break
    case 8:
      ctx.translate(0, canvasH)
      ctx.rotate(-Math.PI / 2)
      break
    default:
      break
  }
}

export { ORIENTATION_DESC }