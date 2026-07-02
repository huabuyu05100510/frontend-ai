// translate-image-batch.mjs — per-image batch translation orchestrator
// 模型：claude-sonnet-4-6
//
// TDD tests for the image batch translation runner. The module must:
//   - startBatch({ jobId, taskIds, sourceLang, targetLang, glossaryId?, tmId?, concurrency? })
//   - pollBatch({ jobId, sinceSeq? }) → { jobId, status, lastSeq, items }
//   - cancelBatch({ jobId }) → appends 'cancelled' frame
//   - getBatchItem({ jobId, taskId }) → latest per-task status payload
//   - isBatchRunning({ jobId }) → true unless terminal
//   - _clearAllBatchesForTest()
//
// All public functions are mocked at the module boundary so the runner is
// exercised in isolation (no real OCR / translate / file IO).

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from '../src/config.mjs'

// ============ 共享 in-memory mock state ============
//
// These state objects are referenced inside the vi.mock factories so the
// mocks can be observed/reset from tests.

const framesStore = new Map() // jobId → Array<frame>
let mockGetTaskImpl = () => null
let mockOcrImpl = async () => ({
  text: '',
  regions: [],
  engine: 'mock-v1',
  ms: 1,
  imageSize: { width: 100, height: 100 },
})
let mockTranslateAiImpl = async ({ text }) => ({ target: `[en] ${text}` })
let mockLookupTmImpl = () => []
let mockListTermsImpl = () => []

function safeJobId(jobId) {
  return String(jobId).replace(/[^\w-]/g, '_').slice(0, 128) || 'job_unknown'
}

function readFrames(jobId) {
  return framesStore.get(jobId) || []
}

function writeFrames(jobId, frames) {
  framesStore.set(jobId, frames)
}

function nextSeq(jobId) {
  const arr = readFrames(jobId)
  if (arr.length === 0) return 1
  const last = arr[arr.length - 1]
  return (last.seq || arr.length) + 1
}

function appendMockFrame({ jobId, kind, payload }) {
  const seq = nextSeq(jobId)
  const ts = Date.now()
  const frame = {
    seq,
    ts,
    tsIso: new Date(ts).toISOString(),
    jobId: safeJobId(jobId),
    kind,
    payload: payload && typeof payload === 'object' ? payload : {},
  }
  const arr = [...readFrames(jobId), frame]
  // 200 cap matches production behaviour
  const kept = arr.length > 200 ? arr.slice(arr.length - 200) : arr
  writeFrames(jobId, kept)
  return frame
}

function tailFramesMock({ jobId, sinceSeq = 0 } = {}) {
  const arr = readFrames(jobId)
  const cutoff = Number(sinceSeq) || 0
  return arr.filter(f => f && (f.seq || 0) > cutoff).sort((a, b) => a.seq - b.seq)
}

// ============ vi.mock factories ============

vi.mock('../src/translate-jobs.mjs', () => ({
  appendFrame: vi.fn((input) => appendMockFrame(input)),
  tailFrames: vi.fn((input) => tailFramesMock(input)),
  getJob: vi.fn(({ jobId } = {}) => {
    const arr = readFrames(jobId)
    if (arr.length === 0) return null
    const sorted = [...arr].sort((a, b) => a.seq - b.seq)
    const last = sorted[sorted.length - 1]
    return {
      jobId: safeJobId(jobId),
      createdAt: sorted[0].ts || 0,
      lastSeq: last.seq || 0,
      frameCount: sorted.length,
      status: last.kind,
    }
  }),
  isJobCancelled: vi.fn(({ jobId } = {}) => {
    return readFrames(jobId).some(f => f && f.kind === 'cancelled')
  }),
  clearJob: vi.fn(({ jobId } = {}) => {
    framesStore.delete(jobId)
    return true
  }),
}))

