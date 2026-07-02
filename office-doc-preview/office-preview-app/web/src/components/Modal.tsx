// 模型：claude-sonnet-4-6
// Modal primitive — focus trap + mask close + Esc close + AnimatePresence enter/exit
// Phase 2.A: standalone modal coexists with ⌘K palette (usePalette owns its own ⌘K/Esc)
//             Observability via console.info('[modal ISO] opened/closed')
//             Reduced-motion respected via <html data-motion="off">

import {
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  KeyboardEvent as ReactKeyboardEvent,
  forwardRef,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'

export type ModalCloseReason = 'mask' | 'esc' | 'button'

export type ModalWidth = 'sm' | 'md' | 'lg' | 'xl'

export interface ModalProps {
  open: boolean
  onClose: (reason: ModalCloseReason) => void
  title?: string
  children?: ReactNode
  footer?: ReactNode
  width?: ModalWidth
  /** When false, clicking the mask does NOT close. Esc still closes. */
  maskClosable?: boolean
  /** Optional aria-labelledby — points to an external title id */
  ariaLabelledBy?: string
  /** Extra class on the modal body */
  className?: string
  /**
   * When true, the primitive renders ONLY the mask + focus-trap/esc/animate behavior.
   * Caller is responsible for providing their own dialog content (preserves legacy CSS).
   * data-testid="modal" is still added for test parity.
   */
  bare?: boolean
}

const WIDTH_PX: Record<ModalWidth, number> = {
  sm: 360,
  md: 520,
  lg: 720,
  xl: 960,
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function isMotionOff(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.getAttribute('data-motion') === 'off'
}

function getFocusable(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  return nodes.filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1)
}

export const Modal = forwardRef<HTMLDivElement, ModalProps>(function Modal(
  {
    open,
    onClose,
    title,
    children,
    footer,
    width = 'md',
    maskClosable = true,
    ariaLabelledBy,
    className,
    bare = false,
  }: ModalProps,
  forwardedRef
) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const close = useCallback(
    (reason: ModalCloseReason) => {
      onCloseRef.current(reason)
    },
    []
  )

  // Open/close observability
  useEffect(() => {
    if (!open) return
    const ts = new Date().toISOString()
    console.info(`[modal ${ts}] opened`, { title: title ?? null })
    return () => {
      const ts2 = new Date().toISOString()
      console.info(`[modal ${ts2}] closed`, { reason: 'unmount-or-reopen' })
    }
    // We only want to log on open transitions; title change does not re-fire
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Lock body scroll + remember/restore focus
  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      const prev = previouslyFocused.current
      if (prev && typeof prev.focus === 'function') {
        try { prev.focus() } catch { /* noop */ }
      }
    }
  }, [open])

  // Initial focus on first focusable child (after mount)
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      const focusables = getFocusable(bodyRef.current)
      if (focusables[0]) {
        try { focusables[0].focus() } catch { /* noop */ }
      }
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  // Esc close + focus trap (Tab / Shift+Tab cycle)
  useEffect(() => {
    if (!open) return
    const handler = (e: globalThis.KeyboardEvent) => {
      // Esc / Shift+Esc — close
      if (e.key === 'Escape') {
        e.stopPropagation()
        close('esc')
        return
      }
      // Tab focus trap — only intercept when focus is inside the modal
      if (e.key === 'Tab') {
        const body = bodyRef.current
        if (!body) return
        const focusables = getFocusable(body)
        if (focusables.length === 0) {
          e.preventDefault()
          return
        }
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement as HTMLElement | null
        const insideModal = active ? body.contains(active) : false
        if (e.shiftKey) {
          // Shift+Tab: from first go to last; from outside go to last
          if (active === first || !insideModal) {
            e.preventDefault()
            last.focus()
          }
        } else {
          // Tab: from last go to first; from outside go to first
          if (active === last || !insideModal) {
            e.preventDefault()
            first.focus()
          }
        }
      }
    }
    // Listen on BOTH window (catches Esc dispatched on window directly, e.g. fireEvent.keyDown(window, ...))
    // and document with capture (catches Esc dispatched on elements inside the modal).
    // Modal owns its own Esc handler — palette owns ⌘K globally (no conflict).
    window.addEventListener('keydown', handler)
    document.addEventListener('keydown', handler, true)
    return () => {
      window.removeEventListener('keydown', handler)
      document.removeEventListener('keydown', handler, true)
    }
  }, [open, close])

  const handleMaskClick = () => {
    if (!maskClosable) return
    close('mask')
  }

  const handleMaskKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (maskClosable) close('mask')
    }
  }

  const widthPx = WIDTH_PX[width]
  const off = isMotionOff()

  // Bare mode: caller renders their own dialog markup. We still apply focus trap,
  // Esc, mask click (via a virtual mask), and AnimatePresence animation.
  if (bare) {
    const bareNode = (
      <div
        ref={forwardedRef}
        className={`oa-modal-root oa-modal-bare ${className ?? ''}`}
        style={{ position: 'fixed', inset: 0, zIndex: 1000 }}
        data-testid="modal-root"
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy ?? undefined}
      >
        {/* Invisible mask — handles click-to-close; mask backdrop is provided by caller's children */}
        <div
          className="oa-modal-mask"
          data-testid="modal-mask"
          role="presentation"
          onClick={handleMaskClick}
          onKeyDown={handleMaskKeyDown}
          tabIndex={maskClosable ? -1 : undefined}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'transparent',
            pointerEvents: maskClosable ? 'auto' : 'none',
          }}
        />
        <div
          ref={bodyRef}
          data-testid="modal"
          tabIndex={-1}
          style={{ position: 'relative', width: '100%', height: '100%' }}
        >
          {children}
        </div>
      </div>
    )

    return (
      <AnimatePresence>
        {open && (
          off ? (
            <motion.div key="modal-static" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0 }} style={{ display: 'contents' }}>
              {bareNode}
            </motion.div>
          ) : (
            <motion.div key="modal-animated" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }} style={{ display: 'contents' }}>
              {bareNode}
            </motion.div>
          )
        )}
      </AnimatePresence>
    )
  }

  const modalNode = (
    <div
      ref={forwardedRef}
      className={`oa-modal-root ${className ?? ''}`}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      data-testid="modal-root"
    >
      <div
        className="oa-modal-mask"
        data-testid="modal-mask"
        role="presentation"
        onClick={handleMaskClick}
        onKeyDown={handleMaskKeyDown}
        tabIndex={maskClosable ? -1 : undefined}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--color-bg-mask)',
          backdropFilter: 'blur(2px)',
        }}
      />
      <div
        className="oa-modal"
        ref={bodyRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy ?? undefined}
        tabIndex={-1}
        data-testid="modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: widthPx,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 64px)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          boxShadow: '0 10px 40px rgba(15, 23, 42, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {title !== undefined && (
          <header
            className="oa-modal-header"
            data-testid="modal-header"
            style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--color-border-light)',
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--color-text)',
            }}
          >
            {title}
          </header>
        )}
        <div
          className="oa-modal-body"
          data-testid="modal-body"
          style={{
            padding: 20,
            flex: 1,
            overflow: 'auto',
            color: 'var(--color-text)',
          }}
        >
          {children}
        </div>
        {footer !== undefined && (
          <footer
            className="oa-modal-footer"
            data-testid="modal-footer"
            style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--color-border-light)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              background: 'var(--color-bg-subtle)',
            }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>
  )

  return (
    <AnimatePresence>
      {open && (
        off ? (
          <motion.div
            key="modal-static"
            initial={false}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0 }}
            style={{ display: 'contents' }}
          >
            {modalNode}
          </motion.div>
        ) : (
          <motion.div
            key="modal-animated"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            style={{ display: 'contents' }}
          >
            {modalNode}
          </motion.div>
        )
      )}
    </AnimatePresence>
  )
})

/**
 * useModal — convenience hook for { open, setOpen } state.
 * Coexists with usePalette: palette owns ⌘K/Esc globally; Modal owns its own Esc.
 */
export interface UseModalResult {
  open: boolean
  setOpen: (v: boolean) => void
  show: () => void
  hide: () => void
  toggle: () => void
}

export function useModal(initial = false): UseModalResult {
  const [open, setOpen] = useState(initial)
  return {
    open,
    setOpen,
    show: () => setOpen(true),
    hide: () => setOpen(false),
    toggle: () => setOpen(o => !o),
  }
}

Modal.displayName = 'Modal'

// Re-export a small hook import for ergonomic imports
import { useState } from 'react'