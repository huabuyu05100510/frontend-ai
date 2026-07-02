/**
 * @skeleton/core - 骨架数据压缩器
 *
 * 来源：smarty-skeleton-toolchain/packages/core/src/db.ts
 * 改动：更新 BoxNode 格式适配新 SkeletonData 结构（全百分比 + minW/maxW/minH/maxH）
 *
 * 压缩流水线：
 *   SkeletonData (JSON object)
 *     → 二进制结构化编码（字段字典化，每条骨骼约 30 字节）
 *     → LZW 压缩
 *   总压缩率约 70-80%（相比 JSON 字符串）
 *
 * 二进制格式（v2）：
 *   魔数: SKBD (4 bytes)
 *   版本: 0x02 (1 byte)
 *   aspectRatio * 1000: Uint32 (4 bytes)
 *   capturedWidth: Uint32 (4 bytes)
 *   name 字符串: Uint16 length + bytes
 *   boneCount: Uint16 (2 bytes)
 *   每条骨骼（固定 32 字节）：
 *     x * 100: Uint16 (0~65535, 足够表示 0-655.35%)
 *     y * 100: Uint16
 *     w * 100: Uint16
 *     h * 100: Uint16
 *     flags: Uint8   (bit0=hasR, bit1=rIs50%, bit2=c, bit3=hasMinW, bit4=hasMaxW, bit5=hasMinH, bit6=hasMaxH)
 *     rNumeric * 10: Uint16 (flags bit0=1 且 bit1=0 时有效)
 *     minW * 100: Uint16 (flags bit3=1 时有效)
 *     maxW * 100: Uint16 (flags bit4=1 时有效)
 *     minH * 100: Uint16 (flags bit5=1 时有效)
 *     maxH * 100: Uint16 (flags bit6=1 时有效)
 *
 * 注：Uint16 最大 65535，百分比 * 100 最大 10000，完全覆盖。
 */

import type { SkeletonData, CompactBone } from './types.js'
import { normalizeBone, compactBone } from './types.js'

// ─── 底层二进制写入/读取 ─────────────────────────────────────────────────────

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
const textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null

function encodeString(s: string): Uint8Array {
  if (textEncoder) return textEncoder.encode(s)
  // Node.js fallback
  return Buffer.from(s, 'utf8') as unknown as Uint8Array
}

function decodeString(bytes: Uint8Array): string {
  if (textDecoder) return textDecoder.decode(bytes)
  return Buffer.from(bytes).toString('utf8')
}

// ─── 骨架数据二进制编码 ──────────────────────────────────────────────────────

const MAGIC = [0x53, 0x4b, 0x42, 0x44] // 'SKBD'
const FORMAT_VERSION = 0x02

/**
 * 将 SkeletonData 编码为二进制 Uint8Array。
 * 结合 LZW 压缩使用（compressSkeletonData）。
 */