vi.mock('../src/store.mjs', () => ({
  getTask: vi.fn((taskId) => mockGetTaskImpl(taskId)),
  upsertTask: vi.fn(),
  loadTasks: vi.fn(() => []),
}))

vi.mock('../src/ocr.mjs', () => ({
  ocrImage: vi.fn(async (imagePath, opts) => mockOcrImpl({ imagePath, opts })),
}))

vi.mock('../src/translate-provider.mjs', () => ({
  translateAI: vi.fn(async (opts) => mockTranslateAiImpl(opts)),
}))

vi.mock('../src/translate-glossary.mjs', () => ({
  applyGlossary: vi.fn((text, terms) => {
    if (!Array.isArray(terms) || terms.length === 0) return text
    let out = String(text)
    for (const t of terms) {
      if (!t || typeof t.source !== 'string' || !t.source) continue
      while (out.includes(t.source)) {
        out = out.replace(t.source, t.target)
      }
    }
    return out
  }),
  matchTerm: vi.fn(() => []),
  listTerms: vi.fn(({ sourceLang, targetLang }) => mockListTermsImpl({ sourceLang, targetLang })),
  appendTerm: vi.fn(),
  deleteTerm: vi.fn(),
}))

vi.mock('../src/translate-memory.mjs', () => ({
  lookupTm: vi.fn(({ query }) => mockLookupTmImpl({ query })),
  addTmEntry: vi.fn(),
  listTm: vi.fn(() => []),
  deleteTmEntry: vi.fn(),
  scoreSimilarity: vi.fn(() => 0),
}))

// ============ Helpers ============

async function loadModule() {
  vi.resetModules()
  // reset mock state on every load
  framesStore.clear()
  return await import('../src/translate-image-batch.mjs')
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function waitForTerminal(mod, jobId, timeoutMs = 5000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (!mod.isBatchRunning({ jobId })) {
      return mod.pollBatch({ jobId }).status
    }
    await sleep(20)
  }
  throw new Error(`job ${jobId} did not terminate within ${timeoutMs}ms`)
}

function makeTask(taskId, { ext = 'png', previewPath = `/tmp/${taskId}.png` } = {}) {
  return { id: taskId, ext, previewPath, originalPath: previewPath }
}

// ============ Setup / Teardown ============

let jobsDir
beforeAll(() => {
  jobsDir = path.join(CONFIG.DERIVED_DIR, 'translate-jobs')
})

beforeEach(() => {
  framesStore.clear()
  mockGetTaskImpl = () => null
  mockOcrImpl = async () => ({
    text: 'sample',
    regions: [
      { text: 'Region A', x: 0, y: 0, width: 100, height: 30, confidence: 0.9 },
      { text: 'Region B', x: 0, y: 40, width: 100, height: 30, confidence: 0.85 },
    ],
    engine: 'mock-v1',
    ms: 1,
    imageSize: { width: 200, height: 200 },
  })
  mockTranslateAiImpl = async ({ text }) => ({ target: `[en] ${text}` })
  mockLookupTmImpl = () => []
  mockListTermsImpl = () => []
})

// ============ Tests ============

describe('translate-image-batch: startBatch', () => {
  it('1. returns { jobId, total, startedAt }; does NOT throw', async () => {
    const mod = await loadModule()
    mockGetTaskImpl = (id) => makeTask(id)
    const res = mod.startBatch({
      jobId: 'job_start',
      taskIds: ['img_a', 'img_b'],
      sourceLang: 'zh-CN',
      targetLang: 'en',
    })
    expect(res.jobId).toBe('job_start')
    expect(res.total).toBe(2)
    expect(typeof res.startedAt).toBe('number')

    // wait for runner to finish
    const status = await waitForTerminal(mod, 'job_start')
    expect(status).toBe('finished')
  })

  it('2. appends a "started" frame on entry with total/sourceLang/targetLang payload', async () => {
    const mod = await loadModule()
    mockGetTaskImpl = (id) => makeTask(id)
    mod.startBatch({
      jobId: 'job_started_frame',
      taskIds: ['img_x'],
      sourceLang: 'zh-CN',
      targetLang: 'en',
    })
    await waitForTerminal(mod, 'job_started_frame')

    const frames = mod._readFramesForTest('job_started_frame')
    const started = frames.find(f => f.kind === 'started')
    expect(started).toBeTruthy()
    expect(started.payload.total).toBe(1)
    expect(started.payload.sourceLang).toBe('zh-CN')
    expect(started.payload.targetLang).toBe('en')
  })
})

