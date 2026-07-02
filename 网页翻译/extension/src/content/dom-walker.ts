import type { Segment, SegmentRole, LangCode } from '../shared/types'

// ─── 配置 ──────────────────────────────────────────────────
// 完整块级 + 容器 + inline-text 元素集合
// - LEAF_BLOCK：不可再分的翻译单元（标准段落 + inline 文字承载元素）
// - 容器型（DIV/SECTION/ARTICLE/...）：若子树还含 BLOCK，继续递归拆分；
//   否则把整个容器算一段（兜底）
//
// W2 修复：原版只列标准块级，BBC 的 `<span>4 hrs ago</span>`、
// `<div class=metadata>...</div>` 等非 BLOCK 元素直接含文字时全部漏掉。
const LEAF_BLOCK_TAGS = new Set([
  // 标准段落（W2-3: 仅块级，对标沉浸式翻译）
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION', 'DT', 'DD',
  // W2-3: 移除所有 inline（A/SPAN/LABEL/EM/STRONG/B/I/SUB/SUP/Q/CITE/TIME/BDI）
  // 对标沉浸式翻译：inline 文字由父 block 通过 getCleanText 合并提取，
  // 译文插入父 block 之后，避免破坏 flex/inline 流。
])

const CONTAINER_BLOCK_TAGS = new Set([
  'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'MAIN', 'FIGURE', 'DETAILS', 'SUMMARY',
  'UL', 'OL',  // 列表容器：始终递归到 LI 子元素
])

const BLOCK_TAGS = new Set([...LEAF_BLOCK_TAGS, ...CONTAINER_BLOCK_TAGS])

// 遇到这些标签，整个子树跳过
// W2-3: IFRAME 不再跳过，由 walkElement 末尾显式递归同域 contentDocument；
// 跨域 contentDocument 访问抛 SecurityError 被 try/catch 吞掉。
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT',
  'CODE', 'PRE', 'KBD', 'SAMP', 'VAR',
  'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON',
  'SVG', 'MATH', 'CANVAS',
])

// W2-3: 首次提取遇到的 shadow root（供 content.ts attach MutationObserver）
const shadowRootsFound = new Set<ShadowRoot>()
export function consumeShadowRoots(): ShadowRoot[] {
  const arr = Array.from(shadowRootsFound)
  shadowRootsFound.clear()
  return arr
}

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

let _idCounter = 0
function nextId(): string {
  return `xt-${++_idCounter}-${Math.random().toString(36).slice(2, 6)}`
}

// ─── 主函数 ────────────────────────────────────────────────

/**
 * 提取页面中所有需要翻译的段落 Segment。
 *
 * 设计原则：
 * 1. 在"最小块级元素"层面提取（避免父子重复）
 * 2. 合并同块内所有 inline 节点为一段文本（保留翻译上下文）
 * 3. 明确跳过不应翻译的内容（代码、表单、隐藏元素）
 * 4. 若指定 tgtLang，自动跳过已经是目标语言的段（避免重复翻译 / 反向翻译）
 *
 * @param root 根元素（通常是 document.body）
 * @param options.tgtLang 目标语言，传了之后会按语言启发式过滤同语言段
 */
export function extractSegments(
  root: Element,
  options: { tgtLang?: LangCode } = {},
): Segment[] {
  const segments: Segment[] = []
  const visited = new WeakSet<Element>()

  walkElement(root, segments, visited, options.tgtLang)
  return segments
}

