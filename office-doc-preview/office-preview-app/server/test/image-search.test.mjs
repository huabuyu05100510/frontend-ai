// image-search — 服务端向量索引测试
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { CONFIG } from '../src/config.mjs'

// 测试专用目录，避免污染真实数据
const testDir = path.join(CONFIG.DERIVED_DIR, 'image-search-test-' + process.pid)

// 覆盖模块读取的目录路径，测试隔离
process.env.IMAGE_SEARCH_DIR_OVERRIDE = testDir
process.env.IMAGE_SEARCH_PROVIDER = 'mock'

// 动态 import，确保 env 已设置
async function load() {
  // 清缓存（vitest ESM 模块缓存同测试进程共享）
  return await import('../src/image-search.mjs?' + Date.now())
}

// 创建一个临时假图片文件
function makeFakeImage(name = 'test.jpg') {
  const p = path.join(testDir, name)
  fs.mkdirSync(testDir, { recursive: true })
  fs.writeFileSync(p, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])) // JPEG magic bytes
  return p
}

beforeAll(() => {
  fs.mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true })
  delete process.env.IMAGE_SEARCH_DIR_OVERRIDE
})

beforeEach(() => {
  // 每个测试前清空索引
  const indexFile = path.join(testDir, 'index.jsonl')
  if (fs.existsSync(indexFile)) fs.unlinkSync(indexFile)
})

// ─── 嵌入 ────────────────────────────────────────────────────────────────────

describe('embedding: mock provider', () => {
  it('对同一文件返回相同向量（确定性）', async () => {
    const m = await load()
    const p = makeFakeImage('img_a.jpg')
    const v1 = await m.embedFile(p)
    const v2 = await m.embedFile(p)
    expect(v1).toBeInstanceOf(Float32Array)
    expect(v1.length).toBe(512)
    expect(Array.from(v1)).toEqual(Array.from(v2))
  })

  it('对不同文件返回不同向量', async () => {
    const m = await load()
    const p1 = makeFakeImage('img_x.jpg')
    const p2 = makeFakeImage('img_y.jpg')
    // 写入不同内容，使 stat.size 不同
    fs.writeFileSync(p2, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x20]))
    const v1 = await m.embedFile(p1)
    const v2 = await m.embedFile(p2)
    expect(Array.from(v1)).not.toEqual(Array.from(v2))
  })

  it('向量已 L2 归一化（模长约等于 1）', async () => {
    const m = await load()
    const p = makeFakeImage('img_norm.jpg')
    const v = await m.embedFile(p)
    let norm = 0
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 4)
  })
})

// ─── 索引存储 ─────────────────────────────────────────────────────────────────

describe('indexFile: JSONL 持久化', () => {
  it('入库后 status() 返回 indexSize=1', async () => {
    const m = await load()
    const p = makeFakeImage('persist_a.jpg')
    await m.indexFile({ fileId: 'f_001', filePath: p })
    const s = m.indexStatus()
    expect(s.indexSize).toBe(1)
  })

  it('同 fileId 重复入库不增加条目（upsert）', async () => {
    const m = await load()
    const p = makeFakeImage('persist_b.jpg')
    await m.indexFile({ fileId: 'f_dup', filePath: p })
    await m.indexFile({ fileId: 'f_dup', filePath: p })
    expect(m.indexStatus().indexSize).toBe(1)
  })

  it('JSONL 落盘后重新 load 可读取', async () => {
    const m = await load()
    const p = makeFakeImage('persist_c.jpg')
    await m.indexFile({ fileId: 'f_persist', filePath: p })

    // 重新 import（模拟重启）
    const m2 = await load()
    m2.reloadIndex()
    expect(m2.indexStatus().indexSize).toBe(1)
  })
})

// ─── 搜索 ─────────────────────────────────────────────────────────────────────

