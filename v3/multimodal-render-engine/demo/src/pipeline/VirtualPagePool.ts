/**
 * VirtualPagePool — 大文档虚拟页面池
 *
 * 核心能力：
 * - 最多保留 maxPoolSize 个 canvas 同时渲染（默认 5）
 * - LRU 淘汰：canvas.width=0 释放 GPU 纹理 + URL.revokeObjectURL 释放 Blob 内存
 * - IntersectionObserver 触发按需加载/预加载
 * - onPoolSizeChange 回调驱动 PerfPanel 实时更新
 *
 * 状态机：UNLOADED → LOADING → RENDERED → EVICTED → UNLOADED
 */

export interface PoolPageMeta {
  pageNum: number
  naturalWidth: number
  naturalHeight: number
  imageUrl: string
}

export interface PoolPageState {
  pageNum: number
  status: 'unloaded' | 'loading' | 'rendered' | 'evicted'
  canvas: HTMLCanvasElement | null
  blobUrl: string | null
  naturalWidth: number
  naturalHeight: number
  lastAccessTime: number
}

export interface VirtualPagePoolConfig {
  maxPoolSize?: number      // 最大同时渲染页数，默认 5
  preloadBuffer?: number    // 视口外预加载页数，默认 2
}

export class VirtualPagePool {
  private pool = new Map<number, PoolPageState>()
  private config: Required<VirtualPagePoolConfig>
  private poolSizeListeners = new Set<(size: number, max: number) => void>()
  private observer: IntersectionObserver | null = null
  private metaMap = new Map<number, PoolPageMeta>()

  constructor(config: VirtualPagePoolConfig = {}) {
    this.config = {
      maxPoolSize:   config.maxPoolSize   ?? 5,
      preloadBuffer: config.preloadBuffer ?? 2,
    }
  }

  // ── 初始化 ────────────────────────────────────────────────────────────────

  init(pages: PoolPageMeta[]): void {
    // 清理旧状态
    this.destroy()
    this.pool.clear()
    this.metaMap.clear()

    for (const meta of pages) {
      this.metaMap.set(meta.pageNum, meta)
      this.pool.set(meta.pageNum, {
        pageNum:       meta.pageNum,
        status:        'unloaded',
        canvas:        null,
        blobUrl:       null,
        naturalWidth:  meta.naturalWidth,
        naturalHeight: meta.naturalHeight,
        lastAccessTime: 0,
      })
    }
  }

  // ── 预加载 ────────────────────────────────────────────────────────────────

  async preload(pageNum: number): Promise<void> {
    const page = this.pool.get(pageNum)
    if (!page) return
    if (page.status === 'rendered') {
      // 更新访问时间（LRU 记录）
      page.lastAccessTime = Date.now()
      return
    }
    if (page.status === 'loading') return

    // 若 pool 已满，先淘汰
    const renderedCount = this.getRenderedCount()
    if (renderedCount >= this.config.maxPoolSize) {
      this.evictLRU()
    }

    page.status = 'loading'
    const canvas = await this.loadCanvas(page)
    page.canvas = canvas
    page.status = 'rendered'
    page.lastAccessTime = Date.now()
    this.notifyPoolChange()
  }

  // ── 渲染 canvas（mock：用 2D canvas 绘制占位页面）──────────────────────

  private async loadCanvas(page: PoolPageState): Promise<HTMLCanvasElement> {
    const meta = this.metaMap.get(page.pageNum)
    const canvas = document.createElement('canvas')
    canvas.width  = page.naturalWidth
    canvas.height = page.naturalHeight

    const ctx = canvas.getContext('2d')
    if (ctx && meta) {
      // 尝试从 imageUrl 加载（如果是 data URL 或 http URL）
      if (meta.imageUrl && !meta.imageUrl.startsWith('mock://')) {
        await new Promise<void>(resolve => {
          const img = new Image()
          img.onload = () => {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
            resolve()
          }
          img.onerror = () => {
            this.drawPlaceholder(ctx, page.pageNum, page.naturalWidth, page.naturalHeight)
            resolve()
          }
          img.src = meta.imageUrl
        })
      } else {
        this.drawPlaceholder(ctx, page.pageNum, page.naturalWidth, page.naturalHeight)
      }
    }

    return canvas
  }

