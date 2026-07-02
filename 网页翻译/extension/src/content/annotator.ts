/**
 * Agent 3 — 标注 UI（content script）
 *
 * 负责在浏览器页面渲染词级 alignment 修正 popover + 段级 1-5 星评分。
 * 严格 Shadow DOM 隔离，绝不污染原页面 DOM；动效用 transform/opacity 不触发 reflow。
 *
 * 接口契约（不依赖 Agent 1/2 的实现细节）：
 *   opts.encode(input) → Annotation  (Promise)
 *   opts.put(anno)     → any         (Promise)
 *
 * 模型：claude-sonnet-4-6 (MiniMax-M3 路由)
 */

import type { AlignmentResult } from '../shared/types'

// ─── 公共类型 ──────────────────────────────────────────────────

export const AnnotationKind = Object.freeze({
  ALIGN_FIX: 'align_fix',
  SEG_RATING: 'seg_rating',
  ALT_TRANS: 'alt_trans',
})

export interface PageContext {
  url: string
  langPair: [string, string]
}

export interface AnnotatorOpts {
  encode: (input: AnnotateInput) => Promise<Annotation>
  put: (anno: Annotation) => Promise<unknown>
  alignment: AlignmentResult
  pageContext: PageContext
}

export interface AnnotateInput {
  kind: typeof AnnotationKind.ALIGN_FIX | typeof AnnotationKind.SEG_RATING
  url: string
  domPath: string
  srcSegmentId: string
  langPair: [string, string]
  srcText: string
  tgtText: string
  srcTokens: string[]
  tgtTokens: string[]
  predicted: Array<[number, number]>
  modelVersion: string
  payload: AlignFixPayload | SegRatingPayload
}

export type AlignFixPayload = {
  srcTokenIdx: number
  predictedTgtTokenIdx: number
  correctedTgtTokenIdx: number | null
  correctionKind: 'change' | 'remove' | 'add'
  customToken?: string
}

export type SegRatingPayload = {
  rating: 1 | 2 | 3 | 4 | 5
}

export interface Annotation extends AnnotateInput {
  id: string
  createdAt: number
}

interface MtachCandidate {
  token: string
  tgtIdx: number
  score: number
}

const ANNO_ENABLED_KEY = 'annoEnabled'
const RECENTLY_RATED_KEY = 'xtAnnoRatedRecent'
const RATED_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const DEFAULT_MODEL_VERSION = 'nllb-600m-l0h15-v1'

// ─── helpers ───────────────────────────────────────────────────

function now(): number {
  return Date.now()
}

function buildDomPath(el: Element): string {
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur !== document.documentElement) {
    const tag = cur.tagName.toLowerCase()
    const parentEl: Element | null = cur.parentElement
    if (parentEl) {
      let i = 1
      for (const sib of Array.from(parentEl.children)) {
        if (sib === cur) break
        if (sib.tagName === cur.tagName) i++
      }
      parts.unshift(`${tag}:nth-of-type(${i})`)
    } else {
      parts.unshift(tag)
    }
    cur = parentEl
  }
  return '/' + parts.join('/')
}

function getEnabled(): boolean {
  try {
    const ch = (globalThis as unknown as { chrome?: { storage?: { sync?: { get?: (k: string, cb: (r: Record<string, unknown>) => void) => void } } } }).chrome
    if (!ch?.storage?.sync?.get) return true
    let val: unknown = true
    ch.storage.sync.get(ANNO_ENABLED_KEY, r => {
      val = (r as Record<string, unknown>)[ANNO_ENABLED_KEY]
    })
    return val === undefined ? true : Boolean(val)
  } catch {
    return true
  }
}

function getRecentlyRated(): Record<string, number> {
  try {
    const ch = (globalThis as unknown as { chrome?: { storage?: { sync?: { get?: (k: string, cb: (r: Record<string, unknown>) => void) => void } } } }).chrome
    if (!ch?.storage?.sync?.get) return {}
    let raw: unknown = {}
    ch.storage.sync.get(RECENTLY_RATED_KEY, r => {
      raw = (r as Record<string, unknown>)[RECENTLY_RATED_KEY]
    })
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'number') out[k] = v
    }
    const cutoff = Date.now() - RATED_TTL_MS
    for (const [k, v] of Object.entries(out)) {
      if (v < cutoff) delete out[k]
    }
    return out
  } catch {
    return {}
  }
}

function setRecentlyRated(segId: string): void {
  try {
    const ch = (globalThis as unknown as { chrome?: { storage?: { sync?: { get?: (k: string, cb: (r: Record<string, unknown>) => void) => void; set?: (items: Record<string, unknown>, cb?: () => void) => void } } } }).chrome
    const syncApi = ch?.storage?.sync
    if (!syncApi?.get || !syncApi?.set) return
    const set = syncApi.set
    const get = syncApi.get
    get(RECENTLY_RATED_KEY, r => {
      const cur = (r as Record<string, unknown>)[RECENTLY_RATED_KEY]
      const obj: Record<string, number> = (cur && typeof cur === 'object' ? cur : {}) as Record<string, number>
      obj[segId] = Date.now()
      set({ [RECENTLY_RATED_KEY]: obj })
    })
  } catch {
    /* noop */
  }
}

function log(level: 'info' | 'warn', msg: string, fields: Record<string, unknown> = {}) {
  try {
    console[level](
      JSON.stringify({ ts: now(), level, component: 'xt:annotator', msg, ...fields }),
    )
  } catch {
    /* noop */
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => {
    switch (ch) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
      default: return ch
    }
  })
}

// ─── 候选词生成（词级 popover 用）─────────────────────────────

function buildCandidates(alignment: AlignmentResult, srcIdx: number): MtachCandidate[] {
  const out: MtachCandidate[] = []
  const seen = new Set<number>()

  // 1. 直接命中
  for (const a of alignment.alignments) {
    if (a.srcIdx !== srcIdx) continue
    const tok = alignment.tgtTokens[a.tgtIdx]
    if (!tok || seen.has(a.tgtIdx)) continue
    seen.add(a.tgtIdx)
    out.push({ token: tok, tgtIdx: a.tgtIdx, score: a.score })
  }

  // 2. 同段内 score 兜底
  if (out.length < 5) {
    const sorted = [...alignment.alignments].sort((x, y) => y.score - x.score)
    for (const a of sorted) {
      if (out.length >= 5) break
      if (seen.has(a.tgtIdx)) continue
      const tok = alignment.tgtTokens[a.tgtIdx]
      if (!tok) continue
      seen.add(a.tgtIdx)
      out.push({ token: tok, tgtIdx: a.tgtIdx, score: a.score })
    }
  }

  // 3. 去重 token
  const tokSeen = new Set<string>()
  return out.filter(c => {
    if (tokSeen.has(c.token)) return false
    tokSeen.add(c.token)
    return true
  })
}

// ─── 词级 alignment 修正 popover ─────────────────────────────

export interface PencilHandle {
  host: HTMLElement
  open: (srcTokenIdx: number, predictedTgtTokenIdx: number | null) => void
  close: () => void
  getCurrent: () => { srcIdx: number; predTgtIdx: number | null } | null
}

interface PencilHandlers {
  onChoose?: (tgtIdx: number, kind: 'change' | 'remove' | 'add', customToken?: string) => void
}

export function buildPencilShadow(
  srcTokens: string[],
  tgtTokens: string[],
  alignment: AlignmentResult,
  handlers: PencilHandlers = {},
): PencilHandle {
  const host = document.createElement('div')
  host.className = 'xt-anno-pencil-host'
  host.style.cssText = 'position:absolute;z-index:2147483646;'
  const shadow = host.attachShadow({ mode: 'open' })

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      *,*::before,*::after { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
      @keyframes xt-anno-fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes xt-anno-shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
      button { font: inherit; cursor: pointer; }
      .anchor { position: relative; display: inline-block; }
      .pencil {
        all: initial;
        width: 22px; height: 22px;
        display: inline-flex; align-items: center; justify-content: center;
        border-radius: 50%;
        background: rgba(255,255,255,0.95);
        box-shadow: 0 2px 6px rgba(0,0,0,.18);
        cursor: pointer;
        opacity: 0;
        transform: translateY(-1px) scale(.85);
        transition: opacity .12s ease, transform .12s ease, background-color .12s;
        color: #1a73e8;
      }
      .anchor:hover .pencil, .pencil:focus-visible { opacity: 1; transform: translateY(-1px) scale(1); }
      .pencil:active { transform: translateY(-1px) scale(.92); }
      .pencil.success { background: #1e8e3e; color: #fff; }
      .pencil.success svg { display: none; }
      .pencil.success::after {
        content: '✓';
        font: 700 14px/1 -apple-system, sans-serif;
        color: #fff;
      }
      .popover {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        min-width: 220px;
        max-width: 320px;
        background: #fff;
        color: #111827;
        border-radius: 10px;
        box-shadow: 0 6px 20px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.08);
        padding: 10px 12px;
        animation: xt-anno-fadein .12s ease;
        z-index: 2147483647;
      }
      .popover .hd { font-size: 11px; color: #6b7280; margin-bottom: 6px; }
      .popover .hd b { color: #111827; font-weight: 600; }
      .cands { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
      .cand {
        all: initial;
        display: inline-flex; align-items: center; gap: 6px;
        padding: 4px 10px;
        background: #f3f4f6;
        color: #111827;
        font-size: 13px;
        border-radius: 999px;
        cursor: pointer;
        transition: background-color .12s, color .12s;
      }
      .cand:hover, .cand.focused { background: #1a73e8; color: #fff; }
      .cand .kbd {
        font-size: 10px; opacity: .7; padding: 1px 4px;
        background: rgba(0,0,0,.06); border-radius: 3px;
      }
      .cand:hover .kbd, .cand.focused .kbd { background: rgba(255,255,255,.25); opacity: 1; }
      .cand-none {
        all: initial;
        display: inline-flex; align-items: center;
        padding: 4px 10px;
        background: #fff;
        color: #d93025;
        border: 1px dashed #d93025;
        font-size: 12px;
        border-radius: 999px;
        cursor: pointer;
        transition: background-color .12s, color .12s;
      }
      .cand-none:hover { background: #fce8e6; }
      .custom-row { display: flex; gap: 6px; margin-top: 4px; }
      .custom-row input.custom {
        flex: 1; min-width: 0;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 13px;
        outline: none;
        transition: border-color .12s;
      }
      .custom-row input.custom:focus { border-color: #1a73e8; }
      .custom-row button.submit {
        all: initial;
        padding: 4px 10px;
        background: #1a73e8;
        color: #fff;
        font-size: 12px;
        border-radius: 6px;
        cursor: pointer;
      }
      .footer { display: flex; justify-content: space-between; margin-top: 8px; font-size: 11px; color: #6b7280; }
      .err { font-size: 11px; color: #d93025; margin-top: 4px; animation: xt-anno-shake .2s ease; }
    </style>
    <span class="anchor">
      <button class="pencil" title="修正词对齐" aria-label="修正词对齐">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
      </button>
      <div class="popover" hidden></div>
    </span>
  `

  const anchor = shadow.querySelector('.anchor') as HTMLElement
  const pencil = shadow.querySelector('.pencil') as HTMLButtonElement
  const popover = shadow.querySelector('.popover') as HTMLElement

  let currentSrcIdx: number | null = null
  let currentPredTgtIdx: number | null = null

  function renderPopover() {
    if (currentSrcIdx == null) return
    const srcTok = srcTokens[currentSrcIdx] ?? `(src[${currentSrcIdx}])`
    popover.innerHTML = `
      <div class="hd">原文 <b>${escapeHtml(srcTok)}</b> → 选对应译文</div>
      <div class="cands"></div>
      <div class="custom-row">
        <input class="custom" type="text" placeholder="自定义词 (Enter 提交)" maxlength="40" />
        <button class="submit" type="button">提交</button>
      </div>
      <div class="cand-none-wrap" style="margin-top:6px"></div>
      <div class="footer"><span>1-9 选候选</span><span>Esc 关闭</span></div>
      <div class="err" hidden></div>
    `
    const cands = buildCandidates(alignment, currentSrcIdx)
    const candsEl = popover.querySelector('.cands') as HTMLElement
    cands.slice(0, 9).forEach((c, i) => {
      const btn = document.createElement('button')
      btn.className = 'cand'
      btn.type = 'button'
      btn.innerHTML = `${escapeHtml(c.token)} <span class="kbd">${i + 1}</span>`
      btn.dataset.tgtIdx = String(c.tgtIdx)
      btn.addEventListener('click', e => {
        e.stopPropagation()
        handlers.onChoose?.(c.tgtIdx, 'change')
        showSuccess()
      })
      candsEl.appendChild(btn)
    })

    const noneWrap = popover.querySelector('.cand-none-wrap') as HTMLElement
    const noneBtn = document.createElement('button')
    noneBtn.className = 'cand-none'
    noneBtn.type = 'button'
    noneBtn.textContent = '无对应词'
    noneBtn.addEventListener('click', e => {
      e.stopPropagation()
      handlers.onChoose?.(-1, 'remove')
      showSuccess()
    })
    noneWrap.appendChild(noneBtn)

    const input = popover.querySelector('input.custom') as HTMLInputElement
    const submitBtn = popover.querySelector('button.submit') as HTMLButtonElement
    submitBtn.addEventListener('click', e => {
      e.stopPropagation()
      const v = input.value.trim()
      if (!v) return
      handlers.onChoose?.(tgtTokens.length, 'add', v)
      showSuccess()
    })
    input.addEventListener('keydown', e => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        const v = input.value.trim()
        if (!v) return
        handlers.onChoose?.(tgtTokens.length, 'add', v)
        showSuccess()
      }
    })

    popover.hidden = false
    requestAnimationFrame(() => input.focus())
  }

  function showSuccess() {
    popover.hidden = true
    pencil.classList.add('success')
    setTimeout(() => {
      pencil.classList.remove('success')
      currentSrcIdx = null
      currentPredTgtIdx = null
    }, 2000)
  }

  pencil.addEventListener('click', e => {
    e.stopPropagation()
    if (popover.hidden) {
      // 默认 open：取 alignment 第一个 src token
      const first = alignment.alignments[0]
      if (first) {
        currentSrcIdx = first.srcIdx
        currentPredTgtIdx = first.tgtIdx
      } else if (srcTokens.length > 0) {
        currentSrcIdx = 0
        currentPredTgtIdx = null
      }
      renderPopover()
    } else {
      popover.hidden = true
      currentSrcIdx = null
      currentPredTgtIdx = null
    }
  })

  host.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent
    if (currentSrcIdx == null) return
    if (popover.hidden) return
    if (ke.key === 'Escape') {
      ke.preventDefault()
      popover.hidden = true
      currentSrcIdx = null
      currentPredTgtIdx = null
      return
    }
    if (/^[1-9]$/.test(ke.key)) {
      const i = Number(ke.key) - 1
      const cands = buildCandidates(alignment, currentSrcIdx)
      const c = cands[i]
      if (c) {
        ke.preventDefault()
        handlers.onChoose?.(c.tgtIdx, 'change')
        showSuccess()
      }
    }
  })

  return {
    host,
    open(srcTokenIdx: number, predictedTgtTokenIdx: number | null) {
      currentSrcIdx = srcTokenIdx
      currentPredTgtIdx = predictedTgtTokenIdx
      renderPopover()
    },
    close() {
      popover.hidden = true
      currentSrcIdx = null
      currentPredTgtIdx = null
    },
    getCurrent() {
      if (currentSrcIdx == null) return null
      return { srcIdx: currentSrcIdx, predTgtIdx: currentPredTgtIdx }
    },
  }
  void anchor
}

// ─── 段级 1-5 星评分 ─────────────────────────────────────────

export interface StarHandle {
  host: HTMLElement
  setHovered: (b: boolean) => void
  setRated: (n: number) => void
}

interface StarHandlers {
  onRate?: (n: 1 | 2 | 3 | 4 | 5) => void
}

export function buildStarShadow(handlers: StarHandlers = {}): StarHandle {
  const host = document.createElement('div')
  host.className = 'xt-anno-star-host'
  host.style.cssText = 'position:absolute;z-index:2147483646;'
  const shadow = host.attachShadow({ mode: 'open' })

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      *,*::before,*::after { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif; }
      @keyframes xt-anno-fadein { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }
      button { font: inherit; cursor: pointer; }
      .row {
        display: inline-flex;
        align-items: center;
        gap: 1px;
        padding: 2px 6px;
        background: rgba(255,255,255,.92);
        border-radius: 999px;
        box-shadow: 0 2px 6px rgba(0,0,0,.14);
        opacity: 0;
        transform: translateY(-2px);
        transition: opacity .14s ease, transform .14s ease;
      }
      :host(.hovered) .row, .row.show { opacity: 1; transform: translateY(0); }
      .star {
        all: initial;
        display: inline-flex;
        align-items: center; justify-content: center;
        width: 18px; height: 18px;
        cursor: pointer;
        color: #cbd5e1;
        transition: color .08s ease, transform .08s ease;
      }
      .star:hover, .star.preview { color: #f59e0b; transform: scale(1.12); }
      .star.rated { color: #f59e0b; }
      svg { width: 14px; height: 14px; pointer-events: none; }
    </style>
    <div class="row">
      ${[1, 2, 3, 4, 5].map(n => `
        <button class="star" data-n="${n}" title="${n} 星" aria-label="${n} 星">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 17.27L18.18 21 16.54 13.97 22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
          </svg>
        </button>
      `).join('')}
    </div>
  `

  const stars = Array.from(shadow.querySelectorAll<HTMLButtonElement>('.star'))
  stars.forEach((star, i) => {
    star.addEventListener('mouseenter', () => {
      stars.forEach((s, j) => s.classList.toggle('preview', j <= i))
    })
    star.addEventListener('mouseleave', () => {
      stars.forEach(s => s.classList.remove('preview'))
    })
    star.addEventListener('click', e => {
      e.stopPropagation()
      const n = (Number(star.dataset.n) as 1 | 2 | 3 | 4 | 5)
      handlers.onRate?.(n)
    })
  })

  return {
    host,
    setHovered(b: boolean) {
      host.classList.toggle('hovered', b)
    },
    setRated(n: number) {
      stars.forEach((s, i) => {
        s.classList.toggle('rated', i < n)
      })
      // 2s 后淡出
      setTimeout(() => {
        host.classList.remove('hovered')
      }, 2000)
    },
  }
}

// ─── Annotator 类 ────────────────────────────────────────────

export class Annotator {
  private mounted = false
  private pencilHosts = new Map<string, HTMLElement>()
  private starHosts = new Map<string, HTMLElement>()
  private recentRated: Record<string, number> = {}

  constructor() {
    this.recentRated = getRecentlyRated()
  }

  mount(rootEl: HTMLElement, opts: AnnotatorOpts): void {
    if (!getEnabled()) {
      log('info', 'annotator disabled by setting', {})
      return
    }
    if (this.mounted) return
    this.mounted = true

    const { encode, put, alignment, pageContext } = opts
    const recent = this.recentRated

    // 收集 .xt-translation 元素
    const translations = Array.from(
      rootEl.querySelectorAll<HTMLElement>('.xt-translation'),
    )

    translations.forEach(tgt => {
      const segId = tgt.getAttribute('data-xt-tgt') ?? ''
      if (!segId) return

      const srcEl = tgt.closest<HTMLElement>('[data-xt-id]')
      // v4: 原文在 .xt-src-text span 中；translation-only 在 data-xt-original；兜底 textContent
      const srcText =
        srcEl?.getAttribute('data-xt-original') ??
        srcEl?.querySelector('.xt-src-text')?.textContent ??
        srcEl?.textContent ??
        ''
      const tgtText = tgt.textContent ?? ''
      const parent = tgt.parentElement
      if (!parent) return

      // ── A. 5 星评分 ─────────────────────────────────────
      if (!recent[segId] || Date.now() - recent[segId] >= RATED_TTL_MS) {
        const star = buildStarShadow({
          onRate: async (n) => {
            try {
              const domPath = buildDomPath(tgt)
              const anno = await encode({
                kind: AnnotationKind.SEG_RATING,
                url: pageContext.url,
                domPath,
                srcSegmentId: segId,
                langPair: pageContext.langPair,
                srcText,
                tgtText,
                srcTokens: alignment.srcTokens,
                tgtTokens: alignment.tgtTokens,
                predicted: alignment.alignments.map(a => [a.srcIdx, a.tgtIdx]),
                modelVersion: DEFAULT_MODEL_VERSION,
                payload: { rating: n },
              })
              await put(anno)
              star.setRated(n)
              recent[segId] = Date.now()
              setRecentlyRated(segId)
              log('info', 'annotation submitted', { kind: 'seg_rating', segId, rating: n })
            } catch (err) {
              log('warn', 'rating submit failed', { err: String(err), segId })
            }
          },
        })

        const parentPos = getComputedStyle(parent).position
        if (parentPos === 'static') parent.style.position = 'relative'
        star.host.style.top = '4px'
        star.host.style.right = '4px'
        parent.appendChild(star.host)
        this.starHosts.set(segId, star.host)

        const onEnter = () => star.setHovered(true)
        tgt.addEventListener('mouseenter', onEnter)
        parent.addEventListener('mouseenter', onEnter)
        // 不在 host 上加 capture-phase click 监听器 —— 会吞掉内层 button 的 click
      }

      // ── B. ✏️ 词级 alignment 修正 ──────────────────────────
      if (this.pencilHosts.has(segId)) return
      const pencil = buildPencilShadow(alignment.srcTokens, alignment.tgtTokens, alignment, {
        onChoose: async (tgtIdx, kind, customToken) => {
          try {
            const domPath = buildDomPath(tgt)
            const cur = pencil.getCurrent()
            const payload: AlignFixPayload = {
              srcTokenIdx: cur?.srcIdx ?? -1,
              predictedTgtTokenIdx: cur?.predTgtIdx ?? -1,
              correctedTgtTokenIdx: tgtIdx >= 0 ? tgtIdx : null,
              correctionKind: kind,
              customToken,
            }
            const anno = await encode({
              kind: AnnotationKind.ALIGN_FIX,
              url: pageContext.url,
              domPath,
              srcSegmentId: segId,
              langPair: pageContext.langPair,
              srcText,
              tgtText,
              srcTokens: alignment.srcTokens,
              tgtTokens: alignment.tgtTokens,
              predicted: alignment.alignments.map(a => [a.srcIdx, a.tgtIdx]),
              modelVersion: DEFAULT_MODEL_VERSION,
              payload,
            })
            await put(anno)
            log('info', 'annotation submitted', { kind: 'align_fix', segId, payload })
          } catch (err) {
            log('warn', 'align fix submit failed', { err: String(err), segId })
          }
        },
      })

      const parentPos2 = getComputedStyle(parent).position
      if (parentPos2 === 'static') parent.style.position = 'relative'
      pencil.host.style.top = '4px'
      pencil.host.style.right = '38px'
      parent.appendChild(pencil.host)
      this.pencilHosts.set(segId, pencil.host)
    })
  }

  unmount(): void {
    this.pencilHosts.forEach(h => h.remove())
    this.starHosts.forEach(h => h.remove())
    this.pencilHosts.clear()
    this.starHosts.clear()
    this.mounted = false
  }
}

// 模块级 helper 防止 unused
void escapeHtml