// translate-jobs JSONL frame log — persistence tests
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from '../src/config.mjs'

let jobsDir

beforeAll(() => {
  jobsDir = path.join(CONFIG.DERIVED_DIR, 'translate-jobs')
  fs.rmSync(jobsDir, { recursive: true, force: true })
})

afterAll(() => {
  fs.rmSync(jobsDir, { recursive: true, force: true })
})

beforeEach(() => {
  if (fs.existsSync(jobsDir)) {
    for (const f of fs.readdirSync(jobsDir)) {
      try { fs.unlinkSync(path.join(jobsDir, f)) } catch { /* ignore */ }
    }
  }
})

async function load() {
  return await import('../src/translate-jobs.mjs')
}

describe('translate-jobs: appendFrame round-trip', () => {
  it('assigns monotonic seq starting at 1; tailFrames returns in order', async () => {
    const m = await load()
    const jobId = 'job_roundtrip_' + Date.now()
    const f1 = m.appendFrame({ jobId, kind: 'started', payload: { total: 10 } })
    const f2 = m.appendFrame({ jobId, kind: 'page-done', payload: { page: 1 } })
    const f3 = m.appendFrame({ jobId, kind: 'page-done', payload: { page: 2 } })

    expect(f1.seq).toBe(1)
    expect(f2.seq).toBe(2)
    expect(f3.seq).toBe(3)
    expect(typeof f1.ts).toBe('number')
    expect(f1.tsIso).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const all = m.tailFrames({ jobId })
    expect(all.length).toBe(3)
    expect(all.map(x => x.seq)).toEqual([1, 2, 3])
    expect(all[0].kind).toBe('started')
    expect(all[1].payload.page).toBe(1)
  })

  it('persists a JSONL file per jobId; survives re-import', async () => {
    const jobId = 'job_persist_' + Date.now()
    let m = await load()
    m.appendFrame({ jobId, kind: 'started', payload: { x: 1 } })
    m.appendFrame({ jobId, kind: 'finished', payload: { ok: true } })

    // Re-import to simulate fresh module
    m = await load()
    const all = m.tailFrames({ jobId })
    expect(all.length).toBe(2)
    expect(all[1].kind).toBe('finished')
    expect(all[1].payload.ok).toBe(true)
  })
})

describe('translate-jobs: tailFrames delta', () => {
  it('sinceSeq=0 returns all; sinceSeq=N returns only frames with seq>N', async () => {
    const m = await load()
    const jobId = 'job_delta_' + Date.now()
    for (let i = 0; i < 5; i++) {
      m.appendFrame({ jobId, kind: 'page-done', payload: { i } })
    }
    const full = m.tailFrames({ jobId, sinceSeq: 0 })
    expect(full.length).toBe(5)

    const delta = m.tailFrames({ jobId, sinceSeq: 3 })
    expect(delta.length).toBe(2)
    expect(delta[0].seq).toBe(4)
    expect(delta[1].seq).toBe(5)
  })

  it('sinceSeq past the end returns empty array', async () => {
    const m = await load()
    const jobId = 'job_past_' + Date.now()
    m.appendFrame({ jobId, kind: 'started', payload: {} })
    const out = m.tailFrames({ jobId, sinceSeq: 999 })
    expect(out).toEqual([])
  })
})

describe('translate-jobs: 200 frame cap', () => {
  it('keeps only the newest 200 frames after writing 201', async () => {
    const m = await load()
    const jobId = 'job_cap_' + Date.now()
    for (let i = 0; i < 201; i++) {
      m.appendFrame({ jobId, kind: 'image-done', payload: { i } })
    }
    const all = m.tailFrames({ jobId })
    expect(all.length).toBe(200)
    // first kept seq should be 2 (oldest dropped), last should be 201
    expect(all[0].seq).toBe(2)
    expect(all[199].seq).toBe(201)
  })
})

describe('translate-jobs: 10k rotation', () => {
  it('rotates file to .<ts>.jsonl once it exceeds 10k lines', async () => {
    const m = await load()
    const jobId = 'job_rotate_' + Date.now()
    // Seed exactly 10_000 lines via raw file write; the next appendRaw should rotate.
    const file = m._jobFileNameForTest(jobId)
    const filePath = path.join(jobsDir, file)
    const lines = []
    for (let i = 1; i <= 10000; i++) {
      lines.push(JSON.stringify({ seq: i, ts: 1000 + i, tsIso: new Date(1000 + i).toISOString(), jobId, kind: 'page-done', payload: { i } }))
    }
    fs.mkdirSync(jobsDir, { recursive: true })
    fs.writeFileSync(filePath, lines.join('\n') + '\n')

    // This single appendRaw (via _appendFrameForTest) should trigger rotation
    m._appendFrameForTest({ jobId, seq: 10001, kind: 'page-done', payload: { i: 10001 } })

    const files = fs.readdirSync(jobsDir).filter(f => f.startsWith('job_rotate_'))
    // After rotation: at least one archive file whose name starts with the original
    // and is longer (i.e. '<original>.<ts>.jsonl' not just '<original>.jsonl').
    const archived = files.filter(f => f.length > file.length && f.startsWith(file.replace(/\.jsonl$/, '')))
    expect(archived.length).toBeGreaterThanOrEqual(1)
    // Current file still exists and contains the appended line
    expect(files).toContain(file)
  })
})

describe('translate-jobs: getJob', () => {
  it('returns status as last frame kind; null if no frames', async () => {
    const m = await load()
    const jobId = 'job_get_' + Date.now()
    expect(m.getJob({ jobId })).toBeNull()

    m.appendFrame({ jobId, kind: 'started', payload: {} })
    m.appendFrame({ jobId, kind: 'page-done', payload: { p: 1 } })
    m.appendFrame({ jobId, kind: 'finished', payload: {} })

    const j = m.getJob({ jobId })
    expect(j).not.toBeNull()
    expect(j.jobId).toBe(jobId)
    expect(j.status).toBe('finished')
    expect(j.lastSeq).toBe(3)
    expect(j.frameCount).toBe(3)
    expect(typeof j.createdAt).toBe('number')
  })
})

describe('translate-jobs: isJobCancelled', () => {
  it('returns true if any frame has kind=cancelled; false otherwise', async () => {
    const m = await load()
    const j1 = 'job_cancel_' + Date.now()
    const j2 = 'job_ok_' + Date.now()
    m.appendFrame({ jobId: j1, kind: 'started', payload: {} })
    m.appendFrame({ jobId: j1, kind: 'cancelled', payload: { reason: 'user' } })
    expect(m.isJobCancelled({ jobId: j1 })).toBe(true)

    m.appendFrame({ jobId: j2, kind: 'started', payload: {} })
    m.appendFrame({ jobId: j2, kind: 'finished', payload: {} })
    expect(m.isJobCancelled({ jobId: j2 })).toBe(false)
  })

  it('returns false for unknown jobId', async () => {
    const m = await load()
    expect(m.isJobCancelled({ jobId: 'nonexistent_xyz' })).toBe(false)
  })
})

describe('translate-jobs: bad jobId resilience', () => {
  it('sanitizes path-traversal jobId; file stays inside jobsDir, no ".." segments', async () => {
    const m = await load()
    // Path-traversal attempt must not escape jobsDir
    const result = m.appendFrame({ jobId: '../etc/passwd', kind: 'started', payload: {} })
    expect(result.seq).toBe(1)
    const afterFiles = fs.readdirSync(jobsDir)
    // No file with ".." segments (would indicate path traversal escape)
    expect(afterFiles.every(f => !f.includes('..'))).toBe(true)
    const tail = m.tailFrames({ jobId: '../etc/passwd' })
    expect(tail.length).toBe(1)
    expect(tail[0].kind).toBe('started')
  })
})

describe('translate-jobs: concurrent append atomicity', () => {
  it('serial appendFrame calls produce contiguous, monotonic seq without interleaving', async () => {
    const m = await load()
    const jobId = 'job_concurrent_' + Date.now()
    // Issue many synchronous appends in one tick; each await is the file write
    const seqs = []
    const N = 50
    for (let i = 0; i < N; i++) {
      const f = m.appendFrame({ jobId, kind: 'image-done', payload: { i, marker: `m_${i}_end` } })
      seqs.push(f.seq)
    }
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1))

    // Read back: no missing frames, no duplicated frames
    const all = m.tailFrames({ jobId })
    expect(all.length).toBe(N)
    const readSeqs = all.map(x => x.seq)
    expect(readSeqs).toEqual(seqs)
    // Verify each payload marker is intact (no JSONL line got split or merged)
    for (let i = 0; i < N; i++) {
      expect(all[i].payload.i).toBe(i)
      expect(all[i].payload.marker).toBe(`m_${i}_end`)
    }
  })
})
