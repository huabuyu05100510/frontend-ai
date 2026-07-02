import type { TranslationMode, AlignmentResult } from '../shared/types'

const TGT_ATTR = 'data-xt-tgt'
const SRC_ATTR = 'data-xt-id'
const ORIG_ATTR = 'data-xt-original'
const TOK_ATTR = 'data-xt-tok'
const TOK_SEG_ATTR = 'data-xt-seg'
const TOK_IDX_ATTR = 'data-xt-idx'
const SRC_TEXT_CLASS = 'xt-src-text'
const FLEX_SAVE_ATTR = 'data-xt-saved-display'

/**
 * 双语注入器 v4 — 左原文右译文并排布局
 *
 * 核心设计：
 * - 原文元素 display 改为 flex，内部左列原文 + 右列译文 + 标注
 * - LI / TD / TH 内部 flex 同样处理，不破坏 UL/TR 外层结构
 * - 不修改任何父容器的 flex-wrap / grid / display 属性
 * - restore 时还原 display + 原文内容
 * - 标注 UI 挂在译文列右侧，自然右对齐
 *
 * 模型：Claude (Sonnet 4.6)
 */

// ─── sidebar host ──────────────────────────────────────────
const SIDEBAR_HOST_ID = 'xt-sidebar-host'
export const SIDEBAR_WIDTH = 420

export function ensureSidebarHost(): HTMLElement {
  let host = document.getElementById(SIDEBAR_HOST_ID)
  if (host) return host
  host = document.createElement('div')
  host.id = SIDEBAR_HOST_ID
  host.className = 'xt-sidebar-host'
  host.innerHTML = `
    <div class="xt-sidebar-aside">
      <div class="xt-sidebar-header">
        <span class="xt-sidebar-title">译文</span>
        <button class="xt-sidebar-close" title="关闭" aria-label="关闭">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <div class="xt-sidebar-list">
        <div class="xt-sidebar-empty">等待翻译…</div>
      </div>
      <div class="xt-sidebar-footer">
        <span class="xt-sidebar-mode" title="点击切换显示模式">译</span>
      </div>
    </div>
    <div class="xt-sidebar-tip" hidden>
      <span class="xt-sidebar-tip-arrow"></span>
      <span class="xt-sidebar-tip-text">点击「译」切换原文/双语/仅译文</span>
    </div>
  `
  document.documentElement.appendChild(host)
  host.querySelector('.xt-sidebar-close')!.addEventListener('click', () => {
    host!.style.display = 'none'
  })
  const modeCycle = ['sidebar', 'bilingual', 'translation-only'] as const
  host.querySelector('.xt-sidebar-mode')!.addEventListener('click', () => {
    const cur = (host.dataset.mode || 'sidebar') as typeof modeCycle[number]
    const next = modeCycle[(modeCycle.indexOf(cur) + 1) % modeCycle.length]
    host.dataset.mode = next
    chrome.runtime.sendMessage({ type: 'SET_MODE', mode: next }).catch(() => {})
    const tip = host.querySelector<HTMLElement>('.xt-sidebar-tip')
    if (tip) {
      const label = next === 'sidebar' ? '侧栏' : next === 'bilingual' ? '双语对照' : '仅译文'
      tip.querySelector('.xt-sidebar-tip-text')!.textContent = `已切换：${label}`
      tip.hidden = false
      setTimeout(() => { tip.hidden = true }, 1800)
    }
  })
  const cur = parseInt(getComputedStyle(document.body).paddingRight || '0', 10)
  document.body.style.paddingRight = `${cur + SIDEBAR_WIDTH}px`
  return host
}

export function removeSidebarHost(): void {
  const host = document.getElementById(SIDEBAR_HOST_ID)
  if (host) host.remove()
  const cur = parseInt(getComputedStyle(document.body).paddingRight || '0', 10)
  const next = Math.max(0, cur - SIDEBAR_WIDTH)
  document.body.style.paddingRight = next === 0 ? '' : `${next}px`
}

