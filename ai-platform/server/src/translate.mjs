// 翻译服务
// 模型：claude-sonnet-4-6
import { splitParagraphs, myersDiff } from './diff.mjs'
import { translateAI } from './translate-provider.mjs'

export const SUPPORTED_LANGS = new Set(['zh-CN', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'])

function mockTranslate(text, targetLang) {
  if (!text) return ''
  const tag = { 'en': 'en', 'ja': 'ja', 'ko': 'ko', 'fr': 'fr', 'de': 'de', 'es': 'es', 'ru': 'ru' }[targetLang] || targetLang
  return text.split('\n').map(line => line.length ? `[${tag}] ${line}` : '').join('\n')
}

function mockTranslateWithMap(text, targetLang) {
  if (!text) return { target: '', charMap: [] }

  // Identity: same language
  if (targetLang === 'zh-CN' || (targetLang === 'en' && /^[a-zA-Z0-9\s.,!?:;'"\-()\[\]{}&@#$%^*+=/\\|~`<>]+$/.test(text))) {
    const chars = Array.from(text)
    return { target: text, charMap: [{ srcStart: 0, srcEnd: chars.length, tgtStart: 0, tgtEnd: chars.length }] }
  }

  const chars = Array.from(text)
  const dict = {
    '你好': 'Hello', '世界': 'World', '翻译': 'translation', '测试': 'test',
    '谢谢': 'Thank you', '再见': 'Goodbye', '请': 'please',
    '。': '. ', '，': ', ', '：': ': ', '；': '; ', '！': '! ', '？': '? ',
  }
  const target = []; const charMap = []
  let i = 0, tgtPos = 0

  while (i < chars.length) {
    let matched = null
    const maxLen = Math.min(10, chars.length - i)
    for (let len = maxLen; len >= 1; len--) {
      const key = chars.slice(i, i + len).join('')
      if (dict[key]) { matched = { len, trans: dict[key] }; break }
    }
    if (matched) {
      charMap.push({ srcStart: i, srcEnd: i + matched.len, tgtStart: tgtPos, tgtEnd: tgtPos + matched.trans.length })
      target.push(matched.trans)
      tgtPos += matched.trans.length; i += matched.len
    } else {
      const ch = chars[i]; const cp = ch.codePointAt(0) || 0
      const trans = /[a-zA-Z0-9\s]/.test(ch) ? ch : String.fromCharCode(97 + (cp % 26)) + String.fromCharCode(97 + (Math.floor(cp / 26) % 26))
      charMap.push({ srcStart: i, srcEnd: i + 1, tgtStart: tgtPos, tgtEnd: tgtPos + trans.length })
      target.push(trans); tgtPos += trans.length; i += 1
    }
  }
  return { target: target.join(''), charMap }
}

async function translateSegmentsAsync(paragraphs, sourceLang, targetLang) {
  const hasAI = !!(process.env.MINIMAX_API_KEY || process.env.ZHIPU_API_KEY || process.env.VOLCANO_API_KEY)
  if (!hasAI) return paragraphs.map(src => mockTranslate(src, targetLang))
  try {
    const joined = paragraphs.join('\n---SEG---\n')
    const { target } = await translateAI({ text: joined, sourceLang, targetLang })
    return target.split('\n---SEG---\n').map(s => s.trim())
  } catch (e) {
    console.warn('[translate] AI failed, fallback mock:', e.message)
    return paragraphs.map(src => mockTranslate(src, targetLang))
  }
}

async function paginateTextAsync(text, { linesPerPage = 30, pageW = 794, pageH = 1123, targetLang = 'en', sourceLang = 'zh-CN' } = {}) {
  if (!text) return []
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (lines.length === 0) return []
  const hasAI = !!(process.env.MINIMAX_API_KEY || process.env.ZHIPU_API_KEY || process.env.VOLCANO_API_KEY)
  const pages = []

  for (let i = 0; i < lines.length; i += linesPerPage) {
    const chunk = lines.slice(i, i + linesPerPage)
    const sourceText = chunk.join('\n')
    if (sourceText.trim().length === 0) continue
    const pageNum = pages.length + 1
    let targetText, charMap
    if (hasAI) {
      try {
        const { target } = await translateAI({ text: sourceText, sourceLang, targetLang })
        targetText = target; charMap = []
      } catch {
        const r = mockTranslateWithMap(sourceText, targetLang)
        targetText = r.target; charMap = r.charMap
      }
    } else {
      const r = mockTranslateWithMap(sourceText, targetLang)
      targetText = r.target; charMap = r.charMap
    }
    pages.push({ page: pageNum, sourceText, targetText, charMap, pageW, pageH, startLine: i + 1, endLine: i + chunk.length })
  }
  return pages
}

export async function translate({ text, sourceLang, targetLang, linesPerPage = 30, pageW = 794, pageH = 1123 }) {
  const t0 = Date.now()
  if (!SUPPORTED_LANGS.has(sourceLang)) throw new Error(`unsupported sourceLang: ${sourceLang}`)
  if (!SUPPORTED_LANGS.has(targetLang)) throw new Error(`unsupported targetLang: ${targetLang}`)

  const paragraphs = splitParagraphs(text || '')
  const translatedSegments = await translateSegmentsAsync(paragraphs, sourceLang, targetLang)
  const segments = paragraphs.map((src, i) => ({ index: i, source: src, target: translatedSegments[i] || src }))

  const paragraphBlocks = segments.map(seg => {
    if (seg.source === seg.target) return { kind: 'equal', leftText: seg.source, rightText: seg.target }
    return { kind: 'change', leftText: seg.source, rightText: seg.target, charOps: myersDiff(seg.source, seg.target) }
  })

  const pages = await paginateTextAsync(text || '', { linesPerPage, pageW, pageH, targetLang, sourceLang })
  const ms = Date.now() - t0

  return {
    sourceLang, targetLang, segments, paragraphBlocks, pages, ms,
    meta: {
      segmentsCount: segments.length, pagesCount: pages.length,
      sourceChars: Array.from(text || '').length,
      targetChars: Array.from(segments.map(s => s.target).join('\n')).length,
      engine: 'mock-v1',
    }
  }
}
