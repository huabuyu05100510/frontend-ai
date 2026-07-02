// 模型：claude-sonnet-4-6
// ResizableSplit — 拖拽分割面板原语
// Phase A.2: 支持 horizontal/vertical 方向；localStorage 持久化；键盘 ←/→/Home/End 调整
// CSS 走 .oa-split-* 语义化类（详见 styles.css 末尾区块），不引入内联 hex。
// 观测日志：console.info('[translate-ui ISO] split drag|keyboard taskId=… ratio=…')

import {
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  CSSProperties,
} from 'react'

export type SplitDirection = 'horizontal' | 'vertical'

export interface ResizableSplitProps {
  /** Unique storage key — derived from taskId+role by caller (e.g. `translate-doc-review-${taskId}`) */
  storageKey: string
  /** Direction: 'horizontal' = left/right (default for doc translate), 'vertical' = top/bot */
  direction?: SplitDirection
  /** Initial ratio: 0..1, where 0.5 = 50/50. Default 0.5 */
  initialRatio?: number
  /** Min ratio (default 0.15 = no pane smaller than 15%) */
  minRatio?: number
  /** Max ratio (default 0.85) */
  maxRatio?: number
  /** Keyboard adjustment step. Default 0.02 */
  step?: number
  /** Left/Top pane (when horizontal: left; when vertical: top) */
  children: ReactNode
  /** Right/Bottom pane */
  second: ReactNode
  /** Optional className on outer container */
  className?: string
  /** Called whenever ratio changes */
  onRatioChange?: (ratio: number) => void
}

const DEFAULT_MIN = 0.15
const DEFAULT_MAX = 0.85
const DEFAULT_STEP = 0.02
const DEFAULT_RATIO = 0.5

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

function isMotionOff(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.getAttribute('data-motion') === 'off'
}

function logDrag(storageKey: string, ratio: number) {
  const ts = new Date().toISOString()
  // Per A.6: 包含 taskId（这里用 storageKey 作 fallback，因为调用方可编码 taskId）
  console.info(`[translate-ui ${ts}] split drag taskId=${storageKey} ratio=${ratio.toFixed(3)}`)
}

function logKeyboard(storageKey: string, ratio: number, key: string) {
  const ts = new Date().toISOString()
  console.info(`[translate-ui ${ts}] split keyboard taskId=${storageKey} key=${key} ratio=${ratio.toFixed(3)}`)
}

