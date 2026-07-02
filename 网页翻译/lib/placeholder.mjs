/**
 * 占位符 codec — 对标 tech-plan §2.3
 *
 * Schema:
 *   ⟦t1:em⟧ 词  ⟦/t1⟧
 *
 * 用 ⟦⟧（U+27E6 / U+27E7）避免 LLM 把它当 HTML 解析/翻译
 *
 * 设计要点：
 * - encode 输入字符串（HTML 片段），输出 text + tags 元信息
 * - tags 元信息持有 attrs（href 等），不进占位符文本，LLM 看不到就不会乱翻
 * - decode 用 tags 元信息把占位符还原成 HTML 标签
 * - 属性值统一 HTML escape，防止 XSS
 */

import { escapeAttr, sanitizeAttrs, isTagAllowed } from './sanitize.mjs'

const log = (msg, fields) => {
  try { console.log(JSON.stringify({ ts: Date.now(), level: 'warn', component: 'placeholder', msg, ...fields })) } catch {}
}

const OPEN = '⟦'
const CLOSE = '⟧'

// 不会嵌套文字内容的标签（void elements）
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link'])

// ─── encode ─────────────────────────────────────────────
/**
 * @param {string} html HTML 片段
 * @returns {{ text: string, tags: Array<{id: string, type: string, attrs: Record<string,string>}> }}
 */
export function encode(html) {
  if (!html) return { text: '', tags: [] }

  let idCounter = 0
  const tags = []
  let result = ''
  /** @type {Array<{idNum: number, name: string}>} */
  const stack = []
  let i = 0

  while (i < html.length) {
    const ch = html[i]

    if (ch !== '<') {
      result += ch
      i++
      continue
    }

    const closeIdx = html.indexOf('>', i)
    if (closeIdx === -1) {
      // 没有 '>' 闭合的 '<' 当文本
      result += html.slice(i)
      break
    }

    const raw = html.slice(i + 1, closeIdx).trim()

    // 闭合标签 </tag>
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim().toLowerCase().split(/\s+/)[0]
      // 从栈顶往下找匹配的（处理嵌套错误）
      let matchIdx = -1
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === name) { matchIdx = k; break }
      }
      if (matchIdx >= 0) {
        // 关闭栈上方的（修复嵌套错误：自动补闭合）
        while (stack.length - 1 > matchIdx) {
          const top = stack.pop()
          result += `${OPEN}/t${top.idNum}${CLOSE}`
        }
        const matched = stack.pop()
        result += `${OPEN}/t${matched.idNum}${CLOSE}`
      } else {
        // 没有匹配开标签的 '<' 当文本输出
        result += html.slice(i, closeIdx + 1)
      }
      i = closeIdx + 1
      continue
    }

    // 自闭合 <tag/>
    const isSelfClose = raw.endsWith('/')
    const cleanStr = (isSelfClose ? raw.slice(0, -1) : raw).trim()
    const m = /^([\w-]+)([\s\S]*)$/.exec(cleanStr)
    if (!m) {
      result += html.slice(i, closeIdx + 1)
      i = closeIdx + 1
      continue
    }

    const name = m[1].toLowerCase()
    const attrStr = m[2].trim()
    const attrs = parseAttrs(attrStr)
    const idNum = ++idCounter
    const id = `t${idNum}`
    tags.push({ id, type: name, attrs })
    result += `${OPEN}${id}${CLOSE}`

    if (!isSelfClose && !VOID_TAGS.has(name)) {
      stack.push({ idNum, name })
    } else {
      result += `${OPEN}/${id}${CLOSE}`
    }
    i = closeIdx + 1
  }

  // 未闭合的标签 → 自动补
  while (stack.length) {
    const top = stack.pop()
    result += `${OPEN}/t${top.idNum}${CLOSE}`
  }

  return { text: result, tags }
}

// ─── decode ─────────────────────────────────────────────
/**
 * @param {string} text 含占位符的文本
 * @param {Array<{id: string, type: string, attrs: Record<string,string>}>} tags
 * @returns {string} 还原后的 HTML
 */
export function decode(text, tags) {
  if (!text) return ''
  const tagById = new Map(tags.map(t => [t.id, t]))
  let result = ''
  let i = 0

  while (i < text.length) {
    // 开放占位符 ⟦t1⟧
    const openMatch = new RegExp(`^${OPEN}(t\\d+)${CLOSE}`).exec(text.slice(i))
    if (openMatch) {
      const [, id] = openMatch
      const tag = tagById.get(id)
      if (tag) {
        // tag 白名单兜底
        if (!isTagAllowed(tag.type)) {
          log('tag denied', { tag: tag.type, id })
          i += openMatch[0].length
          continue
        }
        const safeAttrs = sanitizeAttrs(tag.attrs, {
          onDeny: (k) => log('attr denied', { tag: tag.type, attr: k }),
        })
        const attrStr = Object.entries(safeAttrs)
          .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
          .join('')
        result += `<${tag.type}${attrStr}>`
      }
      // 未知 id 直接跳过占位符
      i += openMatch[0].length
      continue
    }
    // 闭合占位符 ⟦/t1⟧
    const closeMatch = new RegExp(`^${OPEN}/(t\\d+)${CLOSE}`).exec(text.slice(i))
    if (closeMatch) {
      const [, id] = closeMatch
      const tag = tagById.get(id)
      if (tag) result += `</${tag.type}>`
      i += closeMatch[0].length
      continue
    }
    result += text[i]
    i++
  }

  return result
}

// ─── extractPlaceholderIds ──────────────────────────────
/**
 * 从文本中提取所有占位符 id（开闭各算一次，返回 set）
 * @param {string} text
 * @returns {string[]}
 */
export function extractPlaceholderIds(text) {
  if (!text) return []
  const ids = new Set()
  const re = new RegExp(`${OPEN}(t\\d+)${CLOSE}`, 'g')
  let m
  while ((m = re.exec(text)) !== null) ids.add(m[1])
  return [...ids]
}

// ─── helpers ────────────────────────────────────────────
function parseAttrs(str) {
  const attrs = {}
  if (!str) return attrs
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g
  let m
  while ((m = re.exec(str)) !== null) attrs[m[1]] = m[2]
  // 也支持单引号
  const reSingle = /([\w:-]+)\s*=\s*'([^']*)'/g
  while ((m = reSingle.exec(str)) !== null) {
    if (!(m[1] in attrs)) attrs[m[1]] = m[2]
  }
  return attrs
}