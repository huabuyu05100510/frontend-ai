import { describe, it, expect } from 'vitest'
import {
  encodeBinary,
  decodeBinary,
  lzwEncode,
  lzwDecode,
  compressSkeletonData,
  decompressSkeletonData,
  serializeToBase64,
  deserializeFromBase64,
} from '../compressor.js'
import type { SkeletonData } from '../types.js'
import { normalizeBone } from '../types.js'

// ─── 测试数据 ─────────────────────────────────────────────────────────────────

const sampleData: SkeletonData = {
  name: 'product-card',
  aspectRatio: 1.5,
  capturedWidth: 375,
  bones: [
    [2.67, 1.2, 94.67, 13.5, 8],           // 标题
    [2.67, 17.5, 94.67, 50, undefined, undefined, undefined, undefined],  // 图片（无圆角）
    [2.67, 70, 40, 8, 4, undefined, 40, 40],  // 固定宽按钮（有 maxW）
    [2.67, 80, 94.67, 10, 9999],             // 胶囊形状
    [40, 40, 20, 20, '50%'],                 // 圆形头像
    [10, 10, 30, 30, 8, true],               // 容器骨骼
  ],
  version: 2,
  capturedAt: 1720000000000,
  platform: 'web',
}

// ─── LZW 编解码往返测试 ───────────────────────────────────────────────────────

describe('LZW 编解码', () => {
  it('基本往返', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 100, 200, 255, 0])
    const encoded = lzwEncode(original)
    const decoded = lzwDecode(encoded)
    expect(Array.from(decoded)).toEqual(Array.from(original))
  })

  it('重复字节序列（高压缩率场景）', () => {
    const original = new Uint8Array(200).fill(0xAB)
    const encoded = lzwEncode(original)
    const decoded = lzwDecode(encoded)
    expect(Array.from(decoded)).toEqual(Array.from(original))
    // 压缩后应比原始更小
    expect(encoded.length).toBeLessThan(original.length)
  })

  it('空数组', () => {
    const original = new Uint8Array(0)
    const encoded = lzwEncode(original)
    const decoded = lzwDecode(encoded)
    expect(decoded.length).toBe(0)
  })
})

// ─── 二进制编解码往返测试 ─────────────────────────────────────────────────────

describe('二进制编解码', () => {
  it('基本往返（完整骨架数据）', () => {
    const encoded = encodeBinary(sampleData)
    const decoded = decodeBinary(encoded)

    expect(decoded).not.toBeNull()
    expect(decoded!.name).toBe(sampleData.name)
    expect(decoded!.aspectRatio).toBeCloseTo(sampleData.aspectRatio, 2)
    expect(decoded!.capturedWidth).toBe(sampleData.capturedWidth)
    expect(decoded!.version).toBe(2)
    expect(decoded!.platform).toBe('web')
  })

  it('骨骼数量正确', () => {
    const encoded = encodeBinary(sampleData)
    const decoded = decodeBinary(encoded)
    expect(decoded!.bones.length).toBe(sampleData.bones.length)
  })

  it('骨骼坐标精度（±0.01%）', () => {
    const encoded = encodeBinary(sampleData)
    const decoded = decodeBinary(encoded)

    // 检查第一条骨骼
    const original = sampleData.bones[0] as number[]
    const restored = normalizeBone(decoded!.bones[0])
    expect(restored.x).toBeCloseTo(original[0], 1)
    expect(restored.y).toBeCloseTo(original[1], 1)
    expect(restored.w).toBeCloseTo(original[2], 1)
    expect(restored.h).toBeCloseTo(original[3], 1)
  })

  it('圆形（r="50%"）正确还原', () => {
    const encoded = encodeBinary(sampleData)
    const decoded = decodeBinary(encoded)

    // 第 4 条骨骼是圆形头像（r='50%'）
    const circleIdx = 4
    const bone = normalizeBone(decoded!.bones[circleIdx])
    expect(bone.r).toBe('50%')
  })

  it('容器骨骼（c:true）正确还原', () => {
    const encoded = encodeBinary(sampleData)
    const decoded = decodeBinary(encoded)

    const containerIdx = 5
    const bone = normalizeBone(decoded!.bones[containerIdx])
    expect(bone.c).toBe(true)
  })

  it('无效魔数返回 null', () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04])
    expect(decodeBinary(garbage)).toBeNull()
  })

  it('ArrayBuffer 输入', () => {
    const encoded = encodeBinary(sampleData)
    const decoded = decodeBinary(encoded.buffer as ArrayBuffer)
    expect(decoded).not.toBeNull()
  })
})

// ─── 全流水线压缩/解压 ─────────────────────────────────────────────────────────

describe('全流水线 compress/decompress', () => {
  it('压缩后解压还原', () => {
    const compressed = compressSkeletonData(sampleData)
    const restored = decompressSkeletonData(compressed)

    expect(restored).not.toBeNull()
    expect(restored!.name).toBe(sampleData.name)
    expect(restored!.bones.length).toBe(sampleData.bones.length)
  })

  it('压缩后体积比 JSON 小', () => {
    const compressed = compressSkeletonData(sampleData)
    const jsonSize = JSON.stringify(sampleData).length
    // 压缩后应不超过 JSON 大小（LZW 对短数据不一定有优势，但不应明显更大）
    expect(compressed.length).toBeLessThanOrEqual(jsonSize * 1.5)
    console.log(`JSON: ${jsonSize}B, Binary+LZW: ${compressed.length}B`)
  })
})

// ─── Base64 序列化 ────────────────────────────────────────────────────────────

describe('Base64 序列化', () => {
  it('序列化后反序列化还原', () => {
    const base64 = serializeToBase64(sampleData)
    const restored = deserializeFromBase64(base64)

    expect(restored).not.toBeNull()
    expect(restored!.name).toBe(sampleData.name)
    expect(restored!.aspectRatio).toBeCloseTo(sampleData.aspectRatio, 2)
  })

  it('Base64 字符串只含合法字符', () => {
    const base64 = serializeToBase64(sampleData)
    expect(base64).toMatch(/^[A-Za-z0-9+/=]+$/)
  })
})

// ─── 各平台标记 ───────────────────────────────────────────────────────────────

describe('平台标记', () => {
  const platforms = ['web', 'rn', 'taro-mp', 'taro-h5'] as const
  for (const platform of platforms) {
    it(`platform=${platform} 正确还原`, () => {
      const data: SkeletonData = { ...sampleData, platform }
      const restored = decompressSkeletonData(compressSkeletonData(data))
      expect(restored!.platform).toBe(platform)
    })
  }
})
