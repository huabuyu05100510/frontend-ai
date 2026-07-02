// 翻译服务：mock-v1（按段落 + 语言标记前缀）
// 模型：claude-sonnet-4-6
//
// 真实场景可对接讯飞 / 百度 / DeepL / OpenAI 等。
// 本模块提供契约与 mock，便于前端先跑通端到端流程。
//
// 协议：
//   translate({ text, sourceLang, targetLang }) → { segments, paragraphBlocks, ms }
//
// 关键设计：翻译场景每段 1:1 配对，不应被 Myers paragraphDiff 错位打散。
// 这里直接用每段 source ↔ target 的 myersDiff 生成 charOps，确保 paragraphBlocks[i]
// 与 segments[i] 严格对齐（前端 DualColumnView 按 pairId 渲染 + 联动高亮）。
//
// v4.3 扩展（Phase A.2）：
//   - translatePagesAsync 新增 onPageProgress 回调（每页后 await，便于 cancel 检查）
//   - translate() 新增 jobId / glossary / tm 参数
//   - meta 增加 glossaryHits / tmHits / sourceWords / targetWords / mode / jobId
//   - jobId 模式下自动 appendFrame('started' / 'page-done' / 'finished' / 'failed' / 'cancelled')

import fs from 'node:fs'
import path from 'node:path'
import { splitParagraphs, myersDiff } from './diff.mjs'
import { translateAI, getActiveProvider } from './translate-provider.mjs'
import { appendFrame, isJobCancelled } from './translate-jobs.mjs'
import { applyGlossary as applyGlossaryFn } from './translate-glossary.mjs'
import { lookupTm } from './translate-memory.mjs'

/** v4.3：被 abort/cancel 触发的特殊错误，标志翻译循环在页面边界中断 */
export class CancelledError extends Error {
  constructor(jobId, lastPage) {
    super(`translate cancelled for jobId=${jobId} at page=${lastPage}`)
    this.name = 'CancelledError'
    this.jobId = jobId
    this.lastPage = lastPage
  }
}

/** 简单 wrapper：计算 glossary 在 text 中的命中次数（大小写不敏感，可重叠） */
function countGlossaryHits(text, glossary) {
  if (typeof text !== 'string' || !Array.isArray(glossary) || glossary.length === 0) return 0
  let count = 0
  const lower = text.toLowerCase()
  for (const g of glossary) {
    if (!g || typeof g.source !== 'string' || !g.source) continue
    const needle = g.source.toLowerCase()
    if (!needle) continue
    let idx = 0
    while ((idx = lower.indexOf(needle, idx)) !== -1) {
      count++
      idx += needle.length
    }
  }
  return count
}

/** 字数（按 \s+ split 空白） */
function wordCount(text) {
  if (typeof text !== 'string' || !text) return 0
  return text.split(/\s+/).filter(Boolean).length
}