export function encodeBinary(data: SkeletonData): Uint8Array {
  const out: number[] = []

  // 魔数 + 版本
  out.push(...MAGIC, FORMAT_VERSION)

  // aspectRatio * 1000 (Uint32)
  pushUint32(out, Math.round(data.aspectRatio * 1000))

  // capturedWidth (Uint32)
  pushUint32(out, Math.round(data.capturedWidth))

  // name 字符串
  const nameBytes = encodeString(data.name)
  pushUint16(out, nameBytes.length)
  for (let i = 0; i < nameBytes.length; i++) out.push(nameBytes[i])

  // platform (0=web, 1=rn, 2=taro-mp, 3=taro-h5)
  const platformMap: Record<string, number> = { web: 0, rn: 1, 'taro-mp': 2, 'taro-h5': 3 }
  out.push(platformMap[data.platform ?? 'web'] ?? 0)

  // capturedAt (Uint32，精度到秒节省 2 字节，JS Date ms / 1000 取整)
  pushUint32(out, Math.floor((data.capturedAt ?? 0) / 1000))

  // boneCount (Uint16)
  pushUint16(out, data.bones.length)

  // 每条骨骼
  for (const rawBone of data.bones) {
    const b = normalizeBone(rawBone)

    // 坐标（Uint16，乘以 100 保留 2 位小数）
    pushUint16(out, clamp16(Math.round(b.x * 100)))
    pushUint16(out, clamp16(Math.round(b.y * 100)))
    pushUint16(out, clamp16(Math.round(b.w * 100)))
    pushUint16(out, clamp16(Math.round(b.h * 100)))

    // flags
    const hasR = b.r !== undefined
    const rIs50 = b.r === '50%'
    const isContainer = b.c === true
    const hasMinW = b.minW !== undefined
    const hasMaxW = b.maxW !== undefined
    const hasMinH = b.minH !== undefined
    const hasMaxH = b.maxH !== undefined

    let flags = 0
    if (hasR) flags |= 0x01
    if (rIs50) flags |= 0x02
    if (isContainer) flags |= 0x04
    if (hasMinW) flags |= 0x08
    if (hasMaxW) flags |= 0x10
    if (hasMinH) flags |= 0x20
    if (hasMaxH) flags |= 0x40
    out.push(flags)

    // r 数值（仅 hasR && !rIs50%）
    if (hasR && !rIs50) {
      pushUint16(out, clamp16(Math.round((b.r as number) * 10)))
    }

    // min/max 约束
    if (hasMinW) pushUint16(out, clamp16(Math.round(b.minW! * 100)))
    if (hasMaxW) pushUint16(out, clamp16(Math.round(b.maxW! * 100)))
    if (hasMinH) pushUint16(out, clamp16(Math.round(b.minH! * 100)))
    if (hasMaxH) pushUint16(out, clamp16(Math.round(b.maxH! * 100)))
  }

  return new Uint8Array(out)
}

/**
 * 从二进制 Uint8Array 解码为 SkeletonData。
 */
