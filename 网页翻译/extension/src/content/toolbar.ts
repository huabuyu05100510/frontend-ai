/**
 * 顶栏工具条（沉浸式翻译风格）
 *
 * 设计要点：
 * - Shadow DOM 完全隔离样式，不污染宿主页
 * - 固定在视口顶部（top:0），40px 高，半透明白底 + 8px 模糊
 * - 4 个交互：进度条、模式切换、还原当前段、全部还原
 * - 通过 chrome.runtime.sendMessage 与 background/popup 通讯
 *
 * 模型：Claude (Sonnet 4.5)
 */

import type { TranslationMode } from '../shared/types'

export interface ToolbarState {
  /** 当前模式（双语 / 仅译文 / 侧栏） */
  mode: TranslationMode
  /** 已翻译段数 */
  translated: number
  /** 总段数 */
  total: number
  /** 0-100 进度 */
  progress: number
  /** 翻译是否激活 */
  active: boolean
}

export interface ToolbarActions {
  /** 切换显示模式 */
  onModeChange: (mode: TranslationMode) => void
  /** 还原当前页 */
  onRestore: () => void
  /** 关闭工具条 */
  onClose: () => void
}

const TOOLBAR_HOST_ID = 'xt-toolbar-host'

/** 顶栏工具条控制器 */
export class TranslationToolbar {
  private host: HTMLElement | null = null
  private shadow: ShadowRoot | null = null
  private state: ToolbarState = {
    mode: 'bilingual',
    translated: 0,
    total: 0,
    progress: 0,
    active: false,
  }

  constructor(private actions: ToolbarActions) {}

  /** 幂等挂载。重复调用安全。 */
  mount(): HTMLElement {
    if (this.host) return this.host

    this.host = document.createElement('div')
    this.host.id = TOOLBAR_HOST_ID
    this.shadow = this.host.attachShadow({ mode: 'open' })
    this.shadow.innerHTML = this.renderHTML()

    // 事件绑定
    this.shadow.getElementById('xt-tb-mode')!.addEventListener('click', () =>
      this.cycleMode(),
    )
    this.shadow.getElementById('xt-tb-restore')!.addEventListener('click', () =>
      this.actions.onRestore(),
    )
    this.shadow.getElementById('xt-tb-close')!.addEventListener('click', () =>
      this.actions.onClose(),
    )

    if (document.documentElement) {
      document.documentElement.appendChild(this.host)
    }
    this.applyState()
    return this.host
  }

  /** 更新状态（不重建 DOM） */
  update(partial: Partial<ToolbarState>): void {
    this.state = { ...this.state, ...partial }
    this.applyState()
  }

  /** 卸载工具条 */
  destroy(): void {
    if (this.host) {
      this.host.remove()
      this.host = null
      this.shadow = null
    }
  }

  /** 当前是否挂载 */
  isMounted(): boolean {
    return this.host !== null
  }

  /** 当前状态 */
  getState(): ToolbarState {
    return { ...this.state }
  }

  private cycleMode(): void {
    const order: TranslationMode[] = ['bilingual', 'translation-only', 'sidebar']
    const idx = order.indexOf(this.state.mode)
    const next = order[(idx + 1) % order.length]
    this.update({ mode: next })
    this.actions.onModeChange(next)
  }

  private applyState(): void {
    if (!this.shadow) return
    const root = this.shadow

    // 进度条
    const fill = root.getElementById('xt-tb-progress-fill')
    const pct = root.getElementById('xt-tb-progress-pct')
    const label = root.getElementById('xt-tb-progress-label')
    if (fill) fill.style.width = `${this.state.progress}%`
    if (pct) pct.textContent = `${this.state.progress}%`
    if (label) {
      label.textContent = this.state.active
        ? `${this.state.translated}/${this.state.total}`
        : '待翻译'
    }

    // 模式按钮文本
    const modeBtn = root.getElementById('xt-tb-mode')
    if (modeBtn) {
      const labelMap: Record<TranslationMode, string> = {
        bilingual: '双语',
        'translation-only': '仅译文',
        sidebar: '侧栏',
      }
      modeBtn.textContent = labelMap[this.state.mode]
      modeBtn.setAttribute('data-mode', this.state.mode)
    }

    // 还原按钮可用性
    const restoreBtn = root.getElementById('xt-tb-restore') as HTMLButtonElement | null
    if (restoreBtn) restoreBtn.disabled = !this.state.active
  }