export function ResizableSplit({
  storageKey,
  direction = 'horizontal',
  initialRatio = DEFAULT_RATIO,
  minRatio = DEFAULT_MIN,
  maxRatio = DEFAULT_MAX,
  step = DEFAULT_STEP,
  children,
  second,
  className,
  onRatioChange,
}: ResizableSplitProps) {
  // Defensive clamp of bounds — caller could pass minRatio > maxRatio by mistake
  const safeMin = Math.min(minRatio, maxRatio)
  const safeMax = Math.max(minRatio, maxRatio)

  const [ratio, setRatioState] = useState<number>(() => {
    // Hydrate from localStorage if present
    if (typeof window === 'undefined') return clamp(initialRatio, safeMin, safeMax)
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw !== null) {
        const parsed = Number(raw)
        if (Number.isFinite(parsed)) {
          return clamp(parsed, safeMin, safeMax)
        }
      }
    } catch {
      // localStorage may be unavailable (private mode, quota); fall through
    }
    return clamp(initialRatio, safeMin, safeMax)
  })

  // Persist + notify on ratio change (skip the very first render)
  const isFirstRun = useRef(true)
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false
      return
    }
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, String(ratio))
      }
    } catch {
      /* ignore quota / private mode */
    }
    onRatioChange?.(ratio)
  }, [ratio, storageKey, onRatioChange])

  // Keep a stable ref to the outer container so pointer math can read its bounds
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Track pointer-drag session so we can attach global move/up listeners
  const draggingRef = useRef(false)

  // Set ratio with clamping — also writes log via console.info on user-initiated changes
  const setRatio = useCallback(
    (next: number, log: { kind: 'drag' | 'keyboard'; key?: string }) => {
      setRatioState(prev => {
        const clamped = clamp(next, safeMin, safeMax)
        if (clamped === prev) return prev
        if (log.kind === 'drag') logDrag(storageKey, clamped)
        else logKeyboard(storageKey, clamped, log.key ?? '')
        return clamped
      })
    },
    [safeMin, safeMax, storageKey]
  )

  const startDrag = useCallback(
    (e: { pointerType?: string; button?: number; pointerId?: number; currentTarget?: EventTarget | null }) => {
      // Only left mouse button / primary touch / pen.
      // Note: jsdom doesn't ship PointerEvent, so e.pointerType / e.button
      // may be undefined. Default to allowing the drag in that case.
      if (e.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) return
      draggingRef.current = true
      // Capture so we still get move/up even if pointer leaves the handle.
      // Pointer capture is best-effort — jsdom may not implement it.
      if (typeof e.pointerId === 'number' && e.currentTarget && 'setPointerCapture' in e.currentTarget) {
        try {
          ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        } catch {
          /* pointer capture may not be supported on this element */
        }
      }
    },
    []
  )

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => startDrag(e),
    [startDrag]
  )

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Map MouseEvent fields to startDrag's expected shape
      startDrag({ button: e.button, currentTarget: e.currentTarget })
    },
    [startDrag]
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      if (typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const size = direction === 'horizontal' ? rect.width : rect.height
      if (size <= 0) return
      const offset = direction === 'horizontal'
        ? e.clientX - rect.left
        : e.clientY - rect.top
      setRatio(offset / size, { kind: 'drag' })
    },
    [direction, setRatio]
  )

  const endDrag = useCallback((e: { pointerId?: number; currentTarget?: EventTarget | null } = {}) => {
    draggingRef.current = false
    if (typeof e.pointerId === 'number' && e.currentTarget && 'releasePointerCapture' in e.currentTarget) {
      try {
        ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
      } catch {
        /* pointer may already be released */
      }
    }
  }, [])

  const onMouseUp = useCallback(() => endDrag(), [endDrag])
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => endDrag(e),
    [endDrag]
  )

  // Window-level move/up: covers the case where user drags outside the handle,
  // and provides jsdom-friendly MouseEvent fallback (jsdom lacks PointerEvent).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const computeFromEvent = (clientX: number, clientY: number) => {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const size = direction === 'horizontal' ? rect.width : rect.height
      if (size <= 0) return
      const offset = direction === 'horizontal' ? clientX - rect.left : clientY - rect.top
      setRatio(offset / size, { kind: 'drag' })
    }
    const handlePointerMove = (e: PointerEvent) => {
      if (!draggingRef.current) return
      computeFromEvent(e.clientX, e.clientY)
    }
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      computeFromEvent(e.clientX, e.clientY)
    }
    const handleUp = () => {
      draggingRef.current = false
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('mouseup', handleUp)
    window.addEventListener('pointercancel', handleUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('mouseup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
    }
  }, [direction, setRatio])

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const isHorizontal = direction === 'horizontal'
      const decreaseKey = isHorizontal ? 'ArrowLeft' : 'ArrowUp'
      const increaseKey = isHorizontal ? 'ArrowRight' : 'ArrowDown'

      let next: number | null = null
      let consumedKey: string | null = null

      if (e.key === decreaseKey) {
        next = ratio - step
        consumedKey = decreaseKey
      } else if (e.key === increaseKey) {
        next = ratio + step
        consumedKey = increaseKey
      } else if (e.key === 'Home') {
        next = safeMin
        consumedKey = 'Home'
      } else if (e.key === 'End') {
        next = safeMax
        consumedKey = 'End'
      }

      if (next !== null && consumedKey !== null) {
        e.preventDefault()
        setRatio(next, { kind: 'keyboard', key: consumedKey })
      }
    },
    [direction, ratio, step, safeMin, safeMax, setRatio]
  )

  // Compute pixel size of primary pane from ratio and current container size.
  // We measure the container's bounding rect and recompute whenever ratio or
  // container size changes. A ResizeObserver keeps it in sync when the parent
  // resizes (window resize, sidebar collapse, etc).
  // In jsdom, getBoundingClientRect returns 0×0, so we fall back to percentage
  // until the first real measurement. To keep tests deterministic we expose a
  // measureTick counter that bumps after a state change, forcing re-measurement
  // on the next effect run.
  const [primaryPx, setPrimaryPx] = useState<number | null>(null)
  const [measureTick, setMeasureTick] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      setPrimaryPx(null)
      return
    }
    const measure = () => {
      const rect = container.getBoundingClientRect()
      const size = direction === 'horizontal' ? rect.width : rect.height
      if (size <= 0) return
      setPrimaryPx(Math.round(size * ratio))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    return () => ro.disconnect()
    // measureTick is included so any external re-measure trigger forces a re-run
  }, [ratio, direction, measureTick])

  // Expose a tick on window so tests / consumers can force a re-measure.
  // The component itself bumps the tick whenever the user interacts (drag/keyboard)
  // so the post-event measurement always reflects the latest ratio.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as unknown as { __oaSplitResync?: () => void }
    w.__oaSplitResync = () => setMeasureTick(t => t + 1)
    return () => {
      delete w.__oaSplitResync
    }
  }, [])

  // Fallback when no measurement is available (e.g. SSR / jsdom 0×0):
  // use percentage basis so layout still works in flex containers.
  const primaryBasisPx = primaryPx !== null ? `${primaryPx}px` : `${(ratio * 100).toFixed(4)}%`

  const handleStyle: CSSProperties = isMotionOff()
    ? { transition: 'none' }
    : { transition: 'background 0.15s' }

  const primaryStyle: CSSProperties = { flexBasis: primaryBasisPx, flexGrow: 0, flexShrink: 0 }
  const secondaryStyle: CSSProperties = { flexBasis: 0, flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 0 }

  return (
    <div
      ref={containerRef}
      className={`oa-split oa-split-${direction}${className ? ` ${className}` : ''}`}
      data-testid="oa-split"
      data-storage-key={storageKey}
      data-direction={direction}
    >
      <div
        className="oa-split-pane oa-split-pane-primary"
        data-testid="oa-split-pane-primary"
        style={primaryStyle}
      >
        {children}
      </div>
      <div
        className="oa-split-handle"
        data-testid="oa-split-handle"
        role="separator"
        aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(safeMin * 100)}
        aria-valuemax={Math.round(safeMax * 100)}
        aria-label={`${direction === 'horizontal' ? '水平' : '垂直'}拖拽分隔条，当前 ${Math.round(ratio * 100)}%`}
        tabIndex={0}
        style={handleStyle}
        onPointerDown={onPointerDown}
        onMouseDown={onMouseDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onMouseUp={onMouseUp}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      />
      <div
        className="oa-split-pane oa-split-pane-secondary"
        data-testid="oa-split-pane-secondary"
        style={secondaryStyle}
      >
        {second}
      </div>
    </div>
  )
}