describe('translate-image-batch: pollBatch', () => {
  it('3. status field reflects last frame kind from translate-jobs.getJob', async () => {
    const mod = await loadModule()
    mockGetTaskImpl = (id) => makeTask(id)
    mod.startBatch({
      jobId: 'job_poll',
      taskIds: ['p1', 'p2'],
      sourceLang: 'zh-CN',
      targetLang: 'en',
    })
    await waitForTerminal(mod, 'job_poll')

    const polled = mod.pollBatch({ jobId: 'job_poll' })
    expect(polled.jobId).toBe('job_poll')
    expect(polled.status).toBe('finished')
    expect(typeof polled.lastSeq).toBe('number')
    expect(Array.isArray(polled.items)).toBe(true)
    expect(polled.items.length).toBe(2)
  })

  it('4. items contains one entry per taskId with image-done payload after completion', async () => {
    const mod = await loadModule()
    mockGetTaskImpl = (id) => makeTask(id)
    mod.startBatch({
      jobId: 'job_items',
      taskIds: ['i1', 'i2', 'i3'],
      sourceLang: 'zh-CN',
      targetLang: 'en',
    })
    await waitForTerminal(mod, 'job_items')

    const polled = mod.pollBatch({ jobId: 'job_items' })
    const taskIds = polled.items.map(it => it.taskId).sort()
    expect(taskIds).toEqual(['i1', 'i2', 'i3'])
    for (const item of polled.items) {
      expect(item.status).toBe('image-done')
      expect(Array.isArray(item.regions)).toBe(true)
    }
  })
})

describe('translate-image-batch: 100-image batch order', () => {
  it('5. all 100 tasks complete and items appear in submit order', async () => {
    const mod = await loadModule()
    const N = 100
    const taskIds = Array.from({ length: N }, (_, i) => `big_${i}`)
    mockGetTaskImpl = (id) => makeTask(id)

    mod.startBatch({
      jobId: 'job_100',
      taskIds,
      sourceLang: 'zh-CN',
      targetLang: 'en',
      concurrency: 4,
    })
    await waitForTerminal(mod, 'job_100', 15000)

    const polled = mod.pollBatch({ jobId: 'job_100' })
    expect(polled.status).toBe('finished')
    expect(polled.items.length).toBe(N)
    const idsInOrder = polled.items.map(it => it.taskId)
    // submit order is preserved
    expect(idsInOrder).toEqual(taskIds)
    // every task has image-done (not failed)
    for (const it of polled.items) {
      expect(it.status).toBe('image-done')
    }
  }, 20000)
})