function walkElement(
  el: Element,
  out: Segment[],
  visited: WeakSet<Element>,
  tgtLang?: LangCode,
): void {
  if (visited.has(el)) return
  if (shouldSkip(el)) return

  // W2-3: Shadow DOM 递归（open mode；closed 的 el.shadowRoot 为 null 自动跳过）
  // 放在最前：host 元素本身也走正常块级/非块级流程，shadow 内独立遍历。
  if (el.shadowRoot) {
    shadowRootsFound.add(el.shadowRoot)
    for (const child of el.shadowRoot.children) {
      walkElement(child, out, visited, tgtLang)
    }
  }

  // W2-3: 同域 iframe 递归（跨域由 manifest all_frames 让 chrome 自动注入独立 cs）
  if (el.tagName === 'IFRAME') {
    try {
      const doc = (el as HTMLIFrameElement).contentDocument
      if (doc?.body) {
        for (const child of doc.body.children) {
          walkElement(child, out, visited, tgtLang)
        }
      }
    } catch {
      // 跨域 contentDocument 访问抛 SecurityError → 静默跳过
    }
    return
  }

  if (BLOCK_TAGS.has(el.tagName)) {
    // 叶子块级 → 直接提取
    if (LEAF_BLOCK_TAGS.has(el.tagName)) {
      const seg = tryExtract(el, tgtLang)
      if (seg) {
        out.push(seg)
        visited.add(el)
      }
      return
    }
    // 容器块级（DIV/SECTION/...）：若子树含 BLOCK 元素，继续递归；
    // 否则把容器本身算一段（兜底 metadata 类布局）
    const hasInnerBlock = el.querySelector(BLOCK_SELECTOR)
    if (hasInnerBlock) {
      for (const child of el.children) {
        walkElement(child, out, visited, tgtLang)
      }
      return
    }
    // 容器内只有 inline 文字
    // 特例：多个 A 链接作为直接子元素 → 逐个提取（导航链接独立翻译）
    const directChildren = Array.from(el.children)
    if (directChildren.length > 1 && directChildren.every(c => c.tagName === 'A')) {
      for (const child of directChildren) {
        walkElement(child, out, visited, tgtLang)
      }
      return
    }
    const seg = tryExtract(el, tgtLang)
    if (seg) {
      out.push(seg)
      visited.add(el)
    }
    return
  }

  // 非块级元素：先检查自身是否有值得翻译的文本
  // （如 <span>meta text</span> 在容器 DIV 内直接含文字但无子 block）
  const text = getCleanText(el)
  const hasChildBlock = Array.from(el.children).some(
    c => BLOCK_TAGS.has(c.tagName)
  )
  if (!hasChildBlock && isTranslatable(text, tgtLang)) {
    const seg = tryExtract(el, tgtLang)
    if (seg) {
      out.push(seg)
      visited.add(el)
      return
    }
  }

  // 否则继续向下走子节点
  for (const child of el.children) {
    walkElement(child, out, visited, tgtLang)
  }
}

// querySelector 用的小写选择器
const BLOCK_SELECTOR = Array.from(BLOCK_TAGS).map(t => t.toLowerCase()).join(',')

function shouldSkip(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true
  // 在跳过标签内部
  if (el.closest(
    'script, style, noscript, code, pre, textarea, input, select, svg, math'
  )) return true
  // W2-2: 不再跳过 display:none / visibility:hidden ——
  // 大量真实站点（alibaba 下拉菜单、tooltip、tab 隐藏面板、lazy-content）
  // 用 display:none 初始隐藏，用户 hover/click 后才显示。若跳过则用户永远
  // 看到原文。预翻译无害：用户看到时已是中文。性能影响可接受（getComputedStyle
  // 仍在，但去掉短路让 walkElement 走完）。
  return false
}

function tryExtract(el: Element, tgtLang?: LangCode): Segment | null {
  // Skip already-registered elements — rescan must not overwrite existing IDs
  // (overwriting breaks injector's segment→element mapping for already-translated segments)
  if (el.hasAttribute('data-xt-id')) return null

  const text = getCleanText(el)
  if (!isTranslatable(text, tgtLang)) return null

  const html = getCleanHtml(el)

  const id = nextId()
  el.setAttribute('data-xt-id', id)

  return {
    id,
    text,
    html: html ?? undefined,
    element: el,
    role: getRole(el),
  }
}

/** 递归获取元素的纯文本，跳过内部 code/script */
function getCleanText(el: Element): string {
  let text = ''
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element
      if (!SKIP_TAGS.has(child.tagName)) {
        text += getCleanText(child)
      }
    }
  }
  // 规范化空白：多个空格/换行 → 单空格
  return text.replace(/\s+/g, ' ').trim()
}

