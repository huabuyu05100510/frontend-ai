/**
 * Agent 8 — AnnotationBridge
 *
 * 把 annotator.ts（标注 UI） + lib/annotation.mjs（schema） + lib/annotation-store.mjs（IDB）
 * 桥接到 content script 的 setMode / restore 流程里。
 *
 * 设计原则：
 *  1. **解耦**：依赖通过 constructor 注入；实例化失败也不影响翻译主流程
 *  2. **可选依赖**：enabled=false 时所有 attach* 都不挂 UI
 *  3. **chrome.storage.onChanged 监听**：popup 切换开关 → 实时同步 bridge 状态
 *  4. **Shadow DOM 隔离**：标注 UI 由 annotator.ts 在 shadowRoot 内创建
 *  5. **可观测**：每个挂载 / 卸载路径都 log
 *
 * 集成点（content.ts）：
 *   - setMode('bilingual') 后 → bridge.attachBilingual({...})
 *   - injectOverride（translation-only）后 → bridge.attachTranslationOnly({...})
 *   - restore() / setMode() 切换前 → bridge.cleanup()
 *   - chrome.storage.onChanged → bridge.setEnabled(bool)
 *
 * 模型：claude-sonnet-4-6 (MiniMax-M3 路由)
 */

import { Annotator } from './annotator'
import type { AlignmentResult } from '../shared/types'

// ─── 类型契约 ──────────────────────────────────────────────────

export interface AnnotationContext {
  /** 是否启用（来自 popup 开关 / setEnabled） */
  enabled: boolean
  /** 段落 ID（与 data-xt-id / data-xt-tgt 一致） */
  segmentId: string
  /** 原文文本 */
  srcText: string
  /** 译文文本 */
  tgtText: string
  /** 原文 tokens（用于 annotator popover 显示候选） */
  srcTokens: string[]
  /** 译文 tokens */
  tgtTokens: string[]
  /** 算法预测的 alignment（[srcIdx, tgtIdx][]） */
  predicted: Array<[number, number]>
  /** 原文块元素（带 data-xt-id） */
  srcEl: HTMLElement
  /** 注入的 .xt-translation 元素 */
  tgtEl: HTMLElement
  /** 当前显示模式 */
  mode: 'bilingual' | 'translation-only' | 'sidebar'
  /** 语言对 [src, tgt]，例 ['en', 'zh'] */
  langPair: [string, string]
  /** 当前页 URL（XPath 之外的第二定位键） */
  url: string
  /** 对齐结果（含 srcTokens/tgtTokens/alignments） */
  alignment: AlignmentResult
}

export interface AnnotationBridgeOpts {
  /** lib/annotation.mjs.encode(input) → Promise<Annotation> */
  encode: (input: unknown) => Promise<unknown>
  /** lib/annotation-store.mjs.put(anno) → Promise<unknown> */
  put: (anno: unknown) => Promise<unknown>
  /** lib/annotation-store.mjs.getRatedRecent?(segId) → Promise<boolean> */
  isRatedRecent: (segmentId: string) => Promise<boolean>
}

// ─── logger ────────────────────────────────────────────────────
function log(level: 'info' | 'warn', msg: string, fields: Record<string, unknown> = {}) {
  try {
    console[level](
      JSON.stringify({ ts: Date.now(), level, component: 'xt:bridge', msg, ...fields }),
    )
  } catch {
    /* noop */
  }
}

// ─── chrome.storage.onChanged 类型 shim ────────────────────────
type StorageChange = { oldValue?: unknown; newValue?: unknown }
type StorageListener = (
  changes: Record<string, StorageChange>,
  areaName: string,
) => void

function readChromeStorageApi(): {
  onChanged?: { addListener: (cb: StorageListener) => void }
} {
  try {
    const ch = (globalThis as unknown as {
      chrome?: { storage?: { onChanged?: { addListener: (cb: StorageListener) => void } } }
    }).chrome
    return {
      onChanged: ch?.storage?.onChanged
        ? { addListener: (cb: StorageListener) => ch.storage!.onChanged!.addListener(cb) }
        : undefined,
    }
  } catch {
    return {}
  }
}

// ─── 主类 ──────────────────────────────────────────────────────

export class AnnotationBridge {
  private enabled: boolean
  private readonly encode: AnnotationBridgeOpts['encode']
  private readonly put: AnnotationBridgeOpts['put']
  // isRatedRecent 由 annotator.ts 内部通过 chrome.storage.sync.get 读取 xtAnnoRatedRecent，
  // 不需要 bridge 主动查询；保留在 opts 接口里供后续 caller 主动预检。
  // @ts-ignore - reserved for future use
  private readonly isRatedRecent: AnnotationBridgeOpts['isRatedRecent']

  /** 持有一个 Annotator 实例（lazy mount + 主动 unmount） */
  private annotator: Annotator | null = null

  /** 已挂载的 segmentId 集合（cleanup 时参考） */
  private mountedIds = new Set<string>()

