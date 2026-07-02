import { extractSegments, consumeShadowRoots } from './dom-walker'
import { TranslationInjector, ensureSidebarHost } from './injector'
import { TranslationScheduler } from './scheduler'
import { TranslationToolbar } from './toolbar'
import { AnnotationBridge } from './annotation-bridge'
// @ts-expect-error - lib/annotation.mjs is plain ESM JS, no .d.ts
import * as annoSchema from '../../../lib/annotation.mjs'
// @ts-expect-error - lib/annotation-store.mjs is plain ESM JS, no .d.ts
import * as annoStore from '../../../lib/annotation-store.mjs'
import type { ExtensionMessage, PageTranslationState, TranslationMode, LangCode, AlignmentResult } from '../shared/types'
import './content.css'

// ─── 词级对齐 hover 状态（W1-5）──────────────────────────────
// segmentId → AlignmentResult
const alignmentCache = new Map<string, AlignmentResult>()
// 防止同一 segment 重复请求对齐
const pendingAlign = new Set<string>()

// ─── FAB 悬浮操作球（替代旧版状态浮层，持久可见）────────────
// 仅 top frame 挂载，shadow DOM 隔离样式
const fabHost = document.createElement('div')
fabHost.id = 'xt-fab-host'
const fabShadow = fabHost.attachShadow({ mode: 'open' })
fabShadow.innerHTML = `
  <style>
    :host { all: initial; }
    *,*::before,*::after { box-sizing: border-box; }

    .fab {
      position: fixed;
      right: 16px;
      bottom: 100px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #2563eb, #3b82f6);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 14px rgba(37, 99, 235, .45);
      z-index: 2147483647;
      transition: transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s, background-color .3s;
      outline: none;
      padding: 0;
      font-family: -apple-system, system-ui, sans-serif;
    }
    .fab:hover  { transform: scale(1.1); box-shadow: 0 6px 22px rgba(37, 99, 235, .55); }
    .fab:active { transform: scale(.95); }
    .fab.done   { background: linear-gradient(135deg, #10b981, #059669); box-shadow: 0 4px 14px rgba(16, 185, 129, .45); }
    .fab.done:hover { box-shadow: 0 6px 22px rgba(16, 185, 129, .55); }
    .fab.error  { background: linear-gradient(135deg, #ef4444, #dc2626); box-shadow: 0 4px 14px rgba(239, 68, 68, .45); }

    /* SVG icons */
    .fab svg { width: 24px; height: 24px; pointer-events: none; }

    /* Progress ring */
    .fab .ring-svg {
      position: absolute; inset: -4px;
      width: calc(100% + 8px); height: calc(100% + 8px);
      transform: rotate(-90deg); pointer-events: none;
    }
    .ring-track { fill: none; stroke: rgba(255,255,255,.2); stroke-width: 2.5; }
    .ring-fill  {
      fill: none; stroke: #fff; stroke-width: 2.5; stroke-linecap: round;
      transition: stroke-dashoffset .5s ease;
    }

    /* Progress label inside the button */
    .fab .pct {
      position: absolute; color: #fff;
      font-size: 11px; font-weight: 700; line-height: 1;
      letter-spacing: -.3px;
    }

    /* Tooltip */
    .fab .tip {
      position: absolute;
      right: calc(100% + 10px);
      top: 50%; transform: translateY(-50%);
      background: rgba(0,0,0,.82);
      color: #fff;
      font-size: 12px; line-height: 1.4;
      padding: 6px 10px;
      border-radius: 6px;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity .15s;
    }
    .fab .tip::after {
      content: '';
      position: absolute; left: 100%; top: 50%; transform: translateY(-50%);
      border: 5px solid transparent;
      border-left-color: rgba(0,0,0,.82);
    }
    .fab:hover .tip { opacity: 1; }

    /* Spin animation */
    @keyframes xt-spin { to { transform: rotate(360deg); } }
    .spinning { animation: xt-spin 1.4s linear infinite; }

    /* Error toast (above the FAB) */
    .toast {
      position: fixed; right: 16px; bottom: 160px;
      max-width: 260px;
      background: #d93025; color: #fff;
      font-size: 12px; line-height: 1.5;
      padding: 8px 12px 8px 12px; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,.25);
      display: none;
      z-index: 2147483647;
    }
    .toast.show { display: block; animation: xt-fadein .2s ease; }
    @keyframes xt-fadein { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
  </style>

  <button class="fab" id="fab" title="">
    <!-- idle: globe -->
    <svg id="icon-idle" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10A15.3 15.3 0 0 1 8 12a15.3 15.3 0 0 1 4-10z"/>
    </svg>
    <!-- done: restore arrow -->
    <svg id="icon-done" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:none">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
      <path d="M3 3v5h5"/>
    </svg>
    <!-- error: X -->
    <svg id="icon-error" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" style="display:none">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
    <!-- working: spinner circle (CSS animated) -->
    <svg id="icon-working" class="spinning" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" style="display:none">
      <path d="M21 12a9 9 0 1 1-6.22-8.56"/>
    </svg>

    <!-- progress ring overlay -->
    <svg class="ring-svg" id="ring-svg" style="display:none" viewBox="0 0 56 56">
      <circle class="ring-track" cx="28" cy="28" r="25"/>
      <circle class="ring-fill"  cx="28" cy="28" r="25" id="ring-fill"
        stroke-dasharray="157.08" stroke-dashoffset="157.08"/>
    </svg>
    <span class="pct" id="pct" style="display:none"></span>

    <span class="tip" id="tip">翻译此页</span>
  </button>

  <div class="toast" id="toast"></div>
`