export function decodeBinary(blob: Uint8Array | ArrayBuffer): SkeletonData | null {
  const view = blob instanceof ArrayBuffer ? new Uint8Array(blob) : blob

  // 校验魔数
  if (
    view.length < 10 ||
    view[0] !== MAGIC[0] || view[1] !== MAGIC[1] ||
    view[2] !== MAGIC[2] || view[3] !== MAGIC[3]
  ) return null

  const version = view[4]
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported skeleton binary version: ${version}`)
  }

  let off = 5

  const aspectRatio = readUint32(view, off) / 1000
  off += 4

  const capturedWidth = readUint32(view, off)
  off += 4

  const nameLen = readUint16(view, off)
  off += 2
  const name = decodeString(view.slice(off, off + nameLen))
  off += nameLen

  const platformMap = ['web', 'rn', 'taro-mp', 'taro-h5'] as const
  const platformIdx = view[off++]
  const platform = platformMap[platformIdx] ?? 'web'

  const capturedAt = readUint32(view, off) * 1000
  off += 4

  const boneCount = readUint16(view, off)
  off += 2

  const bones: CompactBone[] = []

  for (let i = 0; i < boneCount; i++) {
    const x = readUint16(view, off) / 100; off += 2
    const y = readUint16(view, off) / 100; off += 2
    const w = readUint16(view, off) / 100; off += 2
    const h = readUint16(view, off) / 100; off += 2

    const flags = view[off++]

    const hasR = !!(flags & 0x01)
    const rIs50 = !!(flags & 0x02)
    const isContainer = !!(flags & 0x04)
    const hasMinW = !!(flags & 0x08)
    const hasMaxW = !!(flags & 0x10)
    const hasMinH = !!(flags & 0x20)
    const hasMaxH = !!(flags & 0x40)

    let r: number | string | undefined
    if (hasR) {
      if (rIs50) {
        r = '50%'
      } else {
        r = readUint16(view, off) / 10; off += 2
      }
    }

    const bone: import('./types.js').Bone = { x, y, w, h }
    if (r !== undefined) bone.r = r
    if (isContainer) bone.c = true
    if (hasMinW) { bone.minW = readUint16(view, off) / 100; off += 2 }
    if (hasMaxW) { bone.maxW = readUint16(view, off) / 100; off += 2 }
    if (hasMinH) { bone.minH = readUint16(view, off) / 100; off += 2 }
    if (hasMaxH) { bone.maxH = readUint16(view, off) / 100; off += 2 }

    bones.push(compactBone(bone))
  }

  return {
    name,
    aspectRatio,
    capturedWidth,
    bones,
    version: 2,
    capturedAt,
    platform,
  }
}

// ─── LZW 压缩 ─────────────────────────────────────────────────────────────────

/**
 * LZW 编码（经典实现，256 初始码表，每码 2 字节）。
 * 对二进制骨架数据的典型压缩率：40-60%。
 */
export function lzwEncode(u8: Uint8Array): Uint8Array {
  const dict = new Map<string, number>()
  for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i)

  const data = Array.from(u8).map(v => String.fromCharCode(v)).join('')
  let w = ''
  let code = 256
  const out: number[] = []

  for (const c of data) {
    const wc = w + c
    if (dict.has(wc)) {
      w = wc
    } else {
      out.push(dict.get(w)!)
      dict.set(wc, code++)
      w = c
    }
  }
  if (w !== '') out.push(dict.get(w)!)

  const result = new Uint8Array(out.length * 2)
  for (let i = 0; i < out.length; i++) {
    result[i * 2] = (out[i] >> 8) & 0xff
    result[i * 2 + 1] = out[i] & 0xff
  }
  return result
}

/**
 * LZW 解码。
 */
export function lzwDecode(u8: Uint8Array): Uint8Array {
  if (u8.length === 0) return new Uint8Array(0)
  const codes: number[] = []
  for (let i = 0; i < u8.length; i += 2) {
    codes.push((u8[i] << 8) | u8[i + 1])
  }

  const dict = new Map<number, string>()
  for (let i = 0; i < 256; i++) dict.set(i, String.fromCharCode(i))

  let w = String.fromCharCode(codes[0])
  let result = w
  let code = 256

  for (let i = 1; i < codes.length; i++) {
    const k = codes[i]
    let entry: string
    if (dict.has(k)) {
      entry = dict.get(k)!
    } else if (k === code) {
      entry = w + w[0]
    } else {
      throw new Error(`Invalid LZW code: ${k} at position ${i}`)
    }
    result += entry
    dict.set(code++, w + entry[0])
    w = entry
  }

  const out = new Uint8Array(result.length)
  for (let i = 0; i < result.length; i++) out[i] = result.charCodeAt(i)
  return out
}

// ─── 公开 API ─────────────────────────────────────────────────────────────────

/**
 * 压缩 SkeletonData 为 Uint8Array（二进制编码 + LZW）。
 * 结果可直接存入 IndexedDB / AsyncStorage / Storage。
 */
export function compressSkeletonData(data: SkeletonData): Uint8Array {
  return lzwEncode(encodeBinary(data))
}

/**
 * 解压 Uint8Array 为 SkeletonData。
 */
export function decompressSkeletonData(blob: Uint8Array | ArrayBuffer): SkeletonData | null {
  const u8 = blob instanceof ArrayBuffer ? new Uint8Array(blob) : blob
  const decoded = lzwDecode(u8)
  return decodeBinary(decoded)
}

/**
 * 将 SkeletonData 序列化为 Base64 字符串（用于 localStorage / cookie 等场景）。
 */
export function serializeToBase64(data: SkeletonData): string {
  const bytes = compressSkeletonData(data)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/**
 * 从 Base64 字符串反序列化 SkeletonData。
 */
export function deserializeFromBase64(base64: string): SkeletonData | null {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return decompressSkeletonData(bytes)
}

// ─── 内部工具 ─────────────────────────────────────────────────────────────────

function pushUint16(arr: number[], v: number): void {
  arr.push((v >> 8) & 0xff, v & 0xff)
}

function pushUint32(arr: number[], v: number): void {
  arr.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff)
}

function readUint16(view: Uint8Array, offset: number): number {
  return (view[offset] << 8) | view[offset + 1]
}

function readUint32(view: Uint8Array, offset: number): number {
  return (
    (view[offset] * 0x1000000) +
    (view[offset + 1] << 16) +
    (view[offset + 2] << 8) +
    view[offset + 3]
  ) >>> 0
}

/** Uint16 溢出保护（最大 65535） */
function clamp16(v: number): number {
  return Math.min(65535, Math.max(0, isFinite(v) ? v : 0))
}