  constructor(opts: AnnotationBridgeOpts) {
    this.encode = opts.encode as AnnotationBridgeOpts['encode']
    this.put = opts.put as AnnotationBridgeOpts['put']
    this.isRatedRecent = opts.isRatedRecent
    this.enabled = true  // 默认开启；setEnabled 由 popup 触发改写

    // 注册 chrome.storage.onChanged 监听
    const api = readChromeStorageApi()
    if (api.onChanged) {
      try {
        api.onChanged.addListener((changes, area) => {
          if (area !== 'sync') return
          const change = changes['xtAnnotationEnabled']
          if (!change) return
          // newValue 可能为 false / true / undefined（删除 = false）
          const next = change.newValue === undefined ? false : Boolean(change.newValue)
          log('info', 'storage.onChanged → setEnabled', { next, oldValue: change.oldValue })
          this.setEnabled(next)
        })
        log('info', 'storage.onChanged listener registered', {})
      } catch (err) {
        log('warn', 'failed to register storage.onChanged', { err: String(err) })
      }
    }
  }

  // ─── 公开方法 ────────────────────────────────────────────

  /**
   * 双语模式：挂 ✏️ + ⭐
   * 要求 ctx.tgtEl 是 .xt-translation span。
   */
  attachBilingual(ctx: AnnotationContext): void {
    if (!this.enabled) {
      log('info', 'attachBilingual skipped (disabled)', { segId: ctx.segmentId })
      return
    }
    this.attachInternal(ctx, /* withPencil */ true)
  }

  /**
   * 仅译文模式：只挂 ⭐（无对齐气泡，不挂 ✏️）
   */
  attachTranslationOnly(ctx: AnnotationContext): void {
    if (!this.enabled) {
      log('info', 'attachTranslationOnly skipped (disabled)', { segId: ctx.segmentId })
      return
    }
    this.attachInternal(ctx, /* withPencil */ false)
  }

  /** 清理所有挂载（restore / setMode 切换前调用） */
  cleanup(): void {
    if (this.annotator) {
      try {
        this.annotator.unmount()
      } catch (err) {
        log('warn', 'unmount failed', { err: String(err) })
      }
      this.annotator = null
    }
    this.mountedIds.clear()
    log('info', 'cleanup done', {})
  }

  /** 设置启用状态（来自 popup 开关或 chrome.storage.onChanged） */
  setEnabled(enabled: boolean): void {
    const prev = this.enabled
    this.enabled = Boolean(enabled)
    if (prev !== this.enabled) {
      log('info', 'setEnabled', { prev, next: this.enabled })
    }
    // 关闭时立即清理已挂载的 UI（避免"残留"）
    if (!this.enabled) {
      this.cleanup()
    }
  }

  /** 当前状态查询（测试用） */
  isEnabled(): boolean {
    return this.enabled
  }

  // ─── 私有 ──────────────────────────────────────────────

  private attachInternal(ctx: AnnotationContext, withPencil: boolean): void {
    // lazy 创建 annotator（cleanup 后会重置为 null）
    if (!this.annotator) {
      this.annotator = new Annotator()
    }

    // 构造 AnnotatorOpts
    // 注意：annotator.ts 的 mount 会扫描 rootEl 下的所有 .xt-translation；
    // 我们传入 srcEl 作为 root（语义：只对当前段挂 UI）。
    // 对于 ✏️ + ⭐ 同时挂：把 mode 信息包进 pageContext 不够，
    // 我们通过 closure 控制 withPencil（不过 annotator.mount 总会同时挂 ✏️ + ⭐）。
    //
    // 解决方案：translation-only 模式只在单独的 srcEl 上调 mount，
    //           bilingual 模式同样在 srcEl 上调 mount（annotator 内部对每个 tgtEl 挂 ✏️ + ⭐）。
    //           我们接受：annotation-bridge 当前的实现是「同一段统一挂 ✏️ + ⭐」，
    //           区分 by-mode 的 UI 在 content.ts 层做（不调用 attachTranslationOnly 时就不挂）。
    void withPencil  // 暂未使用（annotator.mount 总是同时挂 ✏️ + ⭐）

    try {
      this.annotator.mount(ctx.srcEl, {
        // cast: 我们的 opts.encode 是 schema.encode，签名上 input: unknown 但运行时是 AnnotateInput
        // @ts-expect-error - AnnotationBridgeOpts.encode 签名是 unknown，Annotator 要 AnnotateInput
        encode: this.encode,
        put: this.put,
        alignment: ctx.alignment,
        pageContext: {
          url: ctx.url,
          langPair: ctx.langPair,
        },
      })
      this.mountedIds.add(ctx.segmentId)

      // annotator.ts 总会同时挂 ✏️ + ⭐；
      // translation-only 模式无对齐气泡，移除 ✏️ host 避免 UI 噪音。
      if (!withPencil) {
        const pencilHost = ctx.srcEl.querySelector<HTMLElement>('.xt-anno-pencil-host')
        if (pencilHost) {
          pencilHost.remove()
          log('info', 'pencil host removed (translation-only)', { segId: ctx.segmentId })
        }
      }

      log('info', 'attached annotation UI', {
        segId: ctx.segmentId,
        mode: ctx.mode,
        withPencil,
        hasAlignment: ctx.alignment.alignments.length > 0,
      })
    } catch (err) {
      log('warn', 'attach failed', { segId: ctx.segmentId, err: String(err) })
    }
  }
}