/** 支持的语言（与前端 LangCode 对齐） */
export const SUPPORTED_LANGS = new Set(['zh-CN', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'])

/** 语言简短显示名（用于 mock 翻译前缀，便于肉眼观察） */
const LANG_TAG = {
  'zh-CN': 'zh', 'en': 'en', 'ja': 'ja', 'ko': 'ko',
  'fr': 'fr', 'de': 'de', 'es': 'es', 'ru': 'ru'
}

/**
 * Mock 翻译：把每段加上 `[targetLang]` 前缀（真实实现替换为外部 API）
 * @param {string} text
 * @param {string} targetLang
 * @returns {string}
 */
export function mockTranslate(text, targetLang) {
  const tag = LANG_TAG[targetLang] || targetLang
  // 单段直接加前缀；多行保留换行
  if (!text) return ''
  return text.split('\n').map(line => line.length ? `[${tag}] ${line}` : '').join('\n')
}

// ============ v3.1：译文用源文件 mock + 字符级对应 ============
// 真实场景对接讯飞 / DeepL / OpenAI，本模块提供 mock 实现：
//   - 字典优先：常见词 → 真实翻译（"你好" → "Hello"）
//   - 单字回退：字典未命中 → 字符哈希 → 1:2 字母编码（保留长度感）
//   - 同源不译：source === target 时 identity mock
//   - charMap：每段 (srcStart, srcEnd) → (tgtStart, tgtEnd) 用于 hover 联动

/** 中 → 英 mock 字典（按多字优先匹配；真实场景替换为翻译 API） */
const MOCK_DICT_ZH_EN = {
  '原文和译文': 'Source and target',
  '原文和译文应该是相同的格式': 'Source and target should use the same format',
  '你好世界': 'Hello World',
  '你好': 'Hello',
  '世界': 'World',
  '原文': 'Source',
  '译文': 'Target',
  '翻译': 'translation',
  '相同': 'same',
  '的格式': ' format',
  '格式': 'format',
  '应该': 'should',
  '是': 'is',
  '和': ' and ',
  '这是': 'This is',
  '测试': 'test',
  '你好吗': 'How are you',
  '谢谢': 'Thank you',
  '再见': 'Goodbye',
  '请': 'please',
  '。': '. ',
  '，': ', ',
  '：': ': ',
  '；': '; ',
  '！': '! ',
  '？': '? ',
  '\n': '\n',
  ' ': ' ',
}

/** 单字回退：中文字 → 2 字母编码（确定性、可读性、保持 1:N 对应） */
function charFallback(ch, targetLang) {
  if (targetLang === 'zh-CN') return ch
  if (/[a-zA-Z0-9]/.test(ch)) return ch  // 英文/数字原样
  if (/[\s\p{P}]/u.test(ch)) {
    // 标点：英文版本
    const punctMap = { '。': '.', '，': ',', '：': ':', '；': ';', '！': '!', '？': '?', '（': '(', '）': ')' }
    return punctMap[ch] || ch
  }
  // 任意 unicode 字符 → 2 字母 base26 编码
  const code = ch.codePointAt(0) || 0
  return String.fromCharCode(97 + (code % 26)) + String.fromCharCode(97 + (Math.floor(code / 26) % 26))
}

/**
 * Mock 翻译：使用源文件内容生成有意义的翻译 + 字符级对应
 * @param {string} text
 * @param {string} targetLang
 * @returns {{ target: string, charMap: Array<{srcStart: number, srcEnd: number, tgtStart: number, tgtEnd: number}> }}
 */
export function mockTranslateWithMap(text, targetLang) {
  if (!text) return { target: '', charMap: [] }
  if (!SUPPORTED_LANGS.has(targetLang)) {
    throw new Error(`unsupported targetLang: ${targetLang}`)
  }

  // 同源不译：identity
  // - zh-CN → zh-CN：完全不动
  // - en → en：仅当文本是英文 ASCII（含常见英文标点）才 identity；中文/全角标点视为待翻译
  if (targetLang === 'zh-CN' || (targetLang === 'en' && /^[a-zA-Z0-9\s.,!?:;'"\-()\[\]{}&@#$%^*+=/\\|~`<>]+$/.test(text))) {
    const chars = Array.from(text)
    return {
      target: text,
      charMap: [{ srcStart: 0, srcEnd: chars.length, tgtStart: 0, tgtEnd: chars.length }],
    }
  }

  const chars = Array.from(text)
  const dict = MOCK_DICT_ZH_EN  // 当前只支持 zh→en 字典；其他语言走 charFallback
  const target = []
  const charMap = []
  let i = 0
  let tgtPos = 0

  while (i < chars.length) {
    // 最大匹配优先（最多 10 字）
    let matched = null
    const maxLen = Math.min(10, chars.length - i)
    for (let len = maxLen; len >= 1; len--) {
      const key = chars.slice(i, i + len).join('')
      if (dict[key]) {
        matched = { len, translation: dict[key] }
        break
      }
    }
    if (matched) {
      charMap.push({ srcStart: i, srcEnd: i + matched.len, tgtStart: tgtPos, tgtEnd: tgtPos + matched.translation.length })
      target.push(matched.translation)
      tgtPos += matched.translation.length
      i += matched.len
    } else {
      // 单字回退
      const ch = chars[i]
      const trans = charFallback(ch, targetLang)
      charMap.push({ srcStart: i, srcEnd: i + 1, tgtStart: tgtPos, tgtEnd: tgtPos + trans.length })
      target.push(trans)
      tgtPos += trans.length
      i += 1
    }
  }

  return { target: target.join(''), charMap }
}

/**
 * 从 task 提取原始文本（与前端 extractText 对齐）
 *  - txt/md：直接读原文件（trim 尾部空白，避免 splitParagraphs emptyRatio 启发式误判）
 *  - pdf/docx：拼接 text-layer HTML（无 textDir 时回退 original）
 */
export function extractTaskText(task) {
  if (!task) return ''
  const ext = (task.previewExt || task.ext || '').toLowerCase()
  if (['txt', 'md'].includes(ext)) {
    if (task.originalPath && fs.existsSync(task.originalPath)) {
      // 去掉尾部空白行（避免 splitParagraphs 误把全文判为 1 段）
      const raw = fs.readFileSync(task.originalPath, 'utf-8')
      return raw.replace(/\s+$/, '')
    }
    return ''
  }
  if (task.textDir && fs.existsSync(task.textDir)) {
    const files = fs.readdirSync(task.textDir)
      .filter(f => /^page-\d+\.html$/.test(f))
      .sort()
    const parts = files.map(f => {
      const html = fs.readFileSync(path.join(task.textDir, f), 'utf-8')
      // 粗略：去掉标签取文本
      return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    })
    return parts.join('\n')
  }
  // 兜底：原文件（binary 会乱码，仅对纯文本有效）
  if (task.originalPath && fs.existsSync(task.originalPath)) {
    try {
      const raw = fs.readFileSync(task.originalPath, 'utf-8')
      return raw.replace(/\s+$/, '')
    } catch {}
  }
  return ''
}

/**
 * 批量翻译段落（异步，支持 AI provider）
 * @returns {Promise<string[]>}
 */
async function translateSegmentsAsync(paragraphs, sourceLang, targetLang) {
  const hasAIProvider = !!(process.env.MINIMAX_API_KEY || process.env.ZHIPU_API_KEY || process.env.VOLCANO_API_KEY)
  if (!hasAIProvider) {
    // No real AI provider → use mock
    return paragraphs.map(src => mockTranslate(src, targetLang))
  }
  try {
    const joined = paragraphs.join('\n---SEG---\n')
    const { target } = await translateAI({ text: joined, sourceLang, targetLang })
    return target.split('\n---SEG---\n').map(s => s.trim())
  } catch (e) {
    console.warn('[translate] AI translation failed, fallback to mock:', e.message)
    return paragraphs.map(src => mockTranslate(src, targetLang))
  }
}

/**
 * 批量翻译 task.pages（PDF/DOCX 多页）
 * v4.3：新增 opts.onPageProgress(page, index, total, ms) — 每页翻译后 await 调用，
 *       便于调用方做取消检查、写入 JSONL 进度帧等。
 * @param {object} task
 * @param {string} targetLang
 * @param {string} sourceLang
 * @param {{ onPageProgress?: (page: number, index: number, total: number, ms: number) => Promise<void>|void }} [opts]
 * @returns {Promise<Array<{page, sourceText, targetText, charMap, pageW, pageH, startLine, endLine}>>}
 */
async function translatePagesAsync(task, targetLang, sourceLang, opts = {}) {
  const results = []
  const total = Array.isArray(task.pages) ? task.pages.length : 0
  for (let i = 0; i < task.pages.length; i++) {
    const p = task.pages[i]
    const text = p.text || readPageTextFromTextDir(task, p.page)
    const t0 = Date.now()
    if (!text || !text.trim()) {
      results.push({
        page: p.page, sourceText: text || '', targetText: text || '',
        charMap: [], pageW: p.width || 794, pageH: p.height || 1123, startLine: 1, endLine: 1,
      })
      if (typeof opts.onPageProgress === 'function') {
        await opts.onPageProgress(p.page, i, total, Date.now() - t0)
      }
      continue
    }
    try {
      const { target } = await translateAI({ text, sourceLang, targetLang })
      const chars = Array.from(text)
      const charMap = chars.map((_, ci) => ({
        srcStart: ci, srcEnd: ci + 1,
        tgtStart: ci, tgtEnd: Math.min(ci + 1, target.length),
      }))
      results.push({
        page: p.page, sourceText: text, targetText: target, charMap,
        pageW: p.width || 794, pageH: p.height || 1123, startLine: 1, endLine: 1,
      })
    } catch (e) {
      // fallback
      results.push({
        page: p.page, sourceText: text, targetText: text,
        charMap: [], pageW: p.width || 794, pageH: p.height || 1123, startLine: 1, endLine: 1,
      })
    }
    if (typeof opts.onPageProgress === 'function') {
      await opts.onPageProgress(p.page, i, total, Date.now() - t0)
    }
  }
  return results
}

/**
 * 按页翻译（异步版）
 * 当有 AI provider 时使用 AI 翻译，否则 fallback 到 mockTranslateWithMap（字符编码翻译）
 */
async function paginateTextAsync(text, { linesPerPage = 30, pageW = 794, pageH = 1123, targetLang = 'en', sourceLang = 'zh-CN' } = {}) {
  if (!text) return []
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length === 0) return []

  const hasAIProvider = !!(process.env.MINIMAX_API_KEY || process.env.ZHIPU_API_KEY || process.env.VOLCANO_API_KEY)

  const pages = []
  for (let i = 0; i < lines.length; i += linesPerPage) {
    const chunk = lines.slice(i, i + linesPerPage)
    const sourceText = chunk.join('\n')
    if (sourceText.trim().length === 0) continue
    const pageNum = pages.length + 1

    let targetText, charMap

    if (hasAIProvider) {
      try {
        const { target } = await translateAI({ text: sourceText, sourceLang, targetLang })
        targetText = target
        charMap = [] // AI translation charMap is approximate
      } catch {
        const r = mockTranslateWithMap(sourceText, targetLang)
        targetText = r.target
        charMap = r.charMap
      }
    } else {
      const r = mockTranslateWithMap(sourceText, targetLang)
      targetText = r.target
      charMap = r.charMap
    }

    pages.push({ page: pageNum, sourceText, targetText, charMap, pageW, pageH, startLine: i + 1, endLine: i + chunk.length })
  }
  return pages
}

/**
 * 翻译入口
 * v4.3：新增 jobId / glossary / tm / onPageProgress 参数
 *  - jobId: 启用 JSONL 进度日志（started / page-done / finished / failed / cancelled）
 *  - glossary: 翻译前应用术语表（保留一致性）
 *  - tm: 翻译后用 lookupTm 查命中率（写入 meta.tmHits）
 *  - onPageProgress: 每页翻译后回调（caller 可注入取消检查逻辑）
 *
 * @param {{
 *   text: string,
 *   sourceLang: string,
 *   targetLang: string,
 *   taskId?: string,
 *   strategy?: string,
 *   linesPerPage?: number,
 *   pageW?: number,
 *   pageH?: number,
 *   task?: object|null,
 *   jobId?: string,
 *   glossary?: Array,
 *   tm?: Array,
 *   onPageProgress?: (page: number, index: number, total: number, ms: number) => Promise<void>|void
 * }} opts
 * @returns {Promise<{sourceLang, targetLang, segments, paragraphBlocks, pages, ms, meta}>}
 */
export async function translate({
  text, sourceLang, targetLang, taskId, strategy,
  linesPerPage = 30, pageW = 794, pageH = 1123, task = null,
  jobId = null, glossary = null, tm = null, onPageProgress = null,
}) {
  const t0 = Date.now()
  if (!SUPPORTED_LANGS.has(sourceLang)) throw new Error(`unsupported sourceLang: ${sourceLang}`)
  if (!SUPPORTED_LANGS.has(targetLang)) throw new Error(`unsupported targetLang: ${targetLang}`)

  // ============ v4.3: jobId 启动帧 ============
  if (jobId) {
    const totalPages = task && Array.isArray(task.pages) ? task.pages.length : 0
    appendFrame({
      jobId,
      kind: 'started',
      payload: {
        totalPages,
        glossaryCount: Array.isArray(glossary) ? glossary.length : 0,
        tmCount: Array.isArray(tm) ? tm.length : 0,
        sourceLang, targetLang,
        ts: new Date().toISOString(),
      },
    })
    console.log(`[translate-job ${new Date().toISOString()}] job=${jobId} started pages=${totalPages} src=${sourceLang} tgt=${targetLang} glossary=${Array.isArray(glossary) ? glossary.length : 0} tm=${Array.isArray(tm) ? tm.length : 0}`)
  }

  // v4.3：jobId 模式下，caller 注入的 onPageProgress 包装一层
  //   1. 检查 isJobCancelled
  //   2. 写入 page-done 帧
  //   3. 跟踪 lastPage / lastAttemptedPage（错误帧用）
  let lastPage = 0
  let lastAttemptedPage = 0
  const wrappedOnPageProgress = jobId
    ? async (page, index, total, ms) => {
        // 0) 跟踪最近尝试的页（即使后续抛错也保留）
        lastAttemptedPage = page
        // 1) 取消检查
        if (isJobCancelled({ jobId })) {
          const err = new CancelledError(jobId, page)
          throw err
        }
        // 2) caller 自定义回调（如有）
        if (typeof onPageProgress === 'function') {
          await onPageProgress(page, index, total, ms)
        }
        // 3) 写入 page-done 帧（payload 含 sourceChars/targetChars/glossaryHits/tmHits）
        const pageData = (task && Array.isArray(task.pages)) ? task.pages[index] : null
        const sourceText = pageData ? (pageData.text || '') : ''
        appendFrame({
          jobId,
          kind: 'page-done',
          payload: {
            page, totalPages: total, ms,
            sourceChars: Array.from(sourceText).length,
            targetChars: 0, // 由 caller / 后续 steps 补充
            glossaryHits: 0,
            tmHits: 0,
          },
        })
        lastPage = page
      }
    : onPageProgress

  // ============ v4.3: 取消检查包裹 translatePagesAsync 调用 ============
  let docResult = null
  try {
    // v4.0：DOCX/PDF 任务走真实 AI 翻译（有 API key 时）或 identity mock
    if (task && (task.ext === 'docx' || task.ext === 'pdf' || task.previewExt === 'docx' || task.previewExt === 'pdf') && Array.isArray(task.pages) && task.pages.length > 0) {
      const provider = strategy === 'synthetic' ? undefined : (process.env.TRANSLATE_PROVIDER || 'mock')
      const isMock = provider === 'mock' || !process.env[`${provider?.toUpperCase?.()}_API_KEY`]

      if (isMock) {
        const identityPages = buildIdentityPagesFromTask(task, targetLang)
        // v4.3：identity mock 路径也要逐页触发 onPageProgress（jobId 模式下写 page-done 帧）
        if (typeof wrappedOnPageProgress === 'function') {
          for (let i = 0; i < identityPages.length; i++) {
            await wrappedOnPageProgress(identityPages[i].page, i, identityPages.length, 0)
          }
        }
        const ms = Date.now() - t0
        const sourceChars = identityPages.reduce((n, p) => n + Array.from(p.sourceText || '').length, 0)
        const sourceWords = identityPages.reduce((n, p) => n + wordCount(p.sourceText || ''), 0)
        const targetWords = identityPages.reduce((n, p) => n + wordCount(p.targetText || ''), 0)
        const fullSourceText = identityPages.map(p => p.sourceText || '').join('\n')
        const fullTargetText = identityPages.map(p => p.targetText || '').join('\n')
        const glossaryHits = Array.isArray(glossary) ? countGlossaryHits(fullSourceText, glossary) : 0
        const tmHits = (Array.isArray(tm) && tm.length > 0)
          ? lookupTm({ sourceLang, targetLang, query: fullSourceText, threshold: 0.7, limit: 200 }).length
          : 0
        docResult = {
          sourceLang, targetLang,
          segments: identityPages.map((p, i) => ({ index: i, source: p.sourceText, target: p.targetText })),
          paragraphBlocks: identityPages.map(p => p.sourceText === p.targetText
            ? { kind: 'equal', leftText: p.sourceText, rightText: p.targetText }
            : { kind: 'change', leftText: p.sourceText, rightText: p.targetText, charOps: myersDiff(p.sourceText, p.targetText) }
          ),
          pages: identityPages,
          ms,
          meta: {
            segmentsCount: identityPages.length, pagesCount: identityPages.length,
            sourceChars, targetChars: sourceChars,
            sourceWords, targetWords,
            glossaryHits, tmHits,
            mode: 'doc',
            engine: 'identity-mock-v1',
            ...(jobId ? { jobId } : {}),
          },
        }
      } else {
        // Real AI translation per page
        const translatedPages = await translatePagesAsync(task, targetLang, sourceLang, {
          onPageProgress: wrappedOnPageProgress,
        })
        const ms = Date.now() - t0
        const sourceChars = translatedPages.reduce((n, p) => n + Array.from(p.sourceText || '').length, 0)
        const targetChars = translatedPages.reduce((n, p) => n + Array.from(p.targetText || '').length, 0)
        const sourceWords = translatedPages.reduce((n, p) => n + wordCount(p.sourceText || ''), 0)
        const targetWords = translatedPages.reduce((n, p) => n + wordCount(p.targetText || ''), 0)
        const fullSourceText = translatedPages.map(p => p.sourceText || '').join('\n')
        const fullTargetText = translatedPages.map(p => p.targetText || '').join('\n')
        const glossaryHits = Array.isArray(glossary) ? countGlossaryHits(fullSourceText, glossary) : 0
        const tmHits = (Array.isArray(tm) && tm.length > 0)
          ? lookupTm({ sourceLang, targetLang, query: fullSourceText, threshold: 0.7, limit: 200 }).length
          : 0
        docResult = {
          sourceLang, targetLang,
          segments: translatedPages.map((p, i) => ({ index: i, source: p.sourceText, target: p.targetText })),
          paragraphBlocks: translatedPages.map(p => p.sourceText === p.targetText
            ? { kind: 'equal', leftText: p.sourceText, rightText: p.targetText }
            : { kind: 'change', leftText: p.sourceText, rightText: p.targetText, charOps: myersDiff(p.sourceText, p.targetText) }
          ),
          pages: translatedPages,
          ms,
          meta: {
            segmentsCount: translatedPages.length, pagesCount: translatedPages.length,
            sourceChars, targetChars,
            sourceWords, targetWords,
            glossaryHits, tmHits,
            mode: 'doc',
            engine: getActiveProvider() + '-v1',
            ...(jobId ? { jobId } : {}),
          },
        }
      }
    }

    if (docResult) {
      // jobId 模式下写 finished 帧
      if (jobId) {
        appendFrame({
          jobId,
          kind: 'finished',
          payload: {
            totalPages: docResult.pages.length,
            totalMs: docResult.ms,
            glossaryHits: docResult.meta.glossaryHits,
            tmHits: docResult.meta.tmHits,
            sourceWords: docResult.meta.sourceWords,
            targetWords: docResult.meta.targetWords,
          },
        })
        console.log(`[translate-job ${new Date().toISOString()}] job=${jobId} finished pages=${docResult.pages.length} totalMs=${docResult.ms} words=${docResult.meta.sourceWords}`)
      }
      return docResult
    }

    // ============ 文本模式（无 task.pages）============
    const paragraphs = splitParagraphs(text || '')
    // 应用术语表：before AI translation（保留一致性）
    const paragraphsForAI = Array.isArray(glossary) && glossary.length > 0
      ? paragraphs.map(p => applyGlossaryFn(p, glossary))
      : paragraphs

    // 1) 段级 AI 翻译（批量 + 异步）
    const translatedSegments = await translateSegmentsAsync(paragraphsForAI, sourceLang, targetLang)

    // 段级 glossary 应用（target 也是术语命中区）
    const finalSegments = translatedSegments.map((t, i) =>
      Array.isArray(glossary) && glossary.length > 0 ? applyGlossaryFn(t, glossary) : t
    )

    const segments = paragraphs.map((src, i) => ({
      index: i,
      source: src,
      target: finalSegments[i] || src,
    }))

    // 2) 段落块
    const paragraphBlocks = segments.map(seg => {
      if (seg.source === seg.target) return { kind: 'equal', leftText: seg.source, rightText: seg.target }
      return { kind: 'change', leftText: seg.source, rightText: seg.target, charOps: myersDiff(seg.source, seg.target) }
    })

    // 3) 按页输出
    const pages = await paginateTextAsync(text || '', { linesPerPage, pageW, pageH, targetLang, sourceLang })

    const ms = Date.now() - t0
    const fullSourceText = segments.map(s => s.source).join('\n')
    const fullTargetText = segments.map(s => s.target).join('\n')
    const glossaryHits = Array.isArray(glossary) ? countGlossaryHits(fullSourceText, glossary) : 0
    const tmHits = (Array.isArray(tm) && tm.length > 0)
      ? lookupTm({ sourceLang, targetLang, query: fullSourceText, threshold: 0.7, limit: 200 }).length
      : 0

    const textResult = {
      sourceLang, targetLang, segments, paragraphBlocks, pages, ms,
      meta: {
        segmentsCount: segments.length, pagesCount: pages.length,
        sourceChars: Array.from(text || '').length,
        targetChars: Array.from(segments.map(s => s.target).join('\n')).length,
        sourceWords: wordCount(text || ''),
        targetWords: wordCount(segments.map(s => s.target).join('\n')),
        glossaryHits, tmHits,
        mode: 'text',
        engine: getActiveProvider() + '-v1',
        ...(jobId ? { jobId } : {}),
      },
    }
    if (jobId) {
      appendFrame({
        jobId,
        kind: 'finished',
        payload: {
          totalPages: textResult.pages.length,
          totalMs: ms,
          glossaryHits,
          tmHits,
          sourceWords: textResult.meta.sourceWords,
          targetWords: textResult.meta.targetWords,
        },
      })
      console.log(`[translate-job ${new Date().toISOString()}] job=${jobId} finished pages=${textResult.pages.length} totalMs=${ms} words=${textResult.meta.sourceWords}`)
    }
    return textResult
  } catch (e) {
    if (jobId) {
      const isCancel = e instanceof CancelledError || /cancel/i.test(String(e.message || ''))
      if (isCancel) {
        appendFrame({
          jobId,
          kind: 'cancelled',
          payload: { page: e.lastPage, reason: 'user' },
        })
        console.log(`[translate-job ${new Date().toISOString()}] job=${jobId} cancelled at page=${e.lastPage} reason=user`)
      } else {
        appendFrame({
          jobId,
          kind: 'failed',
          payload: { error: e.message || String(e), page: lastAttemptedPage || null },
        })
        console.error(`[translate-job ${new Date().toISOString()}] job=${jobId} failed error=${e.message || e}`)
      }
    }
    throw e
  }
}

/**
 * 把全文按行数切成「页」（每页 linesPerPage 行），并对每页做 mock 翻译
 * 设计目标：还原「翻译狗 / 双语阅读模式」按页对照的视觉：左侧原文页 + 右侧译文页
 *
 * v3.1：每页带 charMap（字符级对应），用于 hover 联动
 *
 * @param {string} text
 * @param {{ linesPerPage: number, pageW: number, pageH: number, targetLang: string }} opts
 * @returns {Array<{ page: number, sourceText: string, targetText: string, charMap: Array, pageW: number, pageH: number, startLine: number, endLine: number }>}
 */
export function paginateText(text, { linesPerPage = 30, pageW = 794, pageH = 1123, targetLang = 'en' } = {}) {
  if (!text) return []
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // 注意：不 trim 尾部 → 末页「不足一页」也保留为 1 页
  const lines = normalized.split('\n')
  if (lines.length === 0) return []

  const pages = []
  for (let i = 0; i < lines.length; i += linesPerPage) {
    const chunk = lines.slice(i, i + linesPerPage)
    const sourceText = chunk.join('\n')
    // 末页全空 → 不计
    if (sourceText.trim().length === 0) continue
    const pageNum = pages.length + 1
    const { target, charMap } = mockTranslateWithMap(sourceText, targetLang)
    pages.push({
      page: pageNum,
      sourceText,
      targetText: target,
      charMap,
      pageW,
      pageH,
      startLine: i + 1,
      endLine: i + chunk.length
    })
  }
  return pages
}

/**
 * v4.1.1：从 task.textDir/page-NNN.html 读 v4 文字层，strip span 标签取纯文本
 *  - 用于 buildIdentityPagesFromTask 兜底提取（task.pages[i] 无 text 字段时）
 *  - 顺序拼接每个 span 的 str（与 charMap 字符位置严格对应）
 *  - v4.1.2：HTML 实体解码（&lt; &gt; &amp; &quot;），与 PDFium 提的 run.str 对齐
 *  - 缺失/异常 → 返回 ''（不抛错）
 */
function readPageTextFromTextDir(task, pageNum) {
  if (!task || !task.textDir) return ''
  const dir = task.textDir
  if (!fs.existsSync(dir)) return ''
  const pad3 = String(pageNum).padStart(3, '0')
  const file = path.join(dir, `page-${pad3}.html`)
  if (!fs.existsSync(file)) return ''
  try {
    const html = fs.readFileSync(file, 'utf-8')
    // 提取所有 <span ...>str</span> 内的 str（v4 run-level）
    const re = /<span[^>]*>([^<]*)<\/span>/g
    const parts = []
    let m
    while ((m = re.exec(html)) !== null) {
      if (m[1]) parts.push(decodeHtmlEntities(m[1]))
    }
    return parts.join('')
  } catch (e) {
    console.warn(`[translate] readPageTextFromTextDir failed for ${file}: ${e.message}`)
    return ''
  }
}

/** 解码 5 个常用 HTML 实体（与 PDFium 提的原始字符对齐） */
function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')  // &amp; 必须最后处理（避免双重解码）
}

/**
 * v4.0 identity mock：DOCX/PDF 任务跳过 paginateText，按原页结构返回
 *  - 每页 sourceText === targetText（identity）
 *  - charMap per-char：每个 src char → 对应 tgt char（hover 联动粒度 = 单字）
 *  - 等真实翻译 API 接入时，把此函数替换为 translateDocx() 即可
 *
 * v4.1.1 增强：当 task.pages[i].text 缺失时，从 task.textDir/page-NNN.html 提取
 *
 * @param {object} task - task 对象（含 ext / previewExt / pages 数组）
 * @param {string} targetLang - 目标语言（保留字段，未来真实翻译用）
 * @returns {Array<{ page: number, sourceText: string, targetText: string, charMap: Array, pageW: number, pageH: number, startLine: number, endLine: number }>}
 */
export function buildIdentityPagesFromTask(task, targetLang = 'en') {
  if (!task || !Array.isArray(task.pages)) return []
  return task.pages.map((p, i) => {
    // v4.1.1：p.text 优先，否则从 textDir 提取
    const text = p.text || readPageTextFromTextDir(task, p.page || (i + 1))
    const chars = Array.from(text)
    // per-char charMap: [{srcStart:i, srcEnd:i+1, tgtStart:i, tgtEnd:i+1}, ...]
    const charMap = chars.map((_, ci) => ({
      srcStart: ci, srcEnd: ci + 1,
      tgtStart: ci, tgtEnd: ci + 1,
    }))
    return {
      page: p.page || (i + 1),
      sourceText: text,
      targetText: text,  // identity
      charMap,
      pageW: p.width || 794,
      pageH: p.height || 1123,
      startLine: 1,
      endLine: 1,
    }
  })
}