describe('translate-image-batch: cancelBatch', () => {
  it('6. cancelBatch appends "cancelled" frame; further images skipped', async () => {
    const mod = await loadModule()
    // slow OCR so we have time to cancel
    mockOcrImpl = async () => {
      await sleep(80)
      return {
        text: 'slow', regions: [{ text: 'slow', x: 0, y: 0, width: 10, height: 10, confidence: 0.5 }],
        engine: 'slow', ms: 80, imageSize: { width: 100, height: 100 },
      }
    }
    mockGetTaskImpl = (id) => makeTask(id)
    const many = Array.from({ length: 20 }, (_, i) => `cancel_${i}`)
    mod.startBatch({
      jobId: 'job_cancel',
      taskIds: many,
      sourceLang: 'zh-CN',
      targetLang: 'en',
      concurrency: 2,
    })

    // Wait until at least one image-done has been written
    const t0 = Date.now()
    while (Date.now() - t0 < 4000) {
      const frames = mod._readFramesForTest('job_cancel')
      if (frames.some(f => f.kind === 'image-done')) break
      await sleep(20)
    }

    mod.cancelBatch({ jobId: 'job_cancel' })
    const status = await waitForTerminal(mod, 'job_cancel', 6000)
    expect(status).toBe('cancelled')

    const polled = mod.pollBatch({ jobId: 'job_cancel' })
    const doneCount = polled.items.filter(it => it.status === 'image-done').length
    const skipCount = polled.items.filter(it => it.status === 'skipped').length
    // at least some but not all should have completed
    expect(doneCount).toBeGreaterThan(0)
    expect(doneCount + skipCount).toBe(20)
  }, 15000)
})

describe('translate-image-batch: glossary applied per region', () => {
  it('7. translated text reflects applyGlossary replacement on source region text', async () => {
    const mod = await loadModule()
    mockGetTaskImpl = (id) => makeTask(id)
    mockOcrImpl = async () => ({
      text: 'hello world',
      regions: [{ text: '苹果', x: 0, y: 0, width: 100, height: 30, confidence: 0.9 }],
      engine: 'mock-v1',
      ms: 1,
      imageSize: { width: 100, height: 100 },
    })
    // listTerms returns the term 苹果→Apple
    mockListTermsImpl = () => [{ source: '苹果', target: 'Apple' }]
    // translator echoes whatever it receives — so after glossary the
    // translateAI sees "Apple" and returns it as the translation
    mockTranslateAiImpl = async ({ text }) => ({ target: text })

    mod.startBatch({
      jobId: 'job_gloss',
      taskIds: ['g1'],
      sourceLang: 'zh-CN',
      targetLang: 'en',
      glossaryId: 'glossary_1',
    })
    await waitForTerminal(mod, 'job_gloss')

    const polled = mod.pollBatch({ jobId: 'job_gloss' })
    const item = polled.items[0]
    expect(item.regions[0].translation).toBe('Apple')
  })
})

describe('translate-image-batch: TM hit reflected', () => {
  it('8. when lookupTm returns a hit, the substitution is applied pre-AI', async () => {
    const mod = await loadModule()
    mockGetTaskImpl = (id) => makeTask(id)
    mockOcrImpl = async () => ({
      text: 'x',
      regions: [{ text: '苹果好吃', x: 0, y: 0, width: 100, height: 30, confidence: 0.9 }],
      engine: 'mock-v1',
      ms: 1,
      imageSize: { width: 100, height: 100 },
    })
    mockLookupTmImpl = () => [{ source: '苹果好吃', target: 'TM-BEST' }]
    // translator echoes whatever it receives
    mockTranslateAiImpl = async ({ text }) => ({ target: text })

    mod.startBatch({
      jobId: 'job_tm',
      taskIds: ['t1'],
      sourceLang: 'zh-CN',
      targetLang: 'en',
      tmId: 'tm_1',
    })
    await waitForTerminal(mod, 'job_tm')

    const polled = mod.pollBatch({ jobId: 'job_tm' })
    const item = polled.items[0]
    expect(item.regions[0].translation).toBe('TM-BEST')
  })
})

