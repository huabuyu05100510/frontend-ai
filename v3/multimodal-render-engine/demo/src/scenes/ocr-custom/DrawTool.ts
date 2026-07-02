import type { Point, Rect } from '../../core/types'
import type { SVGLayer } from '../../layers/SVGLayer'
import type { StateMachine } from '../../core/StateMachine'
import type { EventBus } from '../../core/EventBus'
import { normalizeRect } from '../../utils/coord'

type DrawState = 'idle' | 'drawing_ready' | 'drawing' | 'config_open'

/**
 * Rectangle draw tool. Binds pointer events to the container and
 * delegates preview rendering to SVGLayer.
 */
export class DrawTool {
  private state: DrawState = 'idle'
  private startPt: Point | null = null
  private isActive = false

  // Bound event handlers (stored for removal)
  private _onPointerDown: (e: PointerEvent) => void
  private _onPointerMove: (e: PointerEvent) => void
  private _onPointerUp:   (e: PointerEvent) => void
  private _onKeyDown:     (e: KeyboardEvent) => void

  constructor(
    private container: HTMLElement,
    private svgLayer: SVGLayer,
    private stateMachine: StateMachine,
    private bus: EventBus
  ) {
    this._onPointerDown = this.onPointerDown.bind(this)
    this._onPointerMove = this.onPointerMove.bind(this)
    this._onPointerUp   = this.onPointerUp.bind(this)
    this._onKeyDown     = this.onKeyDown.bind(this)
  }

  activate(): void {
    if (this.isActive) return
    this.isActive = true
    this.state = 'drawing_ready'
    this.container.style.cursor = 'crosshair'
    this.container.addEventListener('pointerdown', this._onPointerDown)
    this.container.addEventListener('pointermove', this._onPointerMove)
    this.container.addEventListener('pointerup',   this._onPointerUp)
    window.addEventListener('keydown', this._onKeyDown)
  }

  deactivate(): void {
    if (!this.isActive) return
    this.isActive = false
    this.state = 'idle'
    this.startPt = null
    this.container.style.cursor = ''
    this.container.removeEventListener('pointerdown', this._onPointerDown)
    this.container.removeEventListener('pointermove', this._onPointerMove)
    this.container.removeEventListener('pointerup',   this._onPointerUp)
    window.removeEventListener('keydown', this._onKeyDown)
    this.svgLayer.hidePreviewRect()
  }

  // ──────────────────── Internal event handlers ────────────────────

  private onPointerDown(e: PointerEvent): void {
    if (this.state !== 'drawing_ready') return
    e.preventDefault()
    this.container.setPointerCapture(e.pointerId)
    this.startPt = this.clientToLocal(e)
    this.state = 'drawing'
    this.stateMachine.startDraw(this.startPt)
    const rect = this.makeRect(this.startPt, this.startPt)
    this.svgLayer.showPreviewRect(rect)
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.state !== 'drawing' || !this.startPt) return
    e.preventDefault()
    const current = this.clientToLocal(e)
    this.stateMachine.updateDraw(current)
    const rect = this.makeRect(this.startPt, current)
    this.svgLayer.updatePreviewRect(rect)
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.state !== 'drawing' || !this.startPt) return
    e.preventDefault()
    const current = this.clientToLocal(e)
    const rect = this.makeRect(this.startPt, current)
    this.svgLayer.hidePreviewRect()
    this.startPt = null

    const area = rect.w * rect.h
    if (area < 400) {
      // Too small — cancel
      this.state = 'drawing_ready'
      this.stateMachine.reset()
      return
    }

    const fieldId = `field-${Date.now()}`
    this.state = 'config_open'
    this.bus.emit({ type: 'FIELD_CONFIG_OPEN', fieldId, rect })

    // Listen for close to return to ready state
    const unsub = this.bus.on('FIELD_SAVED', () => {
      this.state = 'drawing_ready'
      unsub()
    })
    const unsub2 = this.bus.on('FIELD_DELETED', () => {
      this.state = 'drawing_ready'
      unsub2()
    })
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cancelDraw()
    }
  }

  // ──────────────────── Helpers ────────────────────

  private cancelDraw(): void {
    if (this.state !== 'drawing') return
    this.state = 'drawing_ready'
    this.startPt = null
    this.svgLayer.hidePreviewRect()
    this.stateMachine.reset()
  }

  private clientToLocal(e: PointerEvent): Point {
    const bcr = this.container.getBoundingClientRect()
    return {
      x: e.clientX - bcr.left,
      y: e.clientY - bcr.top,
    }
  }

  private makeRect(p1: Point, p2: Point): Rect {
    return normalizeRect(p1, p2)
  }
}