function getOrCreateSidebarItem(segmentId: string, srcText: string): HTMLElement {
  const host = ensureSidebarHost()
  const list = host.querySelector<HTMLElement>('.xt-sidebar-list')!
  const empty = list.querySelector('.xt-sidebar-empty')
  if (empty) empty.remove()
  let item = list.querySelector<HTMLElement>(`[data-xt-tgt="${segmentId}"]`)
  if (!item) {
    item = document.createElement('div')
    item.className = 'xt-sidebar-item'
    item.setAttribute(TGT_ATTR, segmentId)
    item.innerHTML = `<div class="xt-sidebar-src"></div><div class="xt-sidebar-tgt"></div>`
    list.appendChild(item)
  }
  const srcEl = item.querySelector<HTMLElement>('.xt-sidebar-src')!
  if (srcEl.textContent !== srcText) srcEl.textContent = srcText
  return item
}

// ─── deep querySelector ─────────────────────────────────────
function deepQuerySelector(selector: string): Element | null {
  return deepQuerySelectorAll(selector)[0] ?? null
}

function deepQuerySelectorAll(selector: string): Element[] {
  const out: Element[] = []
  const stack: ParentNode[] = [document]
  const visited = new WeakSet<ParentNode>()
  while (stack.length > 0) {
    const root = stack.pop()!
    if (visited.has(root)) continue
    visited.add(root)
    root.querySelectorAll(selector).forEach(el => out.push(el))
    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) stack.push(el.shadowRoot)
      if (el.tagName === 'IFRAME') {
        try {
          const doc = (el as HTMLIFrameElement).contentDocument
          if (doc?.body) stack.push(doc)
        } catch { /* cross-origin */ }
      }
    })
  }
  return out
}

const log = (level: 'info' | 'warn', msg: string, fields: Record<string, unknown> = {}) => {
  try {
    console[level](JSON.stringify({ ts: Date.now(), level, component: 'xt:injector', msg, ...fields }))
  } catch {}
}

export function computeTgtClassName(_srcEl: Element, translation: string, tgtLang?: string): string | null {
  if (!translation || !translation.trim()) return null
  const cls = ['xt-translation']
  if (ancestorUsesGrid(_srcEl)) cls.push('xt-grid-translation')
  if (isRtlLang(tgtLang)) cls.push('xt-rtl')
  return cls.join(' ')
}

export function isRtlLang(code: string | undefined | null): boolean {
  if (!code) return false
  const c = code.toLowerCase()
  return c === 'ar' || c === 'he' || c === 'fa' || c === 'ur'
}

function ancestorUsesGrid(el: Element | null): boolean {
  let cur: Element | null = el?.parentElement ?? null
  while (cur && cur !== document.documentElement) {
    const display = (cur as HTMLElement).style?.display || getComputedStyle(cur).display
    if (display === 'grid' || display === 'inline-grid') return true
    cur = cur.parentElement
  }
  return false
}

// ─── TranslationInjector ────────────────────────────────────

export class TranslationInjector {
  private injected = new Map<string, Element>()
  private translationCache = new Map<string, string>()

  inject(segmentId: string, translation: string, mode: TranslationMode, tgtLang?: string): void {
    this.translationCache.set(segmentId, translation)
    if (!translation || !translation.trim()) {
      log('warn', 'skip empty translation', { segmentId, len: translation?.length ?? 0 })
      return
    }
    const srcEl = deepQuerySelector(`[${SRC_ATTR}="${segmentId}"]`)
    if (!srcEl) {
      log('warn', 'segment source not found', { segmentId })
      return
    }
    if (mode === 'bilingual') {
      this.injectBilingual(segmentId, srcEl, translation, tgtLang)
    } else if (mode === 'sidebar') {
      this.injectSidebar(segmentId, srcEl, translation)
    } else {
      this.injectOverride(segmentId, srcEl, translation)
    }
  }

  setMode(mode: TranslationMode, tgtLang?: string): void {
    this.clearTranslations()
    this.injected.clear()
    let count = 0
    for (const [segId, translation] of this.translationCache) {
      const srcEl = deepQuerySelector(`[${SRC_ATTR}="${segId}"]`)
      if (!srcEl) continue
      if (mode === 'bilingual') this.injectBilingual(segId, srcEl, translation, tgtLang)
      else if (mode === 'sidebar') this.injectSidebar(segId, srcEl, translation)
      else this.injectOverride(segId, srcEl, translation)
      count++
    }
    log('info', 'setMode re-injected', { count, mode })
  }