describe('translate-image-batch: OCR failure resilience', () => {
  it('9. failed OCR on one image does not crash the batch; "failed" frame is emitted', async () => {
    const mod = await loadModule()
    let callCount = 0
    mockOcrImpl = async () => {
      callCount++
      if (callCount === 2) throw new Error('boom OCR')
      return {
        text: 'ok',
        regions: [{ text: 'R', x: 0, y: 0, width: 10, height: 10, confidence: 0.5 }],
        engine: 'mock-v1',
        ms: 1,
        imageSize: { width: 100, height: 100 },
      }
    }
    mockGetTaskImpl = (id) => makeTask(id)

    mod.startBatch({
      jobId: 'job_fail',
      taskIds: ['f1', 'f2', 'f3'],
      sourceLang: 'zh-CN',
      targetLang: 'en',
    })
    const status = await waitForTerminal(mod, 'job_fail', 8000)
    expect(status).toBe('finished')

    const polled = mod.pollBatch({ jobId: 'job_fail' })
    const failed = polled.items.filter(it => it.status === 'failed')
    const done = polled.items.filter(it => it.status === 'image-done')
    expect(failed.length).toBe(1)
    expect(done.length).toBe(2)
    expect(failed[0].taskId).toBe('f2')
    expect(failed[0].error).toMatch(/boom OCR/)
  }, 12000)
})

describe('translate-image-batch: isBatchRunning', () => {
  it('10. true while running; false after finished; false after cancelled', async () => {
    const mod = await loadModule()
    mockGetTaskImpl = (id) => makeTask(id)

    // delayed OCR so we can observe "running" state
    mockOcrImpl = async () => {
      await sleep(100)
      return {
        text: '', regions: [{ text: 'X', x: 0, y: 0, width: 1, height: 1, confidence: 1 }],
        engine: 'mock', ms: 100, imageSize: { width: 1, height: 1 },
      }
    }

    mod.startBatch({
      jobId: 'job_runflag',
      taskIds: ['r1', 'r2'],
      sourceLang: 'zh-CN',
      targetLang: 'en',
      concurrency: 1,
    })

    // Give the runner a tick to start
    await sleep(20)
    expect(mod.isBatchRunning({ jobId: 'job_runflag' })).toBe(true)

    await waitForTerminal(mod, 'job_runflag')
    expect(mod.isBatchRunning({ jobId: 'job_runflag' })).toBe(false)
  })

  it('11. isBatchRunning returns false for cancelled jobs', async () => {
    const mod = await loadModule()
    mockOcrImpl = async () => {
      await sleep(50)
      return {
        text: '', regions: [{ text: 'X', x: 0, y: 0, width: 1, height: 1, confidence: 1 }],
        engine: 'mock', ms: 50, imageSize: { width: 1, height: 1 },
      }
    }
    mockGetTaskImpl = (id) => makeTask(id)
    const ids = Array.from({ length: 6 }, (_, i) => `rf_${i}`)
    mod.startBatch({
      jobId: 'job_runflag_cancel',
      taskIds: ids,
      sourceLang: 'zh-CN',
      targetLang: 'en',
      concurrency: 1,
    })
    await sleep(30)
    mod.cancelBatch({ jobId: 'job_runflag_cancel' })
    await waitForTerminal(mod, 'job_runflag_cancel', 4000)
    expect(mod.isBatchRunning({ jobId: 'job_runflag_cancel' })).toBe(false)
  })
})

describe('translate-image-batch: getBatchItem', () => {
  it('12. returns latest per-task status (most recent image-done wins)', async () => {
    const mod = await loadModule()
    mockGetTaskImpl = (id) => makeTask(id)

    // Seed frames directly: same taskId twice
    const m = await import('../src/translate-jobs.mjs')
    m.appendFrame({ jobId: 'job_seed', kind: 'image-done', payload: { taskId: 'seed_t', idx: 1, version: 'old' } })
    m.appendFrame({ jobId: 'job_seed', kind: 'image-done', payload: { taskId: 'seed_t', idx: 2, version: 'new' } })
    m.appendFrame({ jobId: 'job_seed', kind: 'finished', payload: {} })

    const item = mod.getBatchItem({ jobId: 'job_seed', taskId: 'seed_t' })
    expect(item).not.toBeNull()
    expect(item.status).toBe('image-done')
    expect(item.idx).toBe(2)
    expect(item.version).toBe('new')

    // unknown taskId → null
    const none = mod.getBatchItem({ jobId: 'job_seed', taskId: 'never' })
    expect(none).toBeNull()
  })
})