if (window === window.top) {
  document.documentElement.appendChild(fabHost)
}

// FAB elements
const fab        = fabShadow.getElementById('fab')!
const iconIdle   = fabShadow.getElementById('icon-idle')!
const iconDone   = fabShadow.getElementById('icon-done')!
const iconError  = fabShadow.getElementById('icon-error')!
const iconWorking = fabShadow.getElementById('icon-working')!
const ringSvg    = fabShadow.getElementById('ring-svg')!
const ringFill   = fabShadow.getElementById('ring-fill')!
const pctEl      = fabShadow.getElementById('pct')!
const tipEl      = fabShadow.getElementById('tip')!
const toastEl    = fabShadow.getElementById('toast')!
const RING_CIRC  = 157.08  // 2π × 25

function updateFAB(kind: 'idle' | 'working' | 'done' | 'error', progress?: number, errMsg?: string) {
  fab.className = 'fab' + (kind === 'done' ? ' done' : kind === 'error' ? ' error' : '')

  iconIdle.style.display    = kind === 'idle' ? '' : 'none'
  iconDone.style.display    = kind === 'done' ? '' : 'none'
  iconError.style.display   = kind === 'error' ? '' : 'none'
  iconWorking.style.display = kind === 'working' && (progress == null || progress < 5) ? '' : 'none'
  ringSvg.style.display     = kind === 'working' && progress != null && progress >= 5 ? '' : 'none'
  pctEl.style.display       = kind === 'working' && progress != null && progress >= 5 ? '' : 'none'

  if (kind === 'working' && progress != null) {
    const offset = RING_CIRC * (1 - progress / 100)
    ringFill.setAttribute('stroke-dashoffset', String(Math.round(offset * 100) / 100))
    pctEl.textContent = `${Math.round(progress)}%`
  }

  tipEl.textContent = kind === 'done' ? '还原原文' : kind === 'error' ? '点击关闭' : '翻译此页'

  if (kind === 'error' && errMsg) {
    toastEl.textContent = errMsg
    toastEl.className = 'toast show'
    setTimeout(() => { toastEl.className = 'toast' }, 5000)
  } else {
    toastEl.className = 'toast'
  }
}

