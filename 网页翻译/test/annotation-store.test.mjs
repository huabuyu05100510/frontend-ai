/**
 * annotation-store —— IndexedDB 存储层单元测试
 *
 * 设计：对标 docs/annotation-feature-tech-plan-V1.md §3 + §4
 *   - DB: xt-annotations (version 1)
 *   - ObjectStore 'annotations', keyPath 'id'
 *   - indexes: by_createdAt / by_synced / by_url / by_kind
 *   - 记录结构: Annotation（顶层 kind/url/langPair + 内嵌 payload）
 *
 * 用 fake-indexeddb 在 Node 环境跑 IDB。
 *
 * 模型：Claude (Sonnet 4.6 / MiniMax-M3 路由)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'

import {
  openDb,
  put,
  get,
  listByCreatedAt,
  listUnsynced,
  markSynced,
  deleteById,
  stats,
  exportJSONL,
  clear,
  _reset,
} from '../lib/annotation-store.mjs'

// ─── helpers ─────────────────────────────────────────────
let _counter = 0
function uid() {
  _counter += 1
  // 满足 validate 的 "id 长度 ≥ 16"
  return '00000000-0000-4000-8000-' + String(_counter).padStart(12, '0')
}

function makeAnno(over = {}) {
  const base = {
    id: uid(),
    kind: 'align_fix',
    schemaVersion: 1,
    url: 'https://example.com/page',
    domPath: '/html/body/p[1]',
    srcSegmentId: 'seg-1',
    langPair: ['zh', 'en'],
    srcText: '我爱你',
    tgtText: 'I love you',
    srcTokens: ['我', '爱', '你'],
    tgtTokens: ['I', 'love', 'you'],
    predicted: [[0, 0], [1, 1], [2, 2]],
    modelVersion: 'nllb-600m-l0h15-v1',
    payload: {
      srcTokenIdx: 1,
      predictedTgtTokenIdx: 1,
      correctedTgtTokenIdx: 1,
      correctionKind: 'change',
    },
    context: { prevSrc: '', nextSrc: '' },
    createdAt: Date.now(),
    appVersion: '1.0.0',
    userAgent: 'Mozilla/5.0 test',
  }
  return { ...base, ...over }
}

// ─── 隔离性：每个 test 前清库 + 清单例 ───────────────────
// fake-indexeddb/auto 默认共用一个 indexedDB global
// 用 store.clear() 不用 raw IDB，避免与单例冲突
test.beforeEach(async () => {
  _reset()
  await clear()
})

// ─── openDb ──────────────────────────────────────────────
test('openDb: 创建成功，DB 名与版本正确', async () => {
  const db = await openDb()
  assert.equal(db.name, 'xt-annotations')
  assert.equal(db.version, 1)
  assert.ok(db.objectStoreNames.contains('annotations'))
  db.close()
})

test('openDb: 4 个 indexes 都建立', async () => {
  const db = await openDb()
  const tx = db.transaction('annotations', 'readonly')
  const store = tx.objectStore('annotations')
  const indexNames = Array.from(store.indexNames).sort()
  assert.deepEqual(indexNames, ['by_createdAt', 'by_kind', 'by_synced', 'by_url'])
  await tx.done
  db.close()
})

// ─── put + get ───────────────────────────────────────────
test('put + get: 写入后能取出，payload 完整保留', async () => {
  const anno = makeAnno()
  anno.id = uid()
  await put(anno)
  const got = await get(anno.id)
  assert.ok(got, 'get 应该返回对象')
  assert.equal(got.id, anno.id)
  assert.equal(got.synced, 0, '新建默认 synced=0')
  assert.equal(got.kind, 'align_fix')
  assert.deepEqual(got.tgtTokens, ['I', 'love', 'you'])
  assert.equal(got.payload.correctionKind, 'change')
})

test('put: 同 id 写入覆盖（upsert）', async () => {
  const id = uid()
  await put(makeAnno({ id, payload: { rating: 3 } }))
  await put(makeAnno({ id, payload: { rating: 5 } }))
  const got = await get(id)
  assert.equal(got.payload.rating, 5, '应被覆盖')
})

test('put: 显式传 synced=1 也保留', async () => {
  const id = uid()
  const anno = makeAnno({ id })
  anno.synced = 1
  await put(anno)
  const got = await get(id)
  assert.equal(got.synced, 1)
})

test('get: 不存在的 id 返回 undefined', async () => {
  const got = await get('does-not-exist-uuid-here')
  assert.equal(got, undefined)
})

// ─── listByCreatedAt ─────────────────────────────────────
test('listByCreatedAt: 默认 asc 顺序', async () => {
  const t0 = Date.now()
  const l1 = uid(), l2 = uid(), l3 = uid()
  await put(makeAnno({ id: l1, createdAt: t0 + 10 }))
  await put(makeAnno({ id: l2, createdAt: t0 + 20 }))
  await put(makeAnno({ id: l3, createdAt: t0 + 30 }))
  const list = await listByCreatedAt({})
  const ids = list.map(x => x.id)
  assert.deepEqual(ids, [l1, l2, l3])
})

test('listByCreatedAt: desc 倒序', async () => {
  const t0 = Date.now()
  const d1 = uid(), d2 = uid(), d3 = uid()
  await put(makeAnno({ id: d1, createdAt: t0 + 10 }))
  await put(makeAnno({ id: d2, createdAt: t0 + 20 }))
  await put(makeAnno({ id: d3, createdAt: t0 + 30 }))
  const list = await listByCreatedAt({ desc: true })
  const ids = list.map(x => x.id)
  assert.deepEqual(ids, [d3, d2, d1])
})

test('listByCreatedAt: limit + offset', async () => {
  const t0 = Date.now()
  const ids = []
  for (let i = 0; i < 5; i++) {
    const id = uid()
    ids.push(id)
    await put(makeAnno({ id, createdAt: t0 + i }))
  }
  const p1 = await listByCreatedAt({ limit: 2, offset: 1 })
  assert.deepEqual(p1.map(x => x.id), [ids[1], ids[2]])
})

// ─── listUnsynced ────────────────────────────────────────
test('listUnsynced: 只返回 synced=0', async () => {
  const u1 = uid(), u2 = uid(), u3 = uid()
  await put(makeAnno({ id: u1, synced: 0 }))
  await put(makeAnno({ id: u2, synced: 1 }))
  await put(makeAnno({ id: u3, synced: 0 }))
  const list = await listUnsynced({})
  const ids = list.map(x => x.id).sort()
  assert.deepEqual(ids, [u1, u3].sort())
})

test('listUnsynced: limit 限制返回数', async () => {
  for (let i = 0; i < 5; i++) {
    await put(makeAnno({ id: uid(), synced: 0 }))
  }
  const list = await listUnsynced({ limit: 2 })
  assert.equal(list.length, 2)
})

// ─── markSynced ──────────────────────────────────────────
test('markSynced: 批量更新 synced 标志', async () => {
  const m1 = uid(), m2 = uid(), m3 = uid()
  await put(makeAnno({ id: m1, synced: 0 }))
  await put(makeAnno({ id: m2, synced: 0 }))
  await put(makeAnno({ id: m3, synced: 0 }))
  await markSynced([m1, m3])
  assert.equal((await get(m1)).synced, 1)
  assert.equal((await get(m2)).synced, 0)
  assert.equal((await get(m3)).synced, 1)
})

test('markSynced: 空数组不报错', async () => {
  const ret = await markSynced([])
  assert.equal(ret, 0)
})

// ─── deleteById ──────────────────────────────────────────
test('deleteById: 真的删了，get 返回 undefined', async () => {
  const id = uid()
  await put(makeAnno({ id }))
  assert.ok(await get(id))
  await deleteById(id)
  assert.equal(await get(id), undefined)
})

test('deleteById: 删不存在的 id 不抛错', async () => {
  await deleteById('nope-no-such-id-here')
  // 不抛即通过
})

// ─── stats ───────────────────────────────────────────────
test('stats: 聚合正确（5 ALIGN_FIX + 3 SEG_RATING）', async () => {
  const t0 = Date.now()
  // 5 align_fix（全部 unsynced，langPair=zh-en）
  for (let i = 0; i < 5; i++) {
    await put(makeAnno({
      id: uid(),
      kind: 'align_fix',
      langPair: ['zh', 'en'],
      createdAt: t0 + i,
    }))
  }
  // 3 seg_rating：1 unsynced, 2 synced；langPair=en-zh
  for (let i = 0; i < 3; i++) {
    await put(makeAnno({
      id: uid(),
      kind: 'seg_rating',
      langPair: ['en', 'zh'],
      createdAt: t0 - 1000 + i, // 旧时间但仍在 24h 内（除非很久以前）
      synced: i === 0 ? 0 : 1,
    }))
  }
  const s = await stats()
  assert.equal(s.total, 8)
  assert.equal(s.byKind.align_fix, 5)
  assert.equal(s.byKind.seg_rating, 3)
  assert.equal(s.byLangPair['zh-en'], 5)
  assert.equal(s.byLangPair['en-zh'], 3)
  // last24h 应包含全部（createdAt 距 now < 24h）
  assert.equal(s.last24h, 8)
  // unsynced = 5 align_fix (synced=0) + 1 seg_rating (synced=0) = 6
  assert.equal(s.unsyncedCount, 6)
})

// ─── exportJSONL ─────────────────────────────────────────
test('exportJSONL: 流式输出，每行 valid JSON + \\n 结尾', async () => {
  const e1 = uid(), e2 = uid()
  await put(makeAnno({ id: e1 }))
  await put(makeAnno({ id: e2 }))
  const lines = []
  for await (const line of exportJSONL()) {
    lines.push(line)
  }
  assert.equal(lines.length, 2)
  for (const line of lines) {
    assert.ok(line.endsWith('\n'), '每行必须 \\n 结尾')
    const parsed = JSON.parse(line.trim())
    assert.ok(parsed.id)
    assert.ok(parsed.payload)
  }
})

test('exportJSONL: 空库 → 0 行（不抛错）', async () => {
  const lines = []
  for await (const line of exportJSONL()) {
    lines.push(line)
  }
  assert.equal(lines.length, 0)
})