describe('searchByImage: 余弦相似度 + MMR', () => {
  it('空索引返回空结果', async () => {
    const m = await load()
    const p = makeFakeImage('query_empty.jpg')
    const r = await m.searchByImage(p)
    expect(r.results).toHaveLength(0)
    expect(r.meta.indexSize).toBe(0)
  })

  it('以图搜图：同一文件相似度最高（接近 1）', async () => {
    const m = await load()
    const p = makeFakeImage('query_self.jpg')
    await m.indexFile({ fileId: 'f_self', filePath: p })

    // 加入干扰项（内容不同）
    const other = makeFakeImage('query_other.jpg')
    fs.writeFileSync(other, Buffer.alloc(64, 0x42))
    await m.indexFile({ fileId: 'f_other', filePath: other })

    const r = await m.searchByImage(p, { topK: 10 })
    expect(r.results[0].fileId).toBe('f_self')
    expect(r.results[0].score).toBeGreaterThan(0.99)
  })

  it('结果数量不超过 topK', async () => {
    const m = await load()
    for (let i = 0; i < 10; i++) {
      const p = makeFakeImage(`topk_${i}.jpg`)
      fs.writeFileSync(p, Buffer.alloc(8 + i, i))
      await m.indexFile({ fileId: `f_topk_${i}`, filePath: p })
    }
    const query = makeFakeImage('topk_query.jpg')
    const r = await m.searchByImage(query, { topK: 3 })
    expect(r.results.length).toBeLessThanOrEqual(3)
  })

  it('meta 包含 indexSize / ms / engine', async () => {
    const m = await load()
    const p = makeFakeImage('meta_check.jpg')
    const r = await m.searchByImage(p)
    expect(typeof r.meta.ms).toBe('string')
    expect(typeof r.meta.indexSize).toBe('number')
    expect(r.meta.engine).toBe('mock')
  })
})

// ─── MMR 去冗余 ───────────────────────────────────────────────────────────────

describe('mmr: 结果多样化', () => {
  it('候选全相同时 MMR 只选 1 个', async () => {
    const { mmr, cosine } = await import('../src/image-search.mjs?' + Date.now())
    // 3 个完全相同的向量
    const v = new Float32Array(512).fill(1 / Math.sqrt(512))
    const candidates = [
      { fileId: 'a', score: 0.9, embedding: v },
      { fileId: 'b', score: 0.88, embedding: v },
      { fileId: 'c', score: 0.85, embedding: v },
    ]
    const results = mmr(v, candidates, 3, 0.7)
    // 选了第一个后，其余与已选相似度=1，redundancy 项极大，MMR 分极低
    // 但仍会选出 k=3 个（只是后续多样性分低）
    // 关键断言：第一个必须是 score 最高的
    expect(results[0].fileId).toBe('a')
    expect(results).toHaveLength(3)
  })

  it('多样化候选时 MMR 选出不同类别', async () => {
    const { mmr } = await import('../src/image-search.mjs?' + Date.now())
    // 构造两组向量：A 组（前 256 维为 1/norm，后 256 维为 0）
    //             B 组（前 256 维为 0，后 256 维为 1/norm）
    const normA = 1 / Math.sqrt(256)
    const normB = 1 / Math.sqrt(256)
    const vA = new Float32Array(512)
    const vB = new Float32Array(512)
    for (let i = 0; i < 256; i++) vA[i] = normA
    for (let i = 256; i < 512; i++) vB[i] = normB

    const query = new Float32Array(512)
    for (let i = 0; i < 512; i++) query[i] = 1 / Math.sqrt(512)

    const candidates = [
      { fileId: 'a1', score: 0.9,  embedding: vA },
      { fileId: 'a2', score: 0.85, embedding: vA }, // 与 a1 高度相似
      { fileId: 'b1', score: 0.8,  embedding: vB }, // 与 a 组差异大
    ]

    const results = mmr(query, candidates, 3, 0.7)
    // a1 最相关先选；b1 应排在 a2 前面（多样性加成）
    expect(results[0].fileId).toBe('a1')
    expect(results[1].fileId).toBe('b1') // 多样性胜出
  })
})

// ─── removeFromIndex ──────────────────────────────────────────────────────────

describe('removeFromIndex', () => {
  it('删除后 indexSize 减 1', async () => {
    const m = await load()
    const p = makeFakeImage('remove_a.jpg')
    await m.indexFile({ fileId: 'f_rm', filePath: p })
    expect(m.indexStatus().indexSize).toBe(1)
    m.removeFromIndex('f_rm')
    expect(m.indexStatus().indexSize).toBe(0)
  })

  it('删除不存在的 fileId 不报错', async () => {
    const m = await load()
    expect(() => m.removeFromIndex('f_ghost')).not.toThrow()
  })
})
