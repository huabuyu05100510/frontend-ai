import type { PerfSnapshot } from '../core/types'

type Listener = (snapshot: PerfSnapshot) => void

export class PerfCollector {
  private frameTimestamps: number[] = []
  private rafHandle = 0
  private emitHandle = 0
  private snapshot: PerfSnapshot = {
    fps: 0, operationTime: 0, renderTime: 0,
    aiLatency: 0, documentSize: 0, blockCount: 0, collaborators: 0,
  }
  private listeners = new Set<Listener>()

  start(): void {
    this.rafHandle = requestAnimationFrame(this._tick)
    // Emit snapshot every 500ms (avoid high-frequency re-renders)
    this.emitHandle = window.setInterval(() => {
      this.listeners.forEach(fn => fn({ ...this.snapshot }))
    }, 500)
  }

  stop(): void {
    cancelAnimationFrame(this.rafHandle)
    clearInterval(this.emitHandle)
    this.frameTimestamps = []
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot(): PerfSnapshot { return { ...this.snapshot } }

  recordOperation(ms: number): void { this.snapshot.operationTime = ms }
  recordRender(ms: number): void { this.snapshot.renderTime = ms }
  recordAILatency(ms: number): void { this.snapshot.aiLatency = ms }
  setDocumentSize(chars: number): void { this.snapshot.documentSize = chars }
  setBlockCount(n: number): void { this.snapshot.blockCount = n }
  setCollaborators(n: number): void { this.snapshot.collaborators = n }

  private _tick = (now: number): void => {
    this.frameTimestamps.push(now)
    const cutoff = now - 1000
    while (this.frameTimestamps.length > 0 && this.frameTimestamps[0] < cutoff) {
      this.frameTimestamps.shift()
    }
    this.snapshot.fps = this.frameTimestamps.length
    this.rafHandle = requestAnimationFrame(this._tick)
  }
}