  private clearTranslations(): void {
    // A. 还原 flex-row 模式（有 FLEX_SAVE_ATTR）
    deepQuerySelectorAll(`[${FLEX_SAVE_ATTR}]`).forEach(el => {
      const htEl = el as HTMLElement
      // 把左列(.xt-src-text)的 childNodes 移回 el
      const srcCol = el.querySelector(`.${SRC_TEXT_CLASS}`)
      if (srcCol) {
        while (srcCol.firstChild) {
          el.appendChild(srcCol.firstChild)
        }
        srcCol.remove()
      }
      // 移除右列(.xt-tgt-col)
      el.querySelectorAll('.xt-tgt-col').forEach(c => c.remove())
      // 移除 token span 包装
      el.querySelectorAll(`[${TOK_ATTR}]`).forEach(span => {
        const parent = span.parentNode
        if (!parent) return
        parent.replaceChild(document.createTextNode(span.textContent ?? ''), span)
      })
      el.removeAttribute('data-xt-aligned')
      // 还原 display
      const saved = htEl.getAttribute(FLEX_SAVE_ATTR)
      htEl.style.display = (saved === 'inline' || saved === 'initial') ? '' : ''
      htEl.removeAttribute(FLEX_SAVE_ATTR)
    })

    // B. 还原 inside-block 模式（TD/TH/LI：有 xt-src-has-translation 但无 FLEX_SAVE_ATTR）
    deepQuerySelectorAll(`.xt-src-has-translation:not([${FLEX_SAVE_ATTR}])`).forEach(el => {
      el.querySelectorAll('.xt-tgt-col').forEach(c => c.remove())
      el.querySelectorAll(`[${TOK_ATTR}]`).forEach(span => {
        const parent = span.parentNode
        if (!parent) return
        parent.replaceChild(document.createTextNode(span.textContent ?? ''), span)
      })
      el.removeAttribute('data-xt-aligned')
      el.classList.remove('xt-src-has-translation')
    })

    // 还原 translation-only 的原文
    deepQuerySelectorAll(`[${ORIG_ATTR}]`).forEach(el => {
      el.textContent = el.getAttribute(ORIG_ATTR)!
      el.removeAttribute(ORIG_ATTR)
    })

    // 清除侧栏 item（sidebar 模式）
    deepQuerySelectorAll(`.xt-sidebar-item[${TGT_ATTR}]`).forEach(el => el.remove())

    // 清除没被 FLEX_SAVE_ATTR 覆盖的残留译文
    deepQuerySelectorAll(`[${TGT_ATTR}]:not(.xt-sidebar-item)`).forEach(el => {
      const parent = el.parentElement
      // 如果父元素不归我们管（非 srcEl flex），直接 remove
      if (!parent?.hasAttribute(FLEX_SAVE_ATTR) && !parent?.hasAttribute(SRC_ATTR)) {
        el.remove()
      }
    })
  }

  append(segmentId: string, delta: string): void {
    const tgtEl = this.injected.get(segmentId)
    if (!tgtEl) return
    const tgtTextEl = tgtEl.querySelector<HTMLElement>('.xt-sidebar-tgt')
    if (tgtTextEl) {
      tgtTextEl.textContent = (tgtTextEl.textContent ?? '') + delta
    } else {
      tgtEl.textContent = (tgtEl.textContent ?? '') + delta
    }
  }

  restore(): void {
    this.clearTranslations()
    deepQuerySelectorAll(`[${SRC_ATTR}]`).forEach(el => el.removeAttribute(SRC_ATTR))
    this.unwrapTokens()
    removeSidebarHost()
    this.injected.clear()
    this.translationCache.clear()
  }

  // ─── 词级对齐 ───────────────────────────────────────

  applyAlignment(segmentId: string, alignment: AlignmentResult): void {
    const srcEl = deepQuerySelector(`[${SRC_ATTR}="${segmentId}"]`) as HTMLElement | null
    if (!srcEl) {
      log('warn', 'applyAlignment: src el missing', { segmentId })
      return
    }
    // bilingual 模式：tgt 在 srcEl 内部的 [data-xt-tgt] 中
    const tgtEl = srcEl.querySelector<HTMLElement>(`[${TGT_ATTR}="${segmentId}"]`)
      ?? this.injected.get(segmentId) as HTMLElement | null

    if (!tgtEl) {
      log('warn', 'applyAlignment: tgt el missing', { segmentId })
      return
    }

    // 原文 token 只包裹 src-text span
    const srcWrap = srcEl.querySelector<HTMLElement>(`.${SRC_TEXT_CLASS}`) ?? srcEl
    if (!srcWrap.hasAttribute('data-xt-aligned') && !srcEl.hasAttribute(ORIG_ATTR)) {
      wrapTokens(srcWrap, alignment.srcTokens, 'src', segmentId)
      srcWrap.setAttribute('data-xt-aligned', '1')
    }

    if (!tgtEl.hasAttribute('data-xt-aligned')) {
      wrapTokens(tgtEl, alignment.tgtTokens, 'tgt', segmentId)
      tgtEl.setAttribute('data-xt-aligned', '1')
    }
  }