// FAB click: translate ↔ restore
fab.addEventListener('click', () => {
  if (state.active) {
    restore()
  } else {
    chrome.storage.local.get(['tgtLang', 'srcLang', 'mode'], (opts) => {
      const tgt  = (opts.tgtLang as LangCode)  || 'zh'
      const src  = (opts.srcLang as LangCode)  || 'auto'
      const mode = (opts.mode as TranslationMode) || 'bilingual'
      startTranslation(src, tgt, mode)
    })
  }
})

// Minimal setStatus shim — drives the FAB
function setStatus(kind: 'idle' | 'working' | 'done' | 'error', _title: string, _detail = '', progress?: number) {
  updateFAB(kind, progress)
  if (kind === 'error') {
    updateFAB('error', undefined, _detail || _title)
  }
}

// ─── 状态 ──────────────────────────────────────────────────
let state: PageTranslationState = {
  active: false,
  mode: 'bilingual',
  srcLang: 'auto',
  tgtLang: 'zh',
  progress: 0,
  total: 0,
  translated: 0,
}

const injector = new TranslationInjector()
let scheduler: TranslationScheduler | null = null
let mutationObserver: MutationObserver | null = null

// ─── 标注 Bridge（Agent 8 接入）────────────────────────────────
// 把 annotator.ts + lib/annotation + lib/annotation-store 接到 setMode 流程。
// 设计：依赖通过构造注入；enabled=false 时 attach* 全部跳过；chrome.storage.onChanged 实时同步。
// A7 临时类型 shim：等 Agent 8 给出正式契约后会被替换。
const annotationBridge: AnnotationBridge = new AnnotationBridge({
  encode: annoSchema.encode as unknown as (input: unknown) => Promise<unknown>,
  put: annoStore.put as unknown as (anno: unknown) => Promise<unknown>,
  isRatedRecent: (segId: string) =>
    annoStore.getRatedRecent
      ? annoStore.getRatedRecent(segId)
      : Promise.resolve(false),
})

/**
 * Agent 8 接入：段译完注入 DOM 后调用，挂标注 UI（✏️ + ⭐ / 仅 ⭐）。
 * sidebar 模式由侧栏自己处理，不在页面 DOM 里挂 UI。
 */
function attachAnnotationAfterInject(segmentId: string, translation: string): void {
  // sidebar 模式：不在页面 DOM 里挂 UI
  if (state.mode === 'sidebar') {
    return
  }

  const srcEl = deepQuerySelector(`[data-xt-id="${segmentId}"]`) as HTMLElement | null
  const tgtEl = deepQuerySelector(`[data-xt-tgt="${segmentId}"]`) as HTMLElement | null
  if (!srcEl || !tgtEl) {
    console.warn(`[xt:content] attachAnnotation: src/tgt el missing ${segmentId}`)
    return
  }

  const srcText =
    srcEl.getAttribute('data-xt-original') ??
    srcEl.querySelector('.xt-src-text')?.textContent ??
    srcEl.textContent ??
    ''

  // 拿 cached alignment（可能尚未回来；hover 触发时再补 attach）
  const alignment = alignmentCache.get(segmentId)
  const srcTokens = alignment?.srcTokens ?? []
  const tgtTokens = alignment?.tgtTokens ?? []
  const predicted: Array<[number, number]> = (alignment?.alignments ?? []).map(a => [
    a.srcIdx,
    a.tgtIdx,
  ])

  const ctx = {
    enabled: true,
    segmentId,
    srcText,
    tgtText: translation,
    srcTokens,
    tgtTokens,
    predicted,
    srcEl,
    tgtEl,
    mode: state.mode,
    langPair: [state.srcLang, state.tgtLang] as [string, string],
    url: location.href,
    alignment: alignment ?? {
      segmentId,
      srcTokens,
      tgtTokens,
      alignments: [],
    },
  }

  if (state.mode === 'bilingual') {
    annotationBridge.attachBilingual?.(ctx)
  } else {
    annotationBridge.attachTranslationOnly?.(ctx)
  }

  // 若 alignment 在挂 UI 后才到 → 重挂一遍（拿正确的 tokens / alignments）
  if (!alignment) {
    const retry = () => {
      const a = alignmentCache.get(segmentId)
      if (!a) return
      annotationBridge.cleanup?.()
      const newCtx = {
        ...ctx,
        srcTokens: a.srcTokens,
        tgtTokens: a.tgtTokens,
        predicted: a.alignments.map(p => [p.srcIdx, p.tgtIdx]) as Array<[number, number]>,
        alignment: a,
      }
      if (state.mode === 'bilingual') annotationBridge.attachBilingual?.(newCtx)
      else annotationBridge.attachTranslationOnly?.(newCtx)
    }
    // 等 alignment 最多 5s；每 200ms check 一次
    let tries = 0
    const iv = setInterval(() => {
      tries++
      retry()
      if (alignmentCache.has(segmentId) || tries >= 25) clearInterval(iv)
    }, 200)
  }
}

