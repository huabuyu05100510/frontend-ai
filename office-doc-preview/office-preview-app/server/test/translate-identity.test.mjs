// translate.mjs — identity mock 单元测试
// 模型：claude-sonnet-4-6
//
// v4.0：当源任务是 DOCX/PDF 时，translate() 走 identity mock
//   - 跳过 paginateText（人造页），按 task.pages 原页结构返回
//   - charMap identity：srcStart=srcEnd=0..N, tgtStart=tgtEnd=0..N
//   - 等真实翻译 API 接入时，替换 translate() 内部 mock 即可

import { describe, it, expect, beforeEach } from 'vitest'
import { translate, buildIdentityPagesFromTask } from '../src/translate.mjs'

// ============ Fixtures ============

function makeTask({ ext = 'docx', pages = [] } = {}) {
  return {
    id: 'task-test',
    ext,
    previewExt: ext,
    pages,
  }
}

function makePage({ idx = 1, text = 'Hello', width = 794, height = 1123 } = {}) {
  return {
    page: idx,
    url: `/api/files/task-test?as=page&n=${idx}`,
    textUrl: `/api/files/task-test?as=text&n=${idx}`,
    textWords: text.length,
    bytes: 1024,
    width,
    height,
    text, // text-layer 抽出的纯文本
  }
}

// ============ buildIdentityPagesFromTask 单元测试 ============

describe('buildIdentityPagesFromTask（v4.0 identity mock）', () => {
  it('1. DOCX 任务返回 identity pages（sourceText === targetText）', () => {
    const task = makeTask({
      ext: 'docx',
      pages: [makePage({ idx: 1, text: '你好世界' })],
    })
    const pages = buildIdentityPagesFromTask(task, 'en')
    expect(pages).toHaveLength(1)
    expect(pages[0].sourceText).toBe('你好世界')
    expect(pages[0].targetText).toBe('你好世界')  // identity
  })

  it('2. PDF 任务返回 identity pages', () => {
    const task = makeTask({
      ext: 'pdf',
      pages: [makePage({ idx: 1, text: 'PDF page 1' })],
    })
    const pages = buildIdentityPagesFromTask(task, 'en')
    expect(pages).toHaveLength(1)
    expect(pages[0].targetText).toBe('PDF page 1')
  })

  it('3. identity charMap per-char：每个 src char → 对应 tgt char（hover 联动粒度 = 单字）', () => {
    const task = makeTask({
      ext: 'docx',
      pages: [makePage({ idx: 1, text: '你好世界' })],  // 4 chars
    })
    const pages = buildIdentityPagesFromTask(task, 'en')
    expect(pages[0].charMap).toEqual([
      { srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 },
      { srcStart: 1, srcEnd: 2, tgtStart: 1, tgtEnd: 2 },
      { srcStart: 2, srcEnd: 3, tgtStart: 2, tgtEnd: 3 },
      { srcStart: 3, srcEnd: 4, tgtStart: 3, tgtEnd: 4 },
    ])
  })

  it('4. task.pages 为空 → 返回空 pages', () => {
    const task = makeTask({ ext: 'docx', pages: [] })
    const pages = buildIdentityPagesFromTask(task, 'en')
    expect(pages).toEqual([])
  })

  it('5. task.pages[i].text 缺失 → sourceText="" + charMap=[]', () => {
    const task = makeTask({
      ext: 'docx',
      pages: [{ page: 1, url: '/x', width: 794, height: 1123 }],  // 无 text
    })
    const pages = buildIdentityPagesFromTask(task, 'en')
    expect(pages[0].sourceText).toBe('')
    expect(pages[0].targetText).toBe('')
    expect(pages[0].charMap).toEqual([])
  })

  it('6. 页 W/H 从 task.pages[i].width/height 读', () => {
    const task = makeTask({
      ext: 'docx',
      pages: [makePage({ idx: 1, text: 'A', width: 1239, height: 1752 })],
    })
    const pages = buildIdentityPagesFromTask(task, 'en')
    expect(pages[0].pageW).toBe(1239)
    expect(pages[0].pageH).toBe(1752)
  })

  it('7. 多页：每页独立 charMap，pages 顺序与 task.pages 一致', () => {
    const task = makeTask({
      ext: 'docx',
      pages: [
        makePage({ idx: 1, text: 'ABC' }),  // 3 chars
        makePage({ idx: 2, text: 'DEFGH' }),  // 5 chars
        makePage({ idx: 3, text: '' }),  // empty
      ],
    })
    const pages = buildIdentityPagesFromTask(task, 'en')
    expect(pages).toHaveLength(3)
    // page 1: per-char (3 段)
    expect(pages[0].charMap).toHaveLength(3)
    expect(pages[0].charMap[0]).toEqual({ srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 })
    // page 2: per-char (5 段)
    expect(pages[1].charMap).toHaveLength(5)
    // page 3: 空
    expect(pages[2].charMap).toEqual([])
    expect(pages[0].page).toBe(1)
    expect(pages[1].page).toBe(2)
    expect(pages[2].page).toBe(3)
  })
})

// ============ translate() 集成测试 ============

describe('translate() — DOCX/PDF 走 identity mock', () => {
  it('8. DOCX 任务 → translate() 返回 identity pages（不调 paginateText）', async () => {
    const task = makeTask({
      ext: 'docx',
      pages: [makePage({ idx: 1, text: '你好世界' })],
    })
    const result = await translate({
      text: '你好世界',  // extractTaskText 会用，但 identity 模式忽略
      sourceLang: 'zh-CN',
      targetLang: 'en',
      task,
    })
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0].sourceText).toBe('你好世界')
    expect(result.pages[0].targetText).toBe('你好世界')
    // per-char charMap（4 段）
    expect(result.pages[0].charMap).toHaveLength(4)
    expect(result.meta.engine).toBe('identity-mock-v1')
  })

  it('9. txt 任务 → translate() 仍走 v3.1 paginateText + mockTranslateWithMap', async () => {
    const task = makeTask({ ext: 'txt', pages: [] })
    const result = await translate({
      text: '你好世界',
      sourceLang: 'zh-CN',
      targetLang: 'en',
      task,
    })
    // 旧管线：paginateText 把全文切成 N 页，targetText 是 mock 翻译结果（不是 identity）
    expect(result.pages.length).toBeGreaterThan(0)
    expect(result.pages[0].sourceText).toBe('你好世界')
    // 旧管线：targetText != sourceText（除非是同源不译或英文源）
    // 这里用 charMap 长度判断更稳定：identity 是 1 段，旧管线是 N 段
    expect(result.meta.engine).toBe('mock-v1')
  })
})
