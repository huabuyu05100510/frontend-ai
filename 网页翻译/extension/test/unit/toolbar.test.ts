/**
 * TranslationToolbar 单元测试（vitest + jsdom）
 *
 * 覆盖：
 * - mount 幂等性
 * - update 进度 / 模式 / 激活状态
 * - 模式切换（双语 → 仅译文 → 侧栏 → 双语）
 * - 还原回调
 * - 关闭回调
 * - destroy 卸载
 *
 * 模型：Claude (Sonnet 4.5)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TranslationToolbar, isToolbarMounted } from '../../src/content/toolbar'

beforeEach(() => {
  // 工具条挂到 documentElement，不是 body — body 清空不够
  document.documentElement.innerHTML = '<head></head><body></body>'
})

function makeActions() {
  return {
    onModeChange: vi.fn(),
    onRestore: vi.fn(),
    onClose: vi.fn(),
  }
}

describe('TranslationToolbar — 挂载与卸载', () => {
  it('mount() 创建 shadow DOM 工具条', () => {
    const bar = new TranslationToolbar(makeActions())
    const host = bar.mount()

    expect(host.id).toBe('xt-toolbar-host')
    expect(isToolbarMounted()).toBe(true)
    // shadow root 内有 .bar
    expect(host.shadowRoot?.querySelector('.bar')).toBeTruthy()
    // 关键控件都在
    const sr = host.shadowRoot!
    expect(sr.getElementById('xt-tb-mode')).toBeTruthy()
    expect(sr.getElementById('xt-tb-restore')).toBeTruthy()
    expect(sr.getElementById('xt-tb-close')).toBeTruthy()
    expect(sr.getElementById('xt-tb-progress-fill')).toBeTruthy()
  })

  it('重复 mount() 返回同一个 host，不重复创建', () => {
    const bar = new TranslationToolbar(makeActions())
    const a = bar.mount()
    const b = bar.mount()
    expect(a).toBe(b)
    expect(document.querySelectorAll('#xt-toolbar-host').length).toBe(1)
  })

  it('destroy() 移除 host，再次 mount 可重建', () => {
    const bar = new TranslationToolbar(makeActions())
    bar.mount()
    bar.destroy()
    expect(isToolbarMounted()).toBe(false)
    expect(bar.isMounted()).toBe(false)

    const host = bar.mount()
    expect(isToolbarMounted()).toBe(true)
    expect(host.shadowRoot).toBeTruthy()
  })
})

describe('TranslationToolbar — 状态更新', () => {
  it('update(progress) 更新进度条宽度', () => {
    const bar = new TranslationToolbar(makeActions())
    const host = bar.mount()
    bar.update({ progress: 42, translated: 4, total: 10, active: true })

    const fill = host.shadowRoot!.getElementById('xt-tb-progress-fill') as HTMLElement
    expect(fill.style.width).toBe('42%')

    const pct = host.shadowRoot!.getElementById('xt-tb-progress-pct')
    expect(pct?.textContent).toBe('42%')

    const label = host.shadowRoot!.getElementById('xt-tb-progress-label')
    expect(label?.textContent).toBe('4/10')
  })

  it('未激活状态：标签显示 "待翻译"', () => {
    const bar = new TranslationToolbar(makeActions())
    const host = bar.mount()
    bar.update({ active: false, progress: 0 })
    const label = host.shadowRoot!.getElementById('xt-tb-progress-label')
    expect(label?.textContent).toBe('待翻译')
  })

  it('update(mode) 更新模式按钮文本', () => {
    const bar = new TranslationToolbar(makeActions())
    const host = bar.mount()
    bar.update({ mode: 'translation-only' })
    const modeBtn = host.shadowRoot!.getElementById('xt-tb-mode')
    expect(modeBtn?.textContent).toBe('仅译文')
    expect(modeBtn?.getAttribute('data-mode')).toBe('translation-only')
  })

  it('update(mode=sidebar) 显示 "侧栏"', () => {
    const bar = new TranslationToolbar(makeActions())
    const host = bar.mount()
    bar.update({ mode: 'sidebar' })
    const modeBtn = host.shadowRoot!.getElementById('xt-tb-mode')
    expect(modeBtn?.textContent).toBe('侧栏')
  })

  it('未激活时还原按钮禁用，激活后启用', () => {
    const bar = new TranslationToolbar(makeActions())
    const host = bar.mount()
    const restore = host.shadowRoot!.getElementById('xt-tb-restore') as HTMLButtonElement
    expect(restore.disabled).toBe(true)
    bar.update({ active: true })
    expect(restore.disabled).toBe(false)
  })
})

describe('TranslationToolbar — 交互回调', () => {
  it('点击模式按钮循环切换双语 → 仅译文 → 侧栏 → 双语', () => {
    const actions = makeActions()
    const bar = new TranslationToolbar(actions)
    const host = bar.mount()

    host.shadowRoot!.getElementById('xt-tb-mode')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    expect(actions.onModeChange).toHaveBeenLastCalledWith('translation-only')

    host.shadowRoot!.getElementById('xt-tb-mode')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    expect(actions.onModeChange).toHaveBeenLastCalledWith('sidebar')

    host.shadowRoot!.getElementById('xt-tb-mode')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    expect(actions.onModeChange).toHaveBeenLastCalledWith('bilingual')

    expect(actions.onModeChange).toHaveBeenCalledTimes(3)
  })

  it('点击还原按钮调用 onRestore', () => {
    const actions = makeActions()
    const bar = new TranslationToolbar(actions)
    const host = bar.mount()
    bar.update({ active: true })

    host.shadowRoot!.getElementById('xt-tb-restore')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    expect(actions.onRestore).toHaveBeenCalledTimes(1)
  })

  it('点击关闭按钮调用 onClose', () => {
    const actions = makeActions()
    const bar = new TranslationToolbar(actions)
    const host = bar.mount()

    host.shadowRoot!.getElementById('xt-tb-close')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    expect(actions.onClose).toHaveBeenCalledTimes(1)
  })
})

describe('TranslationToolbar — getState', () => {
  it('返回当前 state 拷贝', () => {
    const bar = new TranslationToolbar(makeActions())
    bar.mount()
    bar.update({ mode: 'sidebar', translated: 5, total: 10, progress: 50, active: true })

    const s = bar.getState()
    expect(s.mode).toBe('sidebar')
    expect(s.translated).toBe(5)
    expect(s.total).toBe(10)
    expect(s.progress).toBe(50)
    expect(s.active).toBe(true)
  })
})