// ─── 顶栏工具条（W3.2：沉浸式 shadow DOM 工具条）──────────────
let toolbar: TranslationToolbar | null = null
function getToolbar(): TranslationToolbar {
  if (!toolbar) {
    toolbar = new TranslationToolbar({
      onModeChange: (mode) => setMode(mode),
      onRestore: () => restore(),
      onClose: () => {
        toolbar?.destroy()
        toolbar = null
      },
    })
  }
  return toolbar
}
// W2-3: 每个 shadow root 独立 observer + 周期重扫 timer
const shadowObservers: MutationObserver[] = []
let rescanTimer: ReturnType<typeof setInterval> | null = null
let rescanCycles = 0
let zeroCycles = 0
let scrollTimer: ReturnType<typeof setTimeout> | null = null

// W2-3: deep query —— 穿透 shadow root 和同域 iframe
function deepQuerySelector(selector: string): HTMLElement | null {
  const top = document.querySelector<HTMLElement>(selector)
  if (top) return top
  const stack: ParentNode[] = [document]
  const visited = new WeakSet<ParentNode>()
  while (stack.length > 0) {
    const root = stack.pop()!
    if (visited.has(root)) continue
    visited.add(root)
    const found = root.querySelector<HTMLElement>(selector)
    if (found) return found
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
  return null
}

// ─── 消息监听 ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg: ExtensionMessage, _sender, sendResponse) => {
  console.log('[xt:content] message', msg.type)

  // PING：扩展重载后用于探测"本 tab 已注入 content script"，触发自动刷新
  if (msg.type === 'PING') {
    sendResponse({ ok: true, pong: true })
    return false
  }

  switch (msg.type) {
    case 'TRANSLATE':
      startTranslation(msg.srcLang, msg.tgtLang, msg.mode)
      sendResponse({ ok: true })
      break
    case 'RESTORE':
      restore()
      sendResponse({ ok: true })
      break
    case 'SET_MODE':
      setMode(msg.mode)
      sendResponse({ ok: true })
      break
    case 'GET_STATE':
      sendResponse(state)
      break
    case 'TRANSLATION_CHUNK':
      handleChunk(msg.chunk)
      break
    case 'TRANSLATION_ERROR':
      setStatus('error', '❌ 翻译失败', (msg as { message?: string }).message ?? '未知错误')
      break
    case 'ALIGN_RESPONSE':
      handleAlignResponse(msg.result)
      break
    case 'ALIGN_ERROR':
      handleAlignError(msg.segmentId, msg.message)
      break
    case 'XT_ANNOTATION_TOGGLE':
      // Agent 8: popup 主动广播（chrome.storage.onChanged 也会触发，幂等）
      annotationBridge.setEnabled(msg.enabled)
      console.log(`[xt:content] annotation toggle → ${msg.enabled}`)
      sendResponse({ ok: true })
      break
    default:
      break
  }
  return false
})

