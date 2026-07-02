import type { Rect } from '../../core/types'
import type { SVGLayer } from '../../layers/SVGLayer'
import type { AnnotationStore } from '../../core/AnnotationStore'

const MIN_SIZE = 20

/** 8-handle directions in order matching SVGLayer.showResizeHandles */
const HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type HandleDir = typeof HANDLE_DIRS[number]

/**
 * Resize and move tool for annotation boxes.
 * Uses pointer capture for smooth drag across handles.
 */
export class ResizeTool {
  private activeFieldId: string | null = null
  private originalRect: Rect | null = null
  private dragStart: { x: number; y: number } | null = null
  private dragMode: HandleDir | 'move' | null = null

  // Bound handlers
  private _onPointerDown: (e: PointerEvent) => void
  private _onPointerMove: (e: PointerEvent) => void
  private _onPointerUp:   (e: PointerEvent) => void

  constructor(
    private svgLayer: SVGLayer,
    private store: AnnotationStore,
    private containerEl: HTMLElement
  ) {
    this._onPointerDown = this.onPointerDown.bind(this)
    this._onPointerMove = this.onPointerMove.bind(this)
    this._onPointerUp   = this.onPointerUp.bind(this)
  }

  activate(fieldId: string): void {
    this.deactivate()
    this.activeFieldId = fieldId
    this.svgLayer.showResizeHandles(fieldId)
    this.containerEl.addEventListener('pointerdown', this._onPointerDown)
    this.containerEl.addEventListener('pointermove', this._onPointerMove)
    this.containerEl.addEventListener('pointerup',   this._onPointerUp)
  }

  deactivate(): void {
    if (!this.activeFieldId) return
    this.svgLayer.hideResizeHandles()
    this.activeFieldId = null
    this.originalRect = null
    this.dragStart = null
    this.dragMode = null
    this.containerEl.removeEventListener('pointerdown', this._onPointerDown)
    this.containerEl.removeEventListener('pointermove', this._onPointerMove)
    this.containerEl.removeEventListener('pointerup',   this._onPointerUp)
  }

  // ──────────────────── Event handlers ────────────────────

  private onPointerDown(e: PointerEvent): void {
    const id = this.activeFieldId
    if (!id) return

    const target = e.target as HTMLElement
    const handleDir = target.getAttribute('data-dir') as HandleDir | null
    const annotationId = target.getAttribute('data-annotation-id')

    if (handleDir && annotationId === id) {
      // Resizing via a handle
      this.beginDrag(e, handleDir)
    } else {
      // Check if clicking the annotation box itself (for move)
      const box = this.containerEl.querySelector(`[data-id="${id}"] .annotation-box`)
      if (box && box.contains(target)) {
        this.beginDrag(e, 'move')
      }
    }
  }

  private beginDrag(e: PointerEvent, mode: HandleDir | 'move'): void {
    const id = this.activeFieldId!
    const ann = this.store.getById(id)
    if (!ann || ann.position.kind !== 'pixel') return

    e.preventDefault()
    e.stopPropagation()
    this.containerEl.setPointerCapture(e.pointerId)

    this.originalRect = { ...ann.position.bbox }
    this.dragStart = { x: e.clientX, y: e.clientY }
    this.dragMode = mode
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragStart || !this.originalRect || !this.dragMode) return
    e.preventDefault()

    const dx = e.clientX - this.dragStart.x
    const dy = e.clientY - this.dragStart.y
    const scale = this.getDisplayScale()

    // Convert screen delta to image-pixel delta
    const pdx = dx / scale
    const pdy = dy / scale

    const newRect = this.dragMode === 'move'
      ? this.calcMovedRect(this.originalRect, pdx, pdy)
      : this.calcResizedRect(this.originalRect, this.dragMode, pdx, pdy)

    // Optimistic visual update via store (will trigger SVGLayer re-render in parent)
    if (this.activeFieldId) {
      this.store.update(this.activeFieldId, {
        position: { kind: 'pixel', bbox: newRect },
      })
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.dragStart || !this.originalRect || !this.dragMode) return

    const dx = e.clientX - this.dragStart.x
    const dy = e.clientY - this.dragStart.y
    const scale = this.getDisplayScale()
    const pdx = dx / scale
    const pdy = dy / scale

    const newRect = this.dragMode === 'move'
      ? this.calcMovedRect(this.originalRect, pdx, pdy)
      : this.calcResizedRect(this.originalRect, this.dragMode, pdx, pdy)

    if (this.activeFieldId) {
      this.store.update(this.activeFieldId, {
        position: { kind: 'pixel', bbox: newRect },
      })
    }

    this.dragStart = null
    this.originalRect = null
    this.dragMode = null
  }

  // ──────────────────── Geometry helpers ────────────────────

  private calcMovedRect(orig: Rect, dx: number, dy: number): Rect {
    return { ...orig, x: orig.x + dx, y: orig.y + dy }
  }

  private calcResizedRect(orig: Rect, dir: HandleDir, dx: number, dy: number): Rect {
    let { x, y, w, h } = orig

    // Adjust edges based on handle direction
    if (dir.includes('w')) {
      const newX = x + dx
      const newW = w - dx
      if (newW >= MIN_SIZE) { x = newX; w = newW }
    }
    if (dir.includes('e')) {
      w = Math.max(MIN_SIZE, w + dx)
    }
    if (dir.includes('n')) {
      const newY = y + dy
      const newH = h - dy
      if (newH >= MIN_SIZE) { y = newY; h = newH }
    }
    if (dir.includes('s')) {
      h = Math.max(MIN_SIZE, h + dy)
    }

    return { x, y, w, h }
  }

  private getDisplayScale(): number {
    // Try to find an img in the container
    const img = this.containerEl.querySelector('img') as HTMLImageElement | null
    if (!img || !img.naturalWidth) return 1
    return this.containerEl.offsetWidth / img.naturalWidth
  }
}