/** 保留 inline 标签的 HTML（给 DeepL tag_handling=html 用） */
const INLINE_TAGS = new Set(['A', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'CODE', 'SPAN',
  'SUB', 'SUP', 'MARK', 'DEL', 'INS', 'SMALL', 'TIME', 'ABBR', 'Q', 'CITE', 'BDI', 'WBR',
  'LABEL', 'DFN', 'KBD', 'SAMP', 'VAR'])

function getCleanHtml(el: Element): string | null {
  // 检测是否有 inline 标签需要保留
  const hasInlineTag = el.querySelector(Array.from(INLINE_TAGS).join(','))
  if (!hasInlineTag) return null

  const clone = el.cloneNode(true) as Element
  // 递归去除不可翻译的子孙节点
  const walk = (node: Node) => {
    const children = Array.from(node.childNodes)
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element
        if (SKIP_TAGS.has(el.tagName)) {
          el.remove()
        } else {
          walk(el)
        }
      }
    }
  }
  walk(clone)
  return clone.innerHTML.replace(/\s+/g, ' ').trim()
}

/**
 * 启发式语言检测
 * - 'zh'：段落全为 CJK（无任何拉丁字母）→ 已纯中文
 * - 'other'：含拉丁字母（CJK 与否不影响，因为混合段交给 LLM 决定）
 *
 * ⚠ 设计取舍：mixed CJK+latin 不归为 'zh'，避免品牌术语（Key / Token Plan）
 *   嵌入中文时被误判为"已翻译好"而跳过。LLM 会处理混合段。
 */
function isPureChinese(text: string): boolean {
  // 去掉空白、数字、标点、符号后，剩下的如果全是 CJK
  // 覆盖范围：CJK Radicals Supp / CJK Symbols / CJK Strokes / Enclosed CJK / CJK Compat /
  //            CJK Unified（基本 + Ext A）+ CJK Compat Ideographs / Halfwidth Forms
  const stripped = text.replace(/[\s\p{N}\p{P}\p{S}]/gu, '')
  if (stripped.length === 0) return false
  return /^[\u2E80-\u2EFF\u3000-\u303F\u31C0-\u31EF\u3200-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F]+$/.test(stripped)
}

function isPureEnglish(text: string): boolean {
  // 去掉空白、数字、标点、符号后，剩下的如果全是 latin 字母
  const stripped = text.replace(/[\s\p{N}\p{P}\p{S}]/gu, '')
  if (stripped.length === 0) return false
  return /^[A-Za-z]+$/.test(stripped)
}

/** 是否值得翻译 */
function isTranslatable(text: string, tgtLang?: LangCode): boolean {
  // 至少 1 个字符即可（导航、按钮、标签等短文本也要翻译）
  if (text.length < 1) return false
  // 纯空白跳过
  if (!text.trim()) return false
  // 纯数字/标点/空格（不含任何字母/CJK）→ 不值得翻译
  if (!/[\p{L}\p{N}\u2E80-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\uFE30-\uFE4F]/u.test(text)) return false
  // 纯数字（无任何字母或 CJK）→ 不值得翻译（"1234"、"2024" 等）
  const hasLetterOrCJK = /[\p{L}\u2E80-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\uFE30-\uFE4F]/u.test(text)
  if (!hasLetterOrCJK) return false
  // 单字符：只接受 CJK 或拉丁字母
  if (text.length === 1 && !/[\p{L}\u2E80-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/u.test(text)) return false
  // 目标语言过滤
  if (tgtLang === 'zh' && isPureChinese(text)) return false
  if (tgtLang === 'en' && isPureEnglish(text)) return false
  return true
}

function getRole(el: Element): SegmentRole {
  if (HEADING_TAGS.has(el.tagName)) return 'heading'
  if (el.tagName === 'LI') return 'list-item'
  if (el.tagName === 'TD' || el.tagName === 'TH') return 'table-cell'
  if (el.tagName === 'BLOCKQUOTE') return 'blockquote'
  if (el.tagName === 'FIGCAPTION') return 'caption'
  return 'body'
}
