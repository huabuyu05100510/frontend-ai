/**
 * aligned-translator —— 端到端 pipeline
 *
 * src HTML → encode → 调 LLM → tokenize tgt → project → renderHTML
 *
 * 浏览器侧使用，全在浏览器内完成（除了 LLM 调用走 /api/translate-aligned）
 */

import { encodeSegment } from './segment-encoder.mjs'
import { decode, extractPlaceholderIds } from './placeholder.mjs'
import { computeAlignment, projectAll } from './span-projector.mjs'
import { renderHTML } from './dom-renderer.mjs'

const OPEN = '⟦'
const CLOSE = '⟧'
const PLACEHOLDER_OPEN_RE = new RegExp(`^${OPEN}(t\\d+)${CLOSE}`)
const PLACEHOLDER_CLOSE_RE = new RegExp(`^${OPEN}/(t\\d+)${CLOSE}`)
// 单字 CJK + latin/digit 词
const TOKEN_RE = /[A-Za-z0-9]+|[\u4e00-\u9fff\u3400-\u4dbf]/uy

/**
 * 把含占位符的 tgt 文本 tokenize
 * @returns {{ tokens: string[], placeholderIdx: Map<string, {open: number, close: number}> }}
 */
export function tokenizeAlignedText(text) {
  const tokens = []
  const openPositions = new Map()  // id -> token index where placeholder opened
  const placeholderIdx = new Map() // id -> {open, close}

  let i = 0
  while (i < text.length) {
    const sub = text.slice(i)
    const openM = PLACEHOLDER_OPEN_RE.exec(sub)
    if (openM && openM.index === 0) {
      const id = openM[1]
      openPositions.set(id, tokens.length)  // 占位符本身占一个 token 槽
      tokens.push(`⟦${id}⟧`)  // 占位符作为特殊 token
      i += openM[0].length
      continue
    }
    const closeM = PLACEHOLDER_CLOSE_RE.exec(sub)
    if (closeM && closeM.index === 0) {
      const id = closeM[1]
      tokens.push(`⟦/${id}⟧`)
      if (openPositions.has(id)) {
        placeholderIdx.set(id, { open: openPositions.get(id), close: tokens.length })
      }
      i += closeM[0].length
      continue
    }
    TOKEN_RE.lastIndex = i
    const m = TOKEN_RE.exec(text)
    if (m && m.index === i) {
      tokens.push(m[0])
      i += m[0].length
      continue
    }
    i++
  }
  return { tokens, placeholderIdx }
}

/**
 * 把 tokens 中占位符（⟦t1⟧ / ⟦/t1⟧）过滤掉，只留普通词
 */
export function stripPlaceholderTokens(tokens) {
  return tokens.filter(t => !t.startsWith(OPEN))
}

/**
 * 完整 pipeline（浏览器侧）：
 * @param {string} srcHtml 原始 HTML
 * @param {string} tgtText LLM 翻译结果（含占位符）
 * @returns {{ html: string, srcTokens: string[], tgtTokens: string[], spans: any[], droppedTags: string[] }}
 */
export function translateAligned(srcHtml, tgtText) {
  // 1. 编码 src
  const seg = encodeSegment(srcHtml)

  // 2. tokenize tgt（含占位符）
  const { tokens: tgtTokensWithPh, placeholderIdx } = tokenizeAlignedText(tgtText)

  // 3. 滤掉占位符，得纯词流
  const tgtTokens = stripPlaceholderTokens(tgtTokensWithPh)

  // 4. 对齐
  const align = computeAlignment(seg.tokens, tgtTokens)

  // 5. 检查 LLM 保留下来的 placeholder，找出对应 src tag
  const survivingIds = new Set(placeholderIdx.keys())
  const droppedTags = []
  const survivingTags = []
  for (const t of seg.tagSpans) {
    if (survivingIds.has(t.id)) {
      survivingTags.push(t)
    } else {
      droppedTags.push(t.id)
    }
  }

  // 6. 对每个幸存的 tag，把它的 src token 区间投影到 tgt token 区间
  //    注意 tgtTokens 已经是纯词流，所以 spans 直接基于 tgtTokens 索引
  //    placeholderIdx[t.id].open / .close 是占位符（含 ph）的 token 索引
  //    折算到纯词流：
  const projectedSpans = []
  for (const t of survivingTags) {
    const ph = placeholderIdx.get(t.id)
    if (!ph) continue
    // ph.open 是占位符 token 索引，对应 tgt 中 "⟦t1⟧" 的位置
    // 在纯词流中，⟦t1⟧ 的位置 = 它前面有几个非占位符 token
    const openInTgt = countNonPlaceholderTokensBefore(tgtTokensWithPh, ph.open)
    const closeInTgt = countNonPlaceholderTokensBefore(tgtTokensWithPh, ph.close)
    projectedSpans.push({
      tagId: t.id,
      open: openInTgt,
      close: closeInTgt,
      srcOpen: t.openToken,
      srcClose: t.closeToken,
    })
  }

  // 7. 渲染 HTML（不含 src 也不需 spans-projector，因为我们已知 tgt 位置）
  const html = renderHTML({
    tokens: tgtTokens,
    originalTags: survivingTags,
    projectedSpans,
    wrapper: 'p',
  })

  return {
    html,
    srcTokens: seg.tokens,
    tgtTokens,
    spans: projectedSpans,
    droppedTags,
  }
}

function countNonPlaceholderTokensBefore(tokensWithPh, idx) {
  let count = 0
  for (let i = 0; i < idx; i++) {
    if (!tokensWithPh[i].startsWith(OPEN)) count++
  }
  return count
}

/**
 * 浏览器侧：调 /api/translate-aligned
 * 服务端会用占位符保留 prompt 调 LLM
 */
export async function callAlignedApi(srcHtml, tgtLang) {
  const r = await fetch('/api/translate-aligned', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ srcHtml, tgtLang }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${r.status}`)
  }
  return (await r.json()).tgtText
}