// ─── 快捷键 ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'COMMAND' && msg.command === 'toggle-translate') {
    state.active ? restore() : startTranslation(state.srcLang, state.tgtLang, state.mode)
  }
})

// ─── 翻译流程 ──────────────────────────────────────────────
function startTranslation(srcLang: LangCode, tgtLang: LangCode, mode: TranslationMode) {
  console.log(`[xt:content] 开始翻译 ${srcLang}→${tgtLang} 模式:${mode}`)

  state = { ...state, active: true, srcLang, tgtLang, mode, translated: 0 }

  const segments = extractSegments(document.body, { tgtLang })
  state.total = segments.length

  console.log(`[xt:content] 提取到 ${segments.length} 个 segment，mode=${mode}`)

  // 挂顶栏工具条（首次）
  const tb = getToolbar()
  tb.mount()
  tb.update({
    mode,
    translated: 0,
    total: segments.length,
    progress: 0,
    active: true,
  })

  // sidebar 模式：立即挂右侧栏（空状态），让用户看到 panel 而非「什么都没发生」
  // W2：所有模式都禁用视口门控 ——
  //   原设计靠 IntersectionObserver 触发新批次，但 BBC 等内容站
  //   首批翻译完后用户不滚动就以为「卡住」。对标百度翻译行为：
  //   点击翻译 = 整页翻译，不要求用户滚动触发。
  if (mode === 'sidebar') {
    ensureSidebarHost()
    setStatus('working', '⏳ 翻译中', `侧栏模式 · ${segments.length} 段全部排队`, 0)
  } else {
    setStatus('working', '⏳ 翻译中', `共 ${segments.length} 段，后台批量翻译`, 0)
  }

  scheduler = new TranslationScheduler(
    batch => {
      console.log(`[xt:content] 调度批次 ${batch.length} 段`)
      setStatus('working', '⏳ 翻译中', `批次 ${batch.length} 段，已 ${state.translated}/${state.total}`, state.progress)
      chrome.runtime.sendMessage({
        type: 'TRANSLATE_BATCH',
        segments: batch.map(s => ({ id: s.id, text: s.text })),
        srcLang,
        tgtLang,
      })
    },
    8,            // batchSize
    2000,         // batchChars
    30_000,       // timeoutMs
    false,        // viewportGated: W2 全模式禁用，对齐百度翻译体验
  )

  scheduler.register(segments)
  observeSpa()
  startRescan() // W2-3: 周期重扫兜底
  broadcastState()
}