  unwrapTokens(): void {
    deepQuerySelectorAll(`[${TOK_ATTR}]`).forEach(span => {
      const parent = span.parentNode
      if (!parent) return
      parent.replaceChild(document.createTextNode(span.textContent ?? ''), span)
    })
    deepQuerySelectorAll(`[data-xt-aligned]`).forEach(el => {
      el.normalize?.()
      el.removeAttribute('data-xt-aligned')
    })
  }

  // ─── v4: 左原文右译文并排布局 ────────────────────────
  // 策略：
  //   - TD/TH/LI：display 不可改（table-cell/list-item），译文作为 block 子元素注入内部
  //   - 其他块级：srcEl → display:flex，左列移动现有 childNodes（保留所有子元素），右列译文+标注
  //   - 标注 UI 在译文列右侧自然右对齐

  /** TD/TH/LI 等不可改 display 的元素 */
  private static readonly PRESERVE_DISPLAY_TAGS = new Set(['TD', 'TH', 'LI'])

  private injectBilingual(
    segmentId: string,
    srcEl: Element,
    translation: string,
    tgtLang?: string,
  ): void {
    // 防重复：只更新译文文本
    const existingTgt = srcEl.querySelector<HTMLElement>(`[${TGT_ATTR}="${segmentId}"]`)
    if (existingTgt) {
      existingTgt.textContent = translation
      this.injected.set(segmentId, existingTgt)
      return
    }

    const htSrcEl = srcEl as HTMLElement

    // 保存原始 display 以便 restore
    if (!htSrcEl.hasAttribute(FLEX_SAVE_ATTR)) {
      htSrcEl.setAttribute(FLEX_SAVE_ATTR, getComputedStyle(htSrcEl).display)
    }

    if (TranslationInjector.PRESERVE_DISPLAY_TAGS.has(htSrcEl.tagName)) {
      this.injectInsideBlock(segmentId, htSrcEl, translation, tgtLang)
      return
    }

    this.injectFlexRow(segmentId, htSrcEl, translation, tgtLang)
  }

  /** TD/TH/LI：译文作为 block 子元素注入内部，不改变元素自身 display */
  private injectInsideBlock(
    segmentId: string,
    htSrcEl: HTMLElement,
    translation: string,
    tgtLang?: string,
  ): void {
    const tgtEl = document.createElement('span')
    tgtEl.setAttribute(TGT_ATTR, segmentId)
    tgtEl.textContent = translation
    const clsName = computeTgtClassName(htSrcEl, translation, tgtLang)
    if (clsName) tgtEl.className = clsName

    const annoHost = document.createElement('span')
    annoHost.className = 'xt-anno-host'
    annoHost.setAttribute('data-xt-anno-host', segmentId)
    annoHost.style.cssText = 'display:flex;gap:4px;align-items:center'

    const wrapper = document.createElement('span')
    wrapper.className = 'xt-tgt-col'
    wrapper.style.cssText = 'display:block;margin-top:4px'
    wrapper.appendChild(tgtEl)
    wrapper.appendChild(annoHost)

    htSrcEl.appendChild(wrapper)
    htSrcEl.classList.add('xt-src-has-translation')

    this.injected.set(segmentId, tgtEl)
  }

