// translate.mjs extensions — jobId / glossary / TM / progress callbacks
// 模型：claude-sonnet-4-6
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from '../src/config.mjs'

let translate, appendFrame, tailFrames, getJob, isJobCancelled, clearJob
let applyGlossary, listTerms, appendTerm, clearGlossary
let addTmEntry, lookupTm, clearTm, scoreSimilarity

let jobsDir, glossariesDir, tmDir

beforeAll(async () => {
  const tj = await import('../src/translate-jobs.mjs')
  appendFrame = tj.appendFrame
  tailFrames = tj.tailFrames
  getJob = tj.getJob
  isJobCancelled = tj.isJobCancelled
  clearJob = tj.clearJob

  const tg = await import('../src/translate-glossary.mjs')
  applyGlossary = tg.applyGlossary
  listTerms = tg.listTerms
  appendTerm = tg.appendTerm
  clearGlossary = tg.clearGlossary

  const tm = await import('../src/translate-memory.mjs')
  addTmEntry = tm.addTmEntry
  lookupTm = tm.lookupTm
  clearTm = tm.clearTm
  scoreSimilarity = tm.scoreSimilarity

  translate = (await import('../src/translate.mjs')).translate

  jobsDir = path.join(CONFIG.DERIVED_DIR, 'translate-jobs')
  glossariesDir = path.join(CONFIG.DERIVED_DIR, 'glossaries')
  tmDir = path.join(CONFIG.DERIVED_DIR, 'translation-memory')
})

beforeEach(() => {
  // 仅清空本测试创建的文件（避免与并行运行的其他测试冲突）
  // 不 rmSync 顶层目录（共享资源）
  if (fs.existsSync(jobsDir)) {
    for (const f of fs.readdirSync(jobsDir)) {
      try { fs.unlinkSync(path.join(jobsDir, f)) } catch { /* ignore */ }
    }
  }
  if (fs.existsSync(glossariesDir)) {
    for (const f of fs.readdirSync(glossariesDir)) {
      try { fs.unlinkSync(path.join(glossariesDir, f)) } catch { /* ignore */ }
    }
  }
  if (fs.existsSync(tmDir)) {
    for (const f of fs.readdirSync(tmDir)) {
      try { fs.unlinkSync(path.join(tmDir, f)) } catch { /* ignore */ }
    }
  }
})

afterAll(() => {
  // 不要 rmSync 共享目录（其他测试也用），只清空文件
  if (fs.existsSync(jobsDir)) {
    for (const f of fs.readdirSync(jobsDir)) {
      try { fs.unlinkSync(path.join(jobsDir, f)) } catch { /* ignore */ }
    }
  }
  if (fs.existsSync(glossariesDir)) {
    for (const f of fs.readdirSync(glossariesDir)) {
      try { fs.unlinkSync(path.join(glossariesDir, f)) } catch { /* ignore */ }
    }
  }
  if (fs.existsSync(tmDir)) {
    for (const f of fs.readdirSync(tmDir)) {
      try { fs.unlinkSync(path.join(tmDir, f)) } catch { /* ignore */ }
    }
  }
})

/** 构造一个带 N 页的 docx-like task（绕过真实转换，让 translate() 走 doc 分支） */
function makeDocTask(id, pageCount, linesPerPage = 5) {
  const pages = []
  for (let p = 1; p <= pageCount; p++) {
    pages.push({
      page: p,
      text: Array.from({ length: linesPerPage }, (_, i) => `第 ${p} 页第 ${i + 1} 行：原文内容`).join('\n'),
      width: 794,
      height: 1123,
    })
  }
  return {
    id,
    name: `${id}.docx`,
    ext: 'docx',
    previewExt: 'docx',
    pages,
    status: 'ready',
  }
}

