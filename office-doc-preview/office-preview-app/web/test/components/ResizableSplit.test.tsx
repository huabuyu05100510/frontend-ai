// 模型：claude-sonnet-4-6
// ResizableSplit — 拖拽分割面板；localStorage 持久化；键盘 ←/→/Home/End 调整
// Phase A.2: TDD test file
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { ResizableSplit } from '../../src/components/ResizableSplit'

/**
 * Helper: wrap ResizableSplit in a fixed-size container so getBoundingClientRect
 * returns real numbers and the drag math works.
 */
function renderInContainer(
  ui: React.ReactElement,
  width = 1000,
  height = 600
) {
  return render(
    <div style={{ width, height, position: 'relative' }}>
      {ui}
    </div>
  )
}

describe('ResizableSplit', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.setAttribute('data-motion', 'off')
  })

  afterEach(() => {
    cleanup()
    document.documentElement.removeAttribute('data-motion')
  })

  it('1. 默认渲染左右两个 pane，比例 50/50', () => {
    renderInContainer(
      <ResizableSplit
        storageKey="split-default-1"
        second={<div>secondary content</div>}
      >
        <div>primary content</div>
      </ResizableSplit>
    )
    const split = screen.getByTestId('oa-split')
    expect(split).toBeTruthy()
    expect(split.classList.contains('oa-split-horizontal')).toBe(true)
    expect(screen.getByTestId('oa-split-pane-primary').textContent).toContain('primary content')
    expect(screen.getByTestId('oa-split-pane-secondary').textContent).toContain('secondary content')
    expect(screen.getByTestId('oa-split-handle').getAttribute('aria-valuenow')).toBe('50')
    // In jsdom (rect=0×0), the component falls back to percentage: 50% of container.
    // React normalizes trailing zeros, so we accept '50%', '50.0000%', or (in a real browser) '500px'.
    const primary = screen.getByTestId('oa-split-pane-primary') as HTMLElement
    const basis = primary.style.flexBasis
    const is50Percent = basis === '50%' || basis === '50.0000%' || basis === '500px'
    expect(is50Percent).toBe(true)
  })

  it('2. 拖拽 handle 改变 primary pane 宽度（x 从 500 → 400，ratio=0.4）', () => {
    renderInContainer(
      <ResizableSplit
        storageKey="split-drag-1"
        second={<div>S</div>}
      >
        <div>P</div>
      </ResizableSplit>
    )
    const split = screen.getByTestId('oa-split')
    // Stub getBoundingClientRect on the split container so pointer math works.
    split.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 600,
        width: 1000,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect

    const handle = screen.getByTestId('oa-split-handle')
    // mousedown at x=500 → start drag (use mouseDown — jsdom doesn't ship PointerEvent)
    fireEvent.mouseDown(handle, { clientX: 500, clientY: 300, button: 0 })
    // mousemove to x=400 → ratio should be 0.4
    fireEvent.mouseMove(window, { clientX: 400, clientY: 300 })
    fireEvent.mouseUp(window, { clientX: 400, clientY: 300 })

    const primary = screen.getByTestId('oa-split-pane-primary') as HTMLElement
    // 0.4 * 1000 = 400px (allow 2px flex tolerance)
    expect(primary.style.flexBasis).toBe('400px')
    expect(screen.getByTestId('oa-split-handle').getAttribute('aria-valuenow')).toBe('40')
  })

  it('3. 拖拽后比例持久化到 localStorage；unmount/remount 后从 storage 恢复', async () => {
    const storageKey = 'split-persist-1'
    // First mount — drag to 0.4
    const { unmount } = renderInContainer(
      <ResizableSplit storageKey={storageKey} second={<div>S</div>}>
        <div>P</div>
      </ResizableSplit>
    )
    const split = screen.getByTestId('oa-split')
    split.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    const handle = screen.getByTestId('oa-split-handle')
    fireEvent.mouseDown(handle, { clientX: 500, clientY: 300, button: 0 })
    fireEvent.mouseMove(window, { clientX: 400, clientY: 300 })
    fireEvent.mouseUp(window, { clientX: 400, clientY: 300 })
    // Verify it was saved
    expect(localStorage.getItem(storageKey)).toBe('0.4')
    unmount()

    // Second mount — should restore to 0.4
    renderInContainer(
      <ResizableSplit storageKey={storageKey} second={<div>S</div>}>
        <div>P</div>
      </ResizableSplit>
    )
    const split2 = screen.getByTestId('oa-split')
    split2.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    // Force a re-measure now that the stub is in place
    ;(window as unknown as { __oaSplitResync?: () => void }).__oaSplitResync?.()
    // aria-valuenow is set synchronously from ratio state on every render
    expect(screen.getByTestId('oa-split-handle').getAttribute('aria-valuenow')).toBe('40')
    // Pixel basis is set asynchronously by the measurement useEffect → waitFor
    await waitFor(() => {
      const primary = screen.getByTestId('oa-split-pane-primary') as HTMLElement
      expect(primary.style.flexBasis).toBe('400px')
    })
  })

  it('4. 键盘 ← 调整 ratio（默认步长 0.02，从 0.5 → 0.48）', () => {
    renderInContainer(
      <ResizableSplit storageKey="split-kb-arrow" second={<div>S</div>}>
        <div>P</div>
      </ResizableSplit>
    )
    const split = screen.getByTestId('oa-split')
    split.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    const handle = screen.getByTestId('oa-split-handle')
    handle.focus()
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    const primary = screen.getByTestId('oa-split-pane-primary') as HTMLElement
    expect(primary.style.flexBasis).toBe('480px')
    expect(screen.getByTestId('oa-split-handle').getAttribute('aria-valuenow')).toBe('48')
  })

  it('5. 键盘 Home 跳到 minRatio', () => {
    renderInContainer(
      <ResizableSplit storageKey="split-kb-home" minRatio={0.2} second={<div>S</div>}>
        <div>P</div>
      </ResizableSplit>
    )
    const split = screen.getByTestId('oa-split')
    split.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    const handle = screen.getByTestId('oa-split-handle')
    handle.focus()
    fireEvent.keyDown(handle, { key: 'Home' })
    const primary = screen.getByTestId('oa-split-pane-primary') as HTMLElement
    expect(primary.style.flexBasis).toBe('200px')
    expect(screen.getByTestId('oa-split-handle').getAttribute('aria-valuenow')).toBe('20')
  })

  it('6. 键盘 End 跳到 maxRatio', () => {
    renderInContainer(
      <ResizableSplit storageKey="split-kb-end" maxRatio={0.8} second={<div>S</div>}>
        <div>P</div>
      </ResizableSplit>
    )
    const split = screen.getByTestId('oa-split')
    split.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    const handle = screen.getByTestId('oa-split-handle')
    handle.focus()
    fireEvent.keyDown(handle, { key: 'End' })
    const primary = screen.getByTestId('oa-split-pane-primary') as HTMLElement
    expect(primary.style.flexBasis).toBe('800px')
    expect(screen.getByTestId('oa-split-handle').getAttribute('aria-valuenow')).toBe('80')
  })

  it('7. vertical 方向交换轴（top/bottom 而非 left/right）', () => {
    renderInContainer(
      <ResizableSplit storageKey="split-vertical" direction="vertical" second={<div>bottom pane</div>}>
        <div>top pane</div>
      </ResizableSplit>
    )
    const split = screen.getByTestId('oa-split')
    expect(split.classList.contains('oa-split-vertical')).toBe(true)
    expect(split.classList.contains('oa-split-horizontal')).toBe(false)
    // Verify handle's aria-orientation is horizontal (perpendicular to vertical split)
    expect(screen.getByTestId('oa-split-handle').getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('8. ratio 被 clamp 到 [minRatio, maxRatio]', () => {
    renderInContainer(
      <ResizableSplit storageKey="split-clamp" minRatio={0.3} maxRatio={0.7} second={<div>S</div>}>
        <div>P</div>
      </ResizableSplit>
    )
    const split = screen.getByTestId('oa-split')
    split.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    const handle = screen.getByTestId('oa-split-handle')
    // Try to drag far left → should clamp to minRatio=0.3
    fireEvent.mouseDown(handle, { clientX: 500, clientY: 300, button: 0 })
    fireEvent.mouseMove(window, { clientX: 50, clientY: 300 })
    fireEvent.mouseUp(window, { clientX: 50, clientY: 300 })
    let primary = screen.getByTestId('oa-split-pane-primary') as HTMLElement
    expect(primary.style.flexBasis).toBe('300px')
    // Try to drag far right → should clamp to maxRatio=0.7
    fireEvent.mouseDown(handle, { clientX: 500, clientY: 300, button: 0 })
    fireEvent.mouseMove(window, { clientX: 950, clientY: 300 })
    fireEvent.mouseUp(window, { clientX: 950, clientY: 300 })
    primary = screen.getByTestId('oa-split-pane-primary') as HTMLElement
    expect(primary.style.flexBasis).toBe('700px')
  })

  it('9. onRatioChange 在 ratio 变化时被调用', () => {
    const onRatioChange = vi.fn()
    renderInContainer(
      <ResizableSplit storageKey="split-cb" onRatioChange={onRatioChange} second={<div>S</div>}>
        <div>P</div>
      </ResizableSplit>
    )
    const handle = screen.getByTestId('oa-split-handle')
    handle.focus()
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(onRatioChange).toHaveBeenCalled()
    // Should be called with 0.52 (0.5 + 0.02)
    expect(onRatioChange).toHaveBeenLastCalledWith(0.52)
  })

  it('10. reduced-motion 守卫：data-motion="off" 时 handle 仍然存在（CSS 仍允许 transition）', () => {
    // Per plan A.7: ResizableSplit 的 hover 视觉过渡是非常短的背景色变化 (0.15s)，
    // 遵循 reduced-motion 时 CSS 静态规则会进一步弱化，但 handle 元素依然渲染并可用。
    document.documentElement.setAttribute('data-motion', 'off')
    renderInContainer(
      <ResizableSplit storageKey="split-rm" second={<div>S</div>}>
        <div>P</div>
      </ResizableSplit>
    )
    const handle = screen.getByTestId('oa-split-handle')
    expect(handle).toBeTruthy()
    // The handle should still be focusable for keyboard interaction
    expect(handle.getAttribute('tabindex')).toBe('0')
    // ARIA separator role intact
    expect(handle.getAttribute('role')).toBe('separator')
  })
})