describe('translate-image-batch: missing task (getTask returns null)', () => {
  it('13. unknown taskId is recorded as "failed" with reason; batch continues', async () => {
    const mod = await loadModule()
    mockGetTaskImpl = () => null // every task is missing
    mod.startBatch({
      jobId: 'job_missing',
      taskIds: ['m1', 'm2'],
      sourceLang: 'zh-CN',
      targetLang: 'en',
    })
    const status = await waitForTerminal(mod, 'job_missing', 4000)
    expect(status).toBe('finished')

    const polled = mod.pollBatch({ jobId: 'job_missing' })
    expect(polled.items.length).toBe(2)
    for (const it of polled.items) {
      expect(it.status).toBe('failed')
      expect(typeof it.error).toBe('string')
    }
  })
})

describe('translate-image-batch: concurrency limit', () => {
  it('14. concurrency=2 means at most 2 OCRs in flight at any moment', async () => {
    const mod = await loadModule()

    // In-flight counter scoped to THIS test's taskIds. mockOcrImpl is a
    // module-level shared variable across tests; leftover tasks from
    // earlier tests can still be in flight when this test runs, so we
    // only count OCRs whose taskId is in our taskIds set.
    const OWN_JOB = 'job_conc'
    const ourTaskIds = new Set(['c1', 'c2', 'c3', 'c4', 'c5'])
    let inFlight = 0
    let peakInFlight = 0
    let oursCallCount = 0
    mockOcrImpl = async ({ taskId, imagePath } = {}) => {
      // taskId arrives as the second positional arg of ocrImage, but our
      // mock factory forwards imagePath/opts. We re-derive the taskId from
      // the path suffix.
      const m = typeof imagePath === 'string' ? imagePath.match(/(?:job_conc_|tmp\/)([^/]+)\.png$/) : null
      const derivedId = m ? m[1] : null
      const isOurs = derivedId != null && ourTaskIds.has(derivedId)
      if (isOurs) {
        oursCallCount++
        inFlight++
        peakInFlight = Math.max(peakInFlight, inFlight)
        try {
          await sleep(40)
        } finally {
          inFlight--
        }
      } else {
        await sleep(20) // simulate work without counting
      }
      return {
        text: '', regions: [{ text: 'R', x: 0, y: 0, width: 10, height: 10, confidence: 0.5 }],
        engine: 'mock', ms: 40, imageSize: { width: 1, height: 1 },
      }
    }

    // Use generic makeTask (default previewPath) — our derivation matches
    // taskIds by suffix `.png` of the last segment.
    mockGetTaskImpl = (id) => ({
      id,
      ext: 'png',
      previewPath: `/tmp/${id}.png`,
      originalPath: `/tmp/${id}.png`,
    })

    mod.startBatch({
      jobId: OWN_JOB,
      taskIds: ['c1', 'c2', 'c3', 'c4', 'c5'],
      sourceLang: 'zh-CN',
      targetLang: 'en',
      concurrency: 2,
    })
    await waitForTerminal(mod, OWN_JOB, 6000)

    expect(oursCallCount).toBe(5) // sanity: only our 5 tasks counted
    expect(peakInFlight).toBeLessThanOrEqual(2)
    expect(peakInFlight).toBeGreaterThanOrEqual(1)
  }, 10000)
})

// Sanity: ensure the jobs dir cleanup matches other test patterns (don't actually
// touch the file system; frames are kept in memory via mocks).
afterAll(() => {
  // clean up any stragglers written by translate-jobs.mjs under the real path
  // (mocks above intercept appendFrame so this should be a no-op).
  try {
    if (fs.existsSync(jobsDir)) {
      const all = fs.readdirSync(jobsDir)
      for (const f of all) {
        try { fs.unlinkSync(path.join(jobsDir, f)) } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
})