  private drawPlaceholder(ctx: CanvasRenderingContext2D, pageNum: number, w: number, h: number): void {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#e0e0e0'
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
    ctx.fillStyle = '#f8f8f8'
    ctx.fillRect(0, 0, w, 56)
    ctx.fillStyle = '#555'
    ctx.font = 'bold 14px sans-serif'
    ctx.fillText(`第 ${pageNum} 页`, 24, 36)
    ctx.fillStyle = '#d9d9d9'
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(24, 80 + i * 48, w * 0.85, 20)
    }
  }

  // ── LRU 淘汰 ──────────────────────────────────────────────────────────────

  private evictLRU(): void {
    const candidates = [...this.pool.values()]
      .filter(p => p.status === 'rendered')
      .sort((a, b) => a.lastAccessTime - b.lastAccessTime)

    const target = candidates[0]
    if (!target) return

    // 释放 GPU 纹理（canvas.width=0 是标准手段）
    if (target.canvas) {
      target.canvas.width = 0
      target.canvas = null
    }
    if (target.blobUrl) {
      URL.revokeObjectURL(target.blobUrl)
      target.blobUrl = null
    }
    target.status = 'evicted'
    this.notifyPoolChange()
  }

  // ── 访问 canvas ────────────────────────────────────────────────────────

  getCanvas(pageNum: number): HTMLCanvasElement | null {
    const page = this.pool.get(pageNum)
    if (!page || page.status !== 'rendered' || !page.canvas) return null
    page.lastAccessTime = Date.now()
    return page.canvas
  }

  // ── 状态查询 ──────────────────────────────────────────────────────────────

  getPoolStatus(): { size: number; max: number; pages: PoolPageState[] } {
    return {
      size: this.getRenderedCount(),
      max:  this.config.maxPoolSize,
      pages: [...this.pool.values()],
    }
  }

  private getRenderedCount(): number {
    return [...this.pool.values()].filter(p => p.status === 'rendered').length
  }

  // ── IntersectionObserver 集成 ──────────────────────────────────────────

  observePage(pageNum: number, el: HTMLElement): void {
    if (!this.observer) {
      this.observer = new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            const pn = parseInt((entry.target as HTMLElement).dataset.pageNum ?? '0', 10)
            if (!pn) continue
            if (entry.isIntersecting) {
              // 进入视口：加载当前页及前后 preloadBuffer 页
              for (let i = -this.config.preloadBuffer; i <= this.config.preloadBuffer; i++) {
                this.preload(pn + i)
              }
            }
          }
        },
        { rootMargin: '200px 0px' }
      )
    }
    el.dataset.pageNum = String(pageNum)
    this.observer.observe(el)
  }

  unobservePage(_pageNum: number, el: HTMLElement): void {
    this.observer?.unobserve(el)
  }

  // ── 订阅 pool size 变化 ────────────────────────────────────────────────

  onPoolSizeChange(fn: (size: number, max: number) => void): () => void {
    this.poolSizeListeners.add(fn)
    return () => this.poolSizeListeners.delete(fn)
  }

  private notifyPoolChange(): void {
    const size = this.getRenderedCount()
    this.poolSizeListeners.forEach(fn => fn(size, this.config.maxPoolSize))
  }

  // ── 销毁 ──────────────────────────────────────────────────────────────────

  destroy(): void {
    this.observer?.disconnect()
    this.observer = null

    for (const page of this.pool.values()) {
      if (page.canvas) {
        page.canvas.width = 0
        page.canvas = null
      }
      if (page.blobUrl) {
        URL.revokeObjectURL(page.blobUrl)
        page.blobUrl = null
      }
    }
    this.pool.clear()
  }
}