  /** 安全块级元素：srcEl → display:flex，左原文右译文并排 */
  private injectFlexRow(
    segmentId: string,
    htSrcEl: HTMLElement,
    translation: string,
    tgtLang?: string,
  ): void {
    // 左列：移动所有现有子节点（保留 <a>/<em>/<strong> 等）
    const srcCol = document.createElement('span')
    srcCol.className = SRC_TEXT_CLASS
    srcCol.style.cssText = 'flex:1;min-width:0'
    while (htSrcEl.firstChild) {
      srcCol.appendChild(htSrcEl.firstChild)
    }

    // 右列：译文 + 标注占位
    const tgtCol = document.createElement('span')
    tgtCol.className = 'xt-tgt-col'
    tgtCol.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-end;gap:2px'

    const tgtEl = document.createElement('span')
    tgtEl.setAttribute(TGT_ATTR, segmentId)
    tgtEl.textContent = translation
    const clsName = computeTgtClassName(htSrcEl, translation, tgtLang)
    if (clsName) tgtEl.className = clsName
    tgtCol.appendChild(tgtEl)

    const annoHost = document.createElement('span')
    annoHost.className = 'xt-anno-host'
    annoHost.setAttribute('data-xt-anno-host', segmentId)
    annoHost.style.cssText = 'display:flex;gap:4px;align-items:center'
    tgtCol.appendChild(annoHost)

    htSrcEl.style.display = 'flex'
    htSrcEl.style.alignItems = 'flex-start'
    htSrcEl.style.gap = '16px'
    htSrcEl.classList.add('xt-src-has-translation')

    htSrcEl.appendChild(srcCol)
    htSrcEl.appendChild(tgtCol)

    this.injected.set(segmentId, tgtEl)

    const srcText = srcCol.textContent ?? ''
    log('info', 'inject bilingual row', {
      segmentId,
      srcTag: htSrcEl.tagName.toLowerCase(),
      srcLen: srcText.length,
      tgtLen: translation.length,
    })
  }

  private injectOverride(segmentId: string, srcEl: Element, translation: string): void {
    if (!srcEl.hasAttribute(ORIG_ATTR)) {
      srcEl.setAttribute(ORIG_ATTR, srcEl.textContent ?? '')
    }
    this.replaceTextNodesDeep(srcEl, translation)
    this.injected.set(segmentId, srcEl)
  }

  private replaceTextNodesDeep(el: Element, translation: string): void {
    const textNodes: Text[] = []
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        textNodes.push(node as Text)
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        for (const child of node.childNodes) walk(child)
      }
    }
    for (const child of el.childNodes) walk(child)
    if (textNodes.length === 0) {
      el.textContent = translation
      return
    }
    if (textNodes.length === 1 && !el.querySelector('*')) {
      el.textContent = translation
      return
    }
    const charCounts = textNodes.map(tn => tn.textContent?.length ?? 0)
    const totalChars = charCounts.reduce((a, b) => a + b, 0)
    if (totalChars === 0) {
      textNodes[0].textContent = translation
      return
    }
    let pos = 0
    for (let i = 0; i < textNodes.length; i++) {
      const ratio = charCounts[i] / totalChars
      const sliceLen = i === textNodes.length - 1
        ? translation.length - pos
        : Math.floor(translation.length * ratio)
      if (sliceLen > 0 && pos < translation.length) {
        textNodes[i].textContent = translation.slice(pos, pos + sliceLen)
        pos += sliceLen
      } else {
        textNodes[i].textContent = ''
      }
    }
  }

  private injectSidebar(segmentId: string, srcEl: Element, translation: string): void {
    const srcText = srcEl.textContent ?? ''
    const item = getOrCreateSidebarItem(segmentId, srcText)
    const tgtTextEl = item.querySelector<HTMLElement>('.xt-sidebar-tgt')!
    tgtTextEl.textContent = translation
    this.injected.set(segmentId, item)
    log('info', 'inject sidebar', { segmentId, srcLen: srcText.length, tgtLen: translation.length })
  }
}

// ─── wrapTokens ──────────────────────────────────────────────

function wrapTokens(el: Element, tokens: string[], side: 'src' | 'tgt', segmentId: string): void {
  const original = el.textContent ?? ''
  el.textContent = ''
  let lastIdx = 0
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    const isCjk = /[\u4e00-\u9fff]/.test(tok)
    if (i > 0 && !isCjk && tok !== ',' && tok !== '.' && tok !== '!' && tok !== '?') {
      el.appendChild(document.createTextNode(' '))
    }
    const span = document.createElement('span')
    span.setAttribute(TOK_ATTR, side)
    span.setAttribute(TOK_SEG_ATTR, segmentId)
    span.setAttribute(TOK_IDX_ATTR, String(i))
    span.textContent = tok
    el.appendChild(span)
    lastIdx++
  }
  if (lastIdx === 0) {
    el.textContent = original
  }
}