function handleChunk(chunk: { segmentId: string; delta: string; done: boolean; full?: string }) {
  if (chunk.done) {
    // 即使译文为空也计数（避免卡死进度），但空译文不注入 DOM
    if (chunk.full) {
      injector.inject(chunk.segmentId, chunk.full, state.mode, state.tgtLang)
      // W2 修复（关键）：不再自动 requestAlignment。
      // 旧实现：353 段并发对齐 → LaBSE 暴打 + wrapTokens 切几万 token span
      // → DOM 爆炸 + fadein 动画堆积 → 浏览器卡死/崩溃。
      // 改为懒触发：用户 hover 到译文时才对齐该段（setupHoverDelegation）。
      // 译文元素打标记，便于 hover 时识别
      const tgtEl = deepQuerySelector(`[data-xt-tgt="${chunk.segmentId}"]`)
      if (tgtEl && (state.mode === 'bilingual' || state.mode === 'sidebar')) {
        tgtEl.setAttribute('data-xt-needs-align', '1')
        // sidebar 模式下 wrap 在 .xt-sidebar-tgt
        const inner = tgtEl.matches('.xt-sidebar-item')
          ? tgtEl.querySelector<HTMLElement>('.xt-sidebar-tgt')
          : tgtEl
        inner?.setAttribute('data-xt-needs-align', '1')
      }

      // ─── 标注 Bridge 接入（Agent 8）─────────────────────────────
      // 译文注入后立刻挂标注 UI。
      // sidebar 模式不在页面 DOM 里挂 UI（侧栏自己处理），由 attachAnnotationAfterInject 过滤。
      attachAnnotationAfterInject(chunk.segmentId, chunk.full)
    }
    scheduler?.markDone(chunk.segmentId)
    state.translated++
    state.progress = Math.round((state.translated / state.total) * 100)
    console.log(
      `[xt:content] 完成 ${state.translated}/${state.total} (${chunk.segmentId} full=${chunk.full?.length ?? 0}字)`,
    )
    // 同步更新顶栏工具条进度
    toolbar?.update({
      translated: state.translated,
      total: state.total,
      progress: state.progress,
    })
    if (state.translated >= state.total) {
      setStatus('done', '✅ 翻译完成', `${state.total} 段（hover 译文查看词对齐）`)
    } else {
      setStatus('working', '⏳ 翻译中', `${state.translated}/${state.total} · ${state.progress}%`, state.progress)
    }
    broadcastState()
  } else {
    injector.append(chunk.segmentId, chunk.delta)
  }
}

// ─── 词级对齐请求（W1-5）──────────────────────────────────────
function requestAlignment(segmentId: string, translation: string): void {
  if (alignmentCache.has(segmentId) || pendingAlign.has(segmentId)) return
  const srcEl = deepQuerySelector(`[data-xt-id="${segmentId}"]`)
  const src = srcEl?.getAttribute('data-xt-original') ?? srcEl?.textContent ?? ''
  if (!src || !translation) return

  pendingAlign.add(segmentId)
  chrome.runtime
    .sendMessage({ type: 'ALIGN_QUERY', segmentId, src, tgt: translation })
    .catch(err => console.warn('[xt:content] align query failed', err))
    .finally(() => pendingAlign.delete(segmentId))
}

function handleAlignResponse(result: AlignmentResult): void {
  alignmentCache.set(result.segmentId, result)
  injector.applyAlignment(result.segmentId, result)
}

function handleAlignError(segmentId: string, message: string): void {
  console.warn(`[xt:content] align error ${segmentId}: ${message}`)
}

// ─── hover 事件委托（W1-5）────────────────────────────────────
// 全局监听 mouseover/mouseout，按 data-xt-tok attr 找 token span
// 同时监听 [data-xt-needs-align] 触发懒对齐
function setupHoverDelegation(): void {
  document.addEventListener('mouseover', (e) => {
    // W2 懒对齐：进入「待对齐」译文元素 → 即时请求对齐该段（~80ms 用户无感）
    const needsAlign = (e.target as HTMLElement).closest?.('[data-xt-needs-align]') as HTMLElement | null
    if (needsAlign) {
      const segId = needsAlign.getAttribute('data-xt-tgt')
        ?? needsAlign.closest('[data-xt-tgt]')?.getAttribute('data-xt-tgt')
      if (segId) {
        const full = needsAlign.textContent ?? ''
        needsAlign.removeAttribute('data-xt-needs-align')
        requestAlignment(segId, full)
      }
    }

    const span = (e.target as HTMLElement).closest?.('[data-xt-tok]') as HTMLElement | null
    if (!span) return
    const side = span.getAttribute('data-xt-tok') as 'src' | 'tgt'
    const segId = span.getAttribute('data-xt-seg')
    const idx = Number(span.getAttribute('data-xt-idx'))
    if (!segId || Number.isNaN(idx)) return

    const alignment = alignmentCache.get(segId)
    if (!alignment) return

    // 找出对侧应高亮的 idx 集合
    const otherSide = side === 'src' ? 'tgt' : 'src'
    const matchedIdx = new Set<number>()
    for (const a of alignment.alignments) {
      if (side === 'src' && a.srcIdx === idx) matchedIdx.add(a.tgtIdx)
      if (side === 'tgt' && a.tgtIdx === idx) matchedIdx.add(a.srcIdx)
    }
    if (matchedIdx.size === 0) return

    // 高亮当前 span + 所有匹配的对侧 span
    span.classList.add('xt-hover-active')
    document.querySelectorAll<HTMLElement>(
      `[data-xt-tok="${otherSide}"][data-xt-seg="${segId}"]`,
    ).forEach(other => {
      const otherIdx = Number(other.getAttribute('data-xt-idx'))
      if (matchedIdx.has(otherIdx)) {
        other.classList.add('xt-hover-pair')
      }
    })
  })

  document.addEventListener('mouseout', (e) => {
    const span = (e.target as HTMLElement).closest?.('[data-xt-tok]') as HTMLElement | null
    if (!span) return
    const segId = span.getAttribute('data-xt-seg')
    if (!segId) return
    // 清理所有相关高亮（保守起见全清该 segment 的）
    document.querySelectorAll<HTMLElement>(`[data-xt-seg="${segId}"].xt-hover-active, [data-xt-seg="${segId}"].xt-hover-pair`)
      .forEach(el => el.classList.remove('xt-hover-active', 'xt-hover-pair'))
  })
}
setupHoverDelegation()

function restore() {
  console.log('[xt:content] 还原页面')
  // Agent 8: 还原前清标注 UI（避免残留 host）
  annotationBridge.cleanup()
  injector.restore()
  alignmentCache.clear()
  pendingAlign.clear()
  scheduler?.destroy()
  scheduler = null
  mutationObserver?.disconnect()
  mutationObserver = null
  // W2-3: 清理 shadow observer + 重扫 timer
  shadowObservers.forEach(o => o.disconnect())
  shadowObservers.length = 0
  stopRescan()
  if (scrollTimer) { clearTimeout(scrollTimer); scrollTimer = null }
  // W3.2: 卸载顶栏工具条
  toolbar?.destroy()
  toolbar = null
  state = { ...state, active: false, progress: 0, translated: 0 }
  broadcastState()
}

function setMode(mode: TranslationMode) {
  // Agent 8: 切模式前清旧标注 UI（setMode 会触发 injector 重注入，UI 必须跟着重建）
  annotationBridge.cleanup()
  state.mode = mode
  // W2-3: 用缓存重注入（不再仅切 CSS 类，旧实现切类无效）
  injector.setMode(mode, state.tgtLang)
  document.body.classList.toggle('xt-bilingual', mode === 'bilingual')
  document.body.classList.toggle('xt-override', mode === 'translation-only')
  // W3.2: 同步工具条模式按钮
  toolbar?.update({ mode })
  // Agent 8: setMode 后重新给每段挂标注（用新 mode）
  reattachAnnotations()
  console.log(`[xt:content] 切换显示模式 → ${mode}`)
}

/** 重新给所有 [data-xt-tgt] 元素挂标注 UI（setMode 切换后用） */
function reattachAnnotations(): void {
  const targets = document.querySelectorAll<HTMLElement>('[data-xt-tgt]')
  for (const tgtEl of Array.from(targets)) {
    const segId = tgtEl.getAttribute('data-xt-tgt') ?? ''
    if (!segId) continue
    const translation = tgtEl.textContent ?? ''
    attachAnnotationAfterInject(segId, translation)
  }
}

// ─── SPA 支持 ─────────────────────────────────────────────
// W2-3: 抽出 handleMutations，body observer 和 shadow root observer 共用
// W4: 改用 requestIdleCallback 批量处理，避免 debounce 丢内容
let pendingMutations: MutationRecord[] = []
let mutationIdleId: number | null = null