  private renderHTML(): string {
    return `
      <style>
        :host { all: initial; }
        *, *::before, *::after { box-sizing: border-box; }
        .bar {
          position: fixed;
          top: 0; left: 0; right: 0;
          height: 40px;
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
          z-index: 2147483646;
          display: flex;
          align-items: center;
          padding: 0 12px;
          gap: 10px;
          font: 13px/1 -apple-system, system-ui, 'Segoe UI', 'PingFang SC', sans-serif;
          color: #111827;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
          animation: xt-tb-slidein .2s cubic-bezier(.2,.7,.3,1);
        }
        @keyframes xt-tb-slidein {
          from { transform: translateY(-100%); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        .brand {
          display: inline-flex; align-items: center; gap: 6px;
          font-weight: 600; color: #2563eb;
          font-size: 13px;
          user-select: none;
        }
        .brand .dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: linear-gradient(135deg, #2563eb, #3b82f6);
        }
        .progress {
          flex: 1;
          display: flex; align-items: center; gap: 8px;
          min-width: 120px;
        }
        .progress-track {
          flex: 1; height: 4px; background: #e5e7eb;
          border-radius: 2px; overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #2563eb, #60a5fa);
          width: 0;
          transition: width 0.3s cubic-bezier(.4,0,.2,1);
        }
        .progress-label {
          font-variant-numeric: tabular-nums;
          font-size: 12px;
          color: #6b7280;
          min-width: 64px;
          text-align: right;
        }
        .progress-pct {
          font-variant-numeric: tabular-nums;
          font-size: 12px;
          color: #2563eb;
          font-weight: 600;
          min-width: 36px;
          text-align: right;
        }
        .btn {
          padding: 5px 10px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: #fff;
          cursor: pointer;
          font-size: 12px;
          color: #374151;
          transition: background-color .15s, border-color .15s, transform .12s;
          font-family: inherit;
        }
        .btn:hover:not(:disabled) {
          background: #f3f4f6;
          border-color: #9ca3af;
        }
        .btn:active:not(:disabled) { transform: translateY(1px); }
        .btn:disabled { opacity: .5; cursor: not-allowed; }
        .btn.primary {
          background: #2563eb;
          color: #fff;
          border-color: #2563eb;
        }
        .btn.primary:hover:not(:disabled) {
          background: #1d4ed8;
          border-color: #1d4ed8;
        }
        .btn.icon {
          width: 28px; height: 28px;
          padding: 0;
          display: inline-flex;
          align-items: center; justify-content: center;
          color: #6b7280;
        }
        .btn.icon:hover:not(:disabled) {
          color: #111827;
          background: #f3f4f6;
        }
        .btn svg { width: 14px; height: 14px; pointer-events: none; }

        @media (prefers-color-scheme: dark) {
          .bar {
            background: rgba(17, 24, 39, 0.95);
            border-bottom-color: rgba(255, 255, 255, 0.08);
            color: #e5e7eb;
          }
          .brand { color: #93c5fd; }
          .progress-track { background: #374151; }
          .progress-label { color: #9ca3af; }
          .btn {
            background: #1f2937;
            border-color: #374151;
            color: #e5e7eb;
          }
          .btn:hover:not(:disabled) { background: #374151; border-color: #4b5563; }
          .btn.icon { color: #9ca3af; }
          .btn.icon:hover:not(:disabled) { color: #e5e7eb; }
        }
        @media print {
          :host { display: none !important; }
        }
      </style>
      <div class="bar" role="toolbar" aria-label="翻译工具条">
        <span class="brand"><span class="dot"></span>智能翻译</span>
        <div class="progress">
          <div class="progress-track">
            <div class="progress-fill" id="xt-tb-progress-fill"></div>
          </div>
          <span class="progress-label" id="xt-tb-progress-label">待翻译</span>
          <span class="progress-pct" id="xt-tb-progress-pct">0%</span>
        </div>
        <button class="btn" id="xt-tb-mode" type="button" title="切换显示模式">双语</button>
        <button class="btn" id="xt-tb-restore" type="button" title="还原原文" disabled>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 8a5 5 0 1 0 1.5-3.5L3 6"/>
            <path d="M3 3v3h3"/>
          </svg>
        </button>
        <button class="btn icon" id="xt-tb-close" type="button" title="关闭工具条" aria-label="关闭">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <path d="M4 4 L12 12 M12 4 L4 12"/>
          </svg>
        </button>
      </div>
    `
  }
}

/** 工具条是否已挂载（content script 用） */
export function isToolbarMounted(): boolean {
  return document.getElementById(TOOLBAR_HOST_ID) !== null
}