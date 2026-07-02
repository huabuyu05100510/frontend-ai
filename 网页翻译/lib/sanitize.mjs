/**
 * sanitize —— 统一 HTML 输出消毒层
 *
 * 三层防御：
 *   1. tag 白名单（拒绝 script/iframe/object/...）
 *   2. attr 黑名单（拒绝 on*、style、srcset、formaction、xlink:href）
 *   3. URL 协议白名单（拒绝 javascript:/data:/vbscript:）
 *
 * 对标 dom-renderer.mjs / placeholder.mjs 两处 escapeAttr 漂移，抽到此处统一。
 *
 * 模型：Claude (Sonnet 4.5)
 */

export const TAG_WHITELIST = new Set([
  'p', 'span', 'a', 'em', 'strong', 'b', 'i', 'u', 's', 'code', 'pre', 'br',
  'ul', 'ol', 'li', 'td', 'tr', 'th', 'table', 'tbody', 'thead', 'tfoot',
  'div', 'section', 'article', 'blockquote', 'q', 'cite', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'hr',
  // 语义 inline 标签
  'abbr', 'mark', 'del', 'ins', 'kbd', 'samp', 'var', 'dfn',
  'small', 'time', 'wbr', 'figure', 'figcaption',
])

export const ATTR_DENYLIST = new Set([
  'style', 'srcset', 'formaction', 'xlink:href', 'data-src',
])

export const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'poster', 'background'])

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/**
 * URL 协议白名单：拒绝 javascript:/data:/vbscript:，放行 http/https/mailto/tel/相对路径
 * @param {string} url
 * @returns {string} 通过则返回 trim 后的 url；危险返回 ''
 */
export function sanitizeUrl(url) {
  if (url == null) return ''
  const s = String(url).trim()
  if (s === '') return ''
  // 含控制字符一律拒绝（防 java\tscript: 绕过）
  if (/[\x00-\x1f\x7f]/.test(s)) return ''
  // 相对路径、锚点、根路径 直接放行
  if (s.startsWith('/') || s.startsWith('#') || s.startsWith('?')) return s
  // protocol-relative
  if (s.startsWith('//')) return s
  // 解析 protocol
  const colonIdx = s.indexOf(':')
  if (colonIdx < 0) return s  // 无协议，按相对处理
  const proto = s.slice(0, colonIdx + 1).toLowerCase()
  // 白名单协议
  if (SAFE_URL_PROTOCOLS.has(proto)) return s
  // 拒绝 javascript:/vbscript:/data: 等
  return ''
}

/**
 * HTML 属性值转义（5 字符）：& < > " '
 */
export function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )
}

/**
 * 文本节点转义（4 字符）：& < > >
 */
export function escapeText(s) {
  return String(s).replace(/[&<>]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])
  )
}

/**
 * 过滤单个 tag 的 attrs：
 *   - 剔除 on*（onclick/onerror/onload/...）
 *   - 剔除 ATTR_DENYLIST
 *   - 对 URL_ATTRS 走 sanitizeUrl
 *   - 大小写不敏感处理 on 前缀 / style
 * @param {Record<string,string>} attrs
 * @param {{onDeny?: (k:string, v:string) => void}} [hooks] 拒绝时回调（用于日志）
 * @returns {Record<string,string>}
 */
export function sanitizeAttrs(attrs, hooks) {
  if (!attrs) return {}
  const out = {}
  for (const [k, v] of Object.entries(attrs)) {
    const lk = k.toLowerCase()
    if (lk.startsWith('on')) {
      hooks?.onDeny?.(k, v)
      continue
    }
    if (ATTR_DENYLIST.has(lk)) {
      hooks?.onDeny?.(k, v)
      continue
    }
    if (URL_ATTRS.has(lk)) {
      const safe = sanitizeUrl(v)
      if (safe === '') {
        hooks?.onDeny?.(k, v)
        continue
      }
      out[k] = safe
      continue
    }
    out[k] = v
  }
  return out
}

/**
 * 判断 tag 是否在白名单内
 */
export function isTagAllowed(tag) {
  return TAG_WHITELIST.has(String(tag).toLowerCase())
}