function handleMutations(mutations: MutationRecord[]): void {
  if (!state.active) return
  pendingMutations.push(...mutations)
  if (mutationIdleId != null) cancelIdleCallback(mutationIdleId)
  mutationIdleId = requestIdleCallback(() => {
    processMutations(pendingMutations)
    pendingMutations = []
    mutationIdleId = null
  })
}

function processMutations(mutations: MutationRecord[]): void {
  const newEls: Element[] = []
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        !(node as Element).hasAttribute('data-xt-tgt')
      ) {
        newEls.push(node as Element)
      }
    }
    if (m.type === 'attributes' && m.target instanceof Element) {
      const t = m.target as Element
      if (!t.hasAttribute('data-xt-id') && !t.hasAttribute('data-xt-tgt') && !t.closest('[data-xt-id]')) {
        newEls.push(t)
      }
    }
  }
  if (newEls.length === 0) return

  // tryExtract now skips elements that already have data-xt-id,
  // so the result only contains genuinely new segments — no extra filter needed.
  const newSegments = newEls.flatMap(el => extractSegments(el, { tgtLang: state.tgtLang }))
  // 接管新发现的 shadow root
  consumeShadowRoots().forEach(attachShadowObserver)
  if (newSegments.length > 0) {
    state.total += newSegments.length
    scheduler?.register(newSegments)
    console.log(`[xt:content] SPA 新增 ${newSegments.length} 个 segment`)
  }
}

function attachShadowObserver(root: ShadowRoot): void {
  // 避免重复 attach
  if (shadowObservers.some(o => (o as unknown as { _root?: ShadowRoot })._root === root)) return
  const obs = new MutationObserver(handleMutations)
  ;(obs as unknown as { _root?: ShadowRoot })._root = root
  obs.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden'],
  })
  shadowObservers.push(obs)
  console.log('[xt:content] attached shadow root observer')
}

function observeSpa() {
  if (mutationObserver) mutationObserver.disconnect()
  mutationObserver = new MutationObserver(handleMutations)
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden'],
  })

  // W2-3: 接管首扫发现的 shadow roots
  consumeShadowRoots().forEach(attachShadowObserver)
}

// W2-3: 周期重扫兜底 —— lazy-load / shadow 后填 / iframe 后填 MutationObserver 漏的
function startRescan() {
  if (rescanTimer) clearInterval(rescanTimer)
  rescanCycles = 0
  zeroCycles = 0
  rescanTimer = setInterval(() => {
    if (!state.active) { stopRescan(); return }
    const sch = scheduler
    if (!sch) { stopRescan(); return }
    rescanCycles++
    const before = state.total
    const all = extractSegments(document.body, { tgtLang: state.tgtLang })
    // tryExtract skips elements with existing data-xt-id, so `all` only contains
    // truly new segments. Filter only by done set (not by querySelector — that was broken).
    const newSegs = all.filter(s => !sch.isDone(s.id))
    consumeShadowRoots().forEach(attachShadowObserver)
    if (newSegs.length > 0) {
      state.total += newSegs.length
      sch.register(newSegs)
      console.log(`[xt:content] rescan cycle ${rescanCycles}: +${newSegs.length} 段 (before=${before})`)
      zeroCycles = 0
    } else {
      zeroCycles++
    }
    if (rescanCycles >= 10 || zeroCycles >= 2) stopRescan()
  }, 3000)
}

function stopRescan() {
  if (rescanTimer) { clearInterval(rescanTimer); rescanTimer = null }
}

// W2-3: 滚动节流触发重扫 —— 处理极慢 lazy-load
window.addEventListener('scroll', () => {
  if (!state.active) return
  if (scrollTimer) return
  scrollTimer = setTimeout(() => {
    scrollTimer = null
    if (!state.active) return
    console.log('[xt:content] scroll triggered rescan')
    startRescan()
  }, 500)
}, { passive: true })

function broadcastState() {
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state }).catch(() => {})
}
