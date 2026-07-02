/**
 * sanitize-html —— 浏览器侧 DOM-based 兜底消毒
 *
 * 用 DOMParser 解析 HTML 字符串，按白名单遍历 + 属性过滤 + URL 协议白名单
 * 输出安全的 HTML 片段字符串。
 *
 * 与 lib/sanitize.mjs 共享 TAG_WHITELIST / ATTR_DENYLIST / sanitizeUrl。
 * 这一层兜底防止 dom-renderer / placeholder 之外的来源（如 LLM 直出）注入。
 *
 * 模型：Claude (Sonnet 4.5)
 */

import {
  TAG_WHITELIST, ATTR_DENYLIST, URL_ATTRS, sanitizeUrl,
} from './sanitize.mjs'

/**
 * @param {string} htmlString
 * @returns {string} 消毒后的 HTML 片段
 */
export function sanitizeHtmlString(htmlString) {
  if (!htmlString) return ''
  if (typeof document === 'undefined') return htmlString  // SSR/no-DOM：上层应保证已消毒
  const doc = new DOMParser().parseFromString(`<div id="root">${htmlString}</div>`, 'text/html')
  const root = doc.getElementById('root')
  walkAndClean(root)
  return root.innerHTML
}

function walkAndClean(node) {
  const children = [...node.childNodes]
  for (const child of children) {
    if (child.nodeType === 8 /* Node.COMMENT_NODE */) {
      // 丢注释（防 conditional comment IE 攻击）
      child.remove()
      continue
    }
    if (child.nodeType !== 1 /* Node.ELEMENT_NODE */) continue

    const tag = child.tagName.toLowerCase()
    if (!TAG_WHITELIST.has(tag)) {
      // script/iframe/style/svg 等整段丢；子内容是否保留？
      // 安全优先：整段丢
      console.warn(JSON.stringify({ ts: Date.now(), level: 'warn', component: 'sanitize-html', msg: 'tag denied', tag }))
      child.remove()
      continue
    }

    // 过滤属性
    for (const attr of [...child.attributes]) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || ATTR_DENYLIST.has(name)) {
        child.removeAttribute(attr.name)
        console.warn(JSON.stringify({ ts: Date.now(), level: 'warn', component: 'sanitize-html', msg: 'attr denied', tag, attr: name }))
        continue
      }
      if (URL_ATTRS.has(name)) {
        const safe = sanitizeUrl(attr.value)
        if (safe === '') {
          child.removeAttribute(attr.name)
          console.warn(JSON.stringify({ ts: Date.now(), level: 'warn', component: 'sanitize-html', msg: 'url denied', tag, attr: name, val: attr.value }))
        } else if (safe !== attr.value) {
          child.setAttribute(attr.name, safe)
        }
      }
    }

    walkAndClean(child)
  }
}