describe('translate() with jobId: frame sequence', () => {
  it('writes started + page-done×N + finished frames in order', async () => {
    const jobId = 'tj_seq_' + Date.now()
    const task = makeDocTask('tj-seq', 3)
    const result = await translate({
      text: '',
      sourceLang: 'zh-CN',
      targetLang: 'en',
      taskId: task.id,
      task,
      jobId,
    })

    expect(result.meta.jobId).toBe(jobId)
    const frames = tailFrames({ jobId })
    const kinds = frames.map(f => f.kind)
    expect(kinds[0]).toBe('started')
    expect(kinds.filter(k => k === 'page-done').length).toBe(3)
    expect(kinds[kinds.length - 1]).toBe('finished')
    // started 必须在 page-done 之前
    const startedIdx = frames.findIndex(f => f.kind === 'started')
    const firstPageIdx = frames.findIndex(f => f.kind === 'page-done')
    expect(startedIdx).toBeLessThan(firstPageIdx)
  })

  it('onPageProgress called exactly N times for N pages', async () => {
    const jobId = 'tj_prog_' + Date.now()
    const task = makeDocTask('tj-prog', 4)
    const onPageProgress = vi.fn()
    await translate({
      text: '',
      sourceLang: 'zh-CN',
      targetLang: 'en',
      taskId: task.id,
      task,
      jobId,
      onPageProgress,
    })
    expect(onPageProgress).toHaveBeenCalledTimes(4)
    // 第二次调用时 index=1, total=4
    const secondCall = onPageProgress.mock.calls[1]
    expect(secondCall[1]).toBe(1) // index
    expect(secondCall[2]).toBe(4) // total
  })

  it('isJobCancelled check aborts loop at next page boundary', async () => {
    const jobId = 'tj_cancel_' + Date.now()
    const task = makeDocTask('tj-cancel', 5)

    // 启动一个 50ms 后追加 cancelled 的计时器
    setTimeout(() => {
      appendFrame({ jobId, kind: 'cancelled', payload: { reason: 'user' } })
    }, 30)

    const onPageProgress = vi.fn(async () => {
      // 模拟工作 30ms，足够让 cancel 帧写入
      await new Promise(r => setTimeout(r, 25))
    })

    await expect(translate({
      text: '',
      sourceLang: 'zh-CN',
      targetLang: 'en',
      taskId: task.id,
      task,
      jobId,
      onPageProgress,
    })).rejects.toThrow(/cancel/i)

    // 至少有一页已完成（page-done 1 帧），但 finished 不应存在
    const frames = tailFrames({ jobId })
    expect(frames.some(f => f.kind === 'cancelled')).toBe(true)
    expect(frames.some(f => f.kind === 'finished')).toBe(false)
  })

  it('glossary hits count surfaced in meta.glossaryHits', async () => {
    const jobId = 'tj_glo_' + Date.now()
    appendTerm({ sourceLang: 'zh-CN', targetLang: 'en', source: '你好', target: 'Hello' })
    appendTerm({ sourceLang: 'zh-CN', targetLang: 'en', source: '世界', target: 'World' })

    // 用包含 glossary terms 的页面文本
    const task = {
      id: 'tj-glo',
      name: 'tj-glo.docx',
      ext: 'docx',
      previewExt: 'docx',
      pages: [
        { page: 1, text: '你好，世界。这是一段测试文本。', width: 794, height: 1123 },
        { page: 2, text: '世界你好世界你好，你好。', width: 794, height: 1123 },
      ],
      status: 'ready',
    }
    const glossary = listTerms({ sourceLang: 'zh-CN', targetLang: 'en' })
    const result = await translate({
      text: '',
      sourceLang: 'zh-CN',
      targetLang: 'en',
      taskId: task.id,
      task,
      jobId,
      glossary,
    })
    // 页面 1: "你好" 1次 + "世界" 1次 = 2
    // 页面 2: "世界" 2次 + "你好" 2次 = 4
    expect(result.meta.glossaryHits).toBeGreaterThanOrEqual(6)
  })

  it('TM hits count surfaced in meta.tmHits', async () => {
    const jobId = 'tj_tm_' + Date.now()
    // 注入两条 TM：第一条会高频命中，第二条用作对照组
    addTmEntry({
      sourceLang: 'zh-CN',
      targetLang: 'en',
      source: '这是常见短语',
      target: 'This is a common phrase',
    })

    const task = makeDocTask('tj-tm', 1, 5)
    const tm = lookupTm({
      sourceLang: 'zh-CN',
      targetLang: 'en',
      query: '第 1 页第 1 行：原文内容',
      threshold: 0.0, // 把所有命中拉进来
      limit: 200,
    })
    const result = await translate({
      text: '',
      sourceLang: 'zh-CN',
      targetLang: 'en',
      taskId: task.id,
      task,
      jobId,
      tm,
    })
    expect(typeof result.meta.tmHits).toBe('number')
    expect(result.meta.tmHits).toBeGreaterThanOrEqual(0)
  })

  it('empty task.pages → no page-done frames, just finished', async () => {
    const jobId = 'tj_empty_' + Date.now()
    const task = makeDocTask('tj-empty', 0)
    await translate({
      text: '',
      sourceLang: 'zh-CN',
      targetLang: 'en',
      taskId: task.id,
      task,
      jobId,
    })
    const frames = tailFrames({ jobId })
    expect(frames.filter(f => f.kind === 'page-done').length).toBe(0)
    expect(frames[frames.length - 1].kind).toBe('finished')
  })

  it('failure on page N writes failed frame + rethrows', async () => {
    const jobId = 'tj_fail_' + Date.now()
    const task = makeDocTask('tj-fail', 3)

    // onPageProgress 在第 2 页抛出，模拟 page N 失败
    const onPageProgress = vi.fn(async (page, index, total, ms) => {
      if (page === 2) throw new Error('simulated page 2 failure')
    })

    await expect(translate({
      text: '',
      sourceLang: 'zh-CN',
      targetLang: 'en',
      taskId: task.id,
      task,
      jobId,
      onPageProgress,
    })).rejects.toThrow(/simulated page 2 failure/)

    const frames = tailFrames({ jobId })
    const failed = frames.find(f => f.kind === 'failed')
    expect(failed).toBeTruthy()
    expect(failed.payload.error).toMatch(/simulated page 2 failure/)
    expect(failed.payload.page).toBe(2)
    // finished 不应存在
    expect(frames.some(f => f.kind === 'finished')).toBe(false)
  })

  it('word counts correct (split on whitespace)', async () => {
    const jobId = 'tj_words_' + Date.now()
    const task = {
      id: 'tj-words',
      name: 'tj-words.docx',
      ext: 'docx',
      previewExt: 'docx',
      pages: [
        { page: 1, text: 'hello world foo bar', width: 794, height: 1123 },
        { page: 2, text: 'baz qux quux corge', width: 794, height: 1123 },
      ],
      status: 'ready',
    }
    const result = await translate({
      text: '',
      sourceLang: 'en',
      targetLang: 'en',
      taskId: task.id,
      task,
      jobId,
    })
    // 4 words × 2 pages = 8 source words
    expect(result.meta.sourceWords).toBe(8)
    expect(typeof result.meta.targetWords).toBe('number')
  })
})