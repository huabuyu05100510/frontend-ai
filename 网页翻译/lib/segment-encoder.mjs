/**
 * segment-encoder —— DOM/HTML → AlignedSegment
 *
 * 对标 tech-plan §3 segment-encoder.ts
 *
 * 输入：HTML 片段或完整 HTML 文档
 * 输出：AlignedSegment[]，每个包含
 *   - sourceText: 含占位符的原文（不含属性）
 *   - tokens: 分词（unicode-aware，支持中日韩）
 *   - tags: 标签元信息（含 attrs）
 *   - tagSpans: tags 的额外字段 — 在 token 流中的开闭位置
 */

import { encode as placeholderEncode } from './placeholder.mjs'

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION', 'DT', 'DD'])
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SVG', 'MATH', 'CANVAS'])

const OPEN = '⟦'
const CLOSE = '⟧'
// 拉丁/数字词（不包含 CJK）+ 单个 CJK 字
// ⚠️ 粗粒度：CJK 单字 token，翻译质量一般；生产可换 jieba
const TOKEN_RE = /[A-Za-z0-9]+|[\u4e00-\u9fff\u3400-\u4dbf]/uy

/**
 * 把 HTML 片段编码为 AlignedSegment
 * @param {string} html
 */
export function encodeSegment(html) {
  const { text, tags } = placeholderEncode(html)

  // Tokenize (CJK + latin + digits)
  const tokens = []
  const tokenToTags = []  // 每 token 当前打开的 tag id 列表
  const openStack = []

  let i = 0
  while (i < text.length) {
    // opening placeholder
    const openMatch = new RegExp(`^${OPEN}(t\\d+)${CLOSE}`).exec(text.slice(i))
    if (openMatch) {
      openStack.push(openMatch[1])
      i += openMatch[0].length
      continue
    }
    // closing placeholder
    const closeMatch = new RegExp(`^${OPEN}/(t\\d+)${CLOSE}`).exec(text.slice(i))
    if (closeMatch) {
      const idx = openStack.indexOf(closeMatch[1])
      if (idx >= 0) openStack.splice(idx, 1)
      i += closeMatch[0].length
      continue
    }
    // token
    TOKEN_RE.lastIndex = i
    const m = TOKEN_RE.exec(text)
    if (m && m.index === i) {
      tokens.push(m[0])
      tokenToTags.push([...openStack])
      i += m[0].length
      continue
    }
    // skip single char
    i++
  }

  // 计算每个 tag 的 token 区间
  const tagSpans = tags.map(t => {
    const contained = []
    for (let k = 0; k < tokenToTags.length; k++) {
      if (tokenToTags[k].includes(t.id)) contained.push(k)
    }
    return {
      ...t,
      openToken: contained[0] ?? 0,
      closeToken: contained.length === 0 ? 0 : contained[contained.length - 1] + 1,
    }
  })

  return {
    sourceText: text,
    tokens,
    tags,
    tagSpans,
  }
}

/**
 * 从 HTML 文档提取所有段
 * @param {string} htmlString
 * @returns {AlignedSegment[]}
 */
export function extractSegmentsFromHTML(htmlString) {
  // 浏览器有 DOMParser；Node 端用极简 block-level 提取
  const blocks = []
  const blockRe = /<(p|h[1-6]|li|td|th|blockquote|figcaption|dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let m
  while ((m = blockRe.exec(htmlString)) !== null) {
    const tag = m[1].toUpperCase()
    if (SKIP_TAGS.has(tag)) continue
    // 去除 script/style/code 等不可翻译标签，inline 标签（a/em/strong/...）保留
    const inner = stripUntranslatableTags(m[2])
    if (inner.replace(/\s+/g, ' ').trim().length >= 4) {
      blocks.push(inner)
    }
  }
  return blocks.map(html => encodeSegment(html))
}

/**
 * 仅去除不应翻译的标签（script/style/code/pre/...），inline 标签（a/em/strong）保留
 * 给 encodeSegment 用，让 placeholder codec 接管 inline 编码
 */
function stripUntranslatableTags(html) {
  // 整块去除 script/style/noscript
  let result = html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(script|style|noscript)\b[^>]*\/?>/gi, ' ')
    // 不可翻译的内联标签：code/pre/kbd/samp/var → 替为空格但保留 innerText
    .replace(/<\/?(code|pre|kbd|samp|var|textarea|input|select|button|svg|math|canvas|iframe|object|embed)\b[^>]*>/gi, ' ')
  return result.trim()
}