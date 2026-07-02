/**
 * dom-renderer —— projected span + tokens → HTML
 *
 * Node 侧输出字符串；浏览器侧 renderToFragment 挂 Shadow DOM
 *
 * 对标 tech-plan §3 dom-renderer.ts
 */

import {
  escapeAttr, sanitizeAttrs, isTagAllowed,
} from './sanitize.mjs'

const log = (msg, fields) => {
  try { console.log(JSON.stringify({ ts: Date.now(), level: 'warn', component: 'dom-renderer', msg, ...fields })) } catch {}
}

/**
 * @param {object} args
 * @param {string[]} args.tokens  目标语言 token 流
 * @param {Array<{id, type, attrs}>} args.originalTags  原始 src tag 元信息（带 attrs）
 * @param {Array<{tagId, open, close, score}>} args.projectedSpans  span-projector 输出
 * @param {string} [args.wrapper='p']  外层标签
 * @returns {string}
 */
export function renderHTML({ tokens, originalTags, projectedSpans, wrapper = 'p' }) {
  const tagById = new Map(originalTags.map(t => [t.id, t]))

  // 收集每位置的 open/close 事件
  // openAt[k] = tags 应在 token[k] 之前开
  // closeAt[k] = tags 应在 token[k] 之后关（k = span.close）
  const openAt = new Map()
  const closeAt = new Map()
  for (const span of projectedSpans) {
    if (span.close <= span.open) continue  // 空 span 不渲染
    const tag = tagById.get(span.tagId)
    if (!tag) continue
    // tag 白名单兜底：非法 tag 整段丢
    if (!isTagAllowed(tag.type)) {
      log('tag denied', { tag: tag.type, tagId: tag.id })
      continue
    }
    if (!openAt.has(span.open)) openAt.set(span.open, [])
    if (!closeAt.has(span.close)) closeAt.set(span.close, [])
    openAt.get(span.open).push(tag)
    closeAt.get(span.close).push(tag)
  }

  let html = `<${wrapper}>`
  for (let i = 0; i < tokens.length; i++) {
    if (i > 0 && needsSpace(tokens[i - 1], tokens[i])) html += ' '
    if (openAt.has(i)) {
      for (const tag of openAt.get(i)) {
        const safeAttrs = sanitizeAttrs(tag.attrs, {
          onDeny: (k) => log('attr denied', { tag: tag.type, attr: k }),
        })
        const attrStr = Object.entries(safeAttrs)
          .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
          .join('')
        html += `<${tag.type}${attrStr}>`
      }
    }
    html += tokens[i]
    if (closeAt.has(i + 1)) {
      // 嵌套时内层先关：closeAt 列表顺序 = open 顺序，所以逆序
      for (let k = closeAt.get(i + 1).length - 1; k >= 0; k--) {
        html += `</${closeAt.get(i + 1)[k].type}>`
      }
    }
  }
  html += `</${wrapper}>`
  return html
}

/**
 * 浏览器侧：把 HTML 字符串塞到 Shadow DOM 隔离容器
 * @param {string} htmlString
 * @param {Element} mountPoint 宿主元素
 * @returns {ShadowRoot}
 */
export function renderToFragment(htmlString, mountPoint) {
  if (typeof document === 'undefined') {
    throw new Error('renderToFragment 需要浏览器环境')
  }
  const shadow = mountPoint.attachShadow({ mode: 'open' })
  shadow.innerHTML = htmlString
  return shadow
}

function needsSpace(prev, cur) {
  if (!prev || !cur) return false
  const cjkRe = /[\u4e00-\u9fff\u3400-\u4dbf]/
  const isCJKPrev = cjkRe.test(prev.slice(-1))
  const isCJKCur = cjkRe.test(cur[0])
  // CJK ↔ CJK：紧贴
  if (isCJKPrev && isCJKCur) return false
  // 其他都加空格（CJK↔Latin、Latin↔Latin、CJK↔digit 等）
  return true
}