// PdfWasmCoordinator：Web Worker 驱动的 PDF 渲染协调器（v2）
// 模型：claude-sonnet-4-6
//
// 核心职责：
//   1. 管理 Web Worker 生命周期（spawn / health check / restart）
//   2. 文档缓存（LRU + refCount，最多 3 文档，30s 空闲驱逐）
//   3. 位图缓存（LRU，128MB budget，key = docId:pageNum:scale）
//   4. 渲染优先级队列（high > medium > low，cancel 令牌）
//   5. 可观测上报到 usePerf
//
// 关键设计决定：
//   - Worker 内用 createImageBitmap(ImageData) 做 zero-copy bitmap 传输
//   - 渐进式渲染：0.5x 低清先返回 → 1.0x 高清替换
//   - Coordinator 不暴露 Worker 实例，外部通过统一 API 通信
//   - __resetCoordinatorForTest() 辅助函数用于测试

import { usePerf } from '../../perf'

// ============ 类型 ============

export type RenderPriority = 'high' | 'medium' | 'low'

export interface CoordinatorStatus {
  state: 'idle' | 'loading' | 'ready' | 'error'
  documents: number
  bitmapEntries: number
  bitmapCacheMB: number
  queueDepth: number
}

export interface RenderRequest {
  docId: number
  pageNum: number
  /** 目标缩放比例（如 1.5 = 150% = ~112 DPI） */
  scale: number
  priority: RenderPriority
  /** 取消令牌 —— 若该页面/scale 被新请求取代则丢弃结果 */
  cancelToken?: number
}

export interface PageRenderResult {
  pageNum: number
  bitmap: ImageBitmap
  width: number
  height: number
  /** 'low' = 0.5x 渐进首帧，'full' = 目标分辨率 */
  phase: 'low' | 'full'
}

export interface PageTextResult {
  pageNum: number
  positions: Float32Array  // 7 floats/char: [left, top, right, bottom, fontSize, charCode, charW]
  chars: string
  pageW: number
  pageH: number
}

// ============ Worker 消息协议 ============

type WorkerRequest =
  | { type: 'openDocument'; requestId: number; url: string }
  | { type: 'renderPage'; requestId: number; docId: number; pageNum: number; scale: number; progressive: boolean }
  | { type: 'cancelRender'; requestId: number; docId: number; pageNum: number }
  | { type: 'extractText'; requestId: number; docId: number; pageNum: number; scale: number }
  | { type: 'closeDocument'; requestId: number; docId: number }
  | { type: 'getPageSize'; requestId: number; docId: number; pageNum: number }
  | { type: 'destroy' }

type WorkerResponse =
  | { type: 'ready' }
  | { type: 'documentOpened'; requestId: number; docId: number; pageCount: number; pageSizes: Array<{ w: number; h: number }> }
  | { type: 'pageRendered'; requestId: number; pageNum: number; bitmap: ImageBitmap; width: number; height: number; phase: 'low' | 'full' }
  | { type: 'textExtracted'; requestId: number; pageNum: number; positions: Float32Array; chars: string; pageW: number; pageH: number }
  | { type: 'documentClosed'; requestId: number }
  | { type: 'pageSize'; requestId: number; w: number; h: number }
  | { type: 'error'; requestId: number; message: string }

// ============ 文档缓存条目 ============

interface DocEntry {
  docId: number
  url: string
  pageCount: number
  pageSizes: Array<{ w: number; h: number }>
  refCount: number
  lastAccess: number
  status: 'loading' | 'ready' | 'error'
  /** 等待 openDocument 响应的 resolvers */
  waiters: Array<{ resolve: (e: DocEntry) => void; reject: (e: Error) => void }>
}

// ============ 位图缓存条目 ============

interface BitmapEntry {
  bitmap: ImageBitmap
  width: number
  height: number
  bytes: number       // width * height * 4
  phase: 'low' | 'full'
  lastAccess: number
}

// ============ Pending 请求 ============

interface PendingCall {
  type: WorkerRequest['type']
  resolve: (data: any) => void
  reject: (err: Error) => void
  cancelToken?: number
  docId?: number
  pageNum?: number
  scale?: number
}

// ============ 常量 ============

const MAX_DOCS = 3
const DOC_IDLE_MS = 30_000
const MAX_CACHE_MB = 128
const IDLE_PRUNE_INTERVAL = 10_000

// ============ 单例 ============

let _coordinator: PdfWasmCoordinator | null = null

export function getCoordinator(): PdfWasmCoordinator {
  if (!_coordinator) _coordinator = new PdfWasmCoordinator()
  return _coordinator
}

/** 测试辅助：重置协调器 */
export function __resetCoordinatorForTest() {
  if (_coordinator) {
    _coordinator.destroy()
    _coordinator = null
  }
}

// ============ 实现 ============

export class PdfWasmCoordinator {
  // Worker
  private _worker: Worker | null = null
  private _workerReady = false
  private _workerError: string | null = null
  private _workerFactory: (() => Worker) | null = null

  // 请求
  private _requestId = 0
  private _pending = new Map<number, PendingCall>()

  // 缓存
  private _docs = new Map<number, DocEntry>()
  private _docIdSeq = 0
  private _bitmaps = new Map<string, BitmapEntry>()
  private _bitmapBytes = 0

  // 渲染队列（按优先级分组）
  private _queue: RenderRequest[] = []
  private _cancelTokens = new Set<number>()

  // 清理
  private _idleTimer: ReturnType<typeof setInterval> | null = null
  private _status: CoordinatorStatus = { state: 'idle', documents: 0, bitmapEntries: 0, bitmapCacheMB: 0, queueDepth: 0 }

  // 可观测：全局 token 递增用于 cancel
  private _globalToken = 0

  constructor(options?: { workerFactory?: () => Worker }) {
    this._workerFactory = options?.workerFactory || null
  }

  // ============ 公开 API ============

  get status(): Readonly<CoordinatorStatus> { return this._status }

  /** 打开文档（refCount +1）。返回 doc entry，含 pageCount + pageSizes。同 URL 复用。 */
  async openDocument(url: string): Promise<{ docId: number; pageCount: number; pageSizes: Array<{ w: number; h: number }>; release: () => void }> {
    this._ensureWorker()

    // 已缓存？
    for (const [, entry] of this._docs) {
      if (entry.url === url && entry.status === 'ready') {
        entry.refCount++
        entry.lastAccess = Date.now()
        console.log('[pdf-wasm-v2] doc cache hit', url, 'refCount=', entry.refCount)
        usePerf.getState().set({ poolHits: usePerf.getState().poolHits + 1 })
        return {
          docId: entry.docId,
          pageCount: entry.pageCount,
          pageSizes: entry.pageSizes,
          release: () => this._releaseDoc(entry.docId),
        }
      }
      if (entry.url === url && entry.status === 'loading') {
        // 正在加载中，等待
        entry.refCount++
        return new Promise((resolve, reject) => {
          entry.waiters.push({
            resolve: (e) => resolve({
              docId: e.docId, pageCount: e.pageCount, pageSizes: e.pageSizes,
              release: () => this._releaseDoc(e.docId),
            }),
            reject,
          })
        })
      }
    }

    // Evict old docs if at capacity
    this._evictDocs()

    const docId = ++this._docIdSeq
    console.log('[pdf-wasm-v2] doc open', url, 'docId=', docId)
    usePerf.getState().set({ poolMisses: usePerf.getState().poolMisses + 1 })

    const entry: DocEntry = {
      docId, url, pageCount: 0, pageSizes: [], refCount: 1, lastAccess: Date.now(),
      status: 'loading', waiters: [],
    }
    this._docs.set(docId, entry)
    this._updateStatus()

    return new Promise((resolve, reject) => {
      entry.waiters.push({
        resolve: (e) => resolve({
          docId: e.docId, pageCount: e.pageCount, pageSizes: e.pageSizes,
          release: () => this._releaseDoc(e.docId),
        }),
        reject,
      })

      // 发送 openDocument 到 worker
      const requestId = this._nextRequestId()
      this._pending.set(requestId, {
        type: 'openDocument',
        resolve: (data: WorkerResponse & { type: 'documentOpened' }) => {
          entry.pageCount = data.pageCount
          entry.pageSizes = data.pageSizes
          entry.status = 'ready'
          entry.lastAccess = Date.now()
          for (const w of entry.waiters) w.resolve(entry)
          entry.waiters = []
          this._updateStatus()
          console.log('[pdf-wasm-v2] doc ready', url, 'pages=', data.pageCount)
        },
        reject: (err) => {
          entry.status = 'error'
          for (const w of entry.waiters) w.reject(err)
          entry.waiters = []
          this._docs.delete(docId)
          this._updateStatus()
        },
      })
      this._post({ type: 'openDocument', requestId, url })
    })
  }

  /** 请求渲染一页。返回 { bitmap, phase } 回调。渐进模式先返 low 再返 full。
   *  skipProgressive: 跳过低清，直接全清渲染（非首屏页用） */
  requestRender(
    docId: number,
    pageNum: number,
    scale: number,
    opts: { priority?: RenderPriority; cancelToken?: number; onBitmap: (r: PageRenderResult) => void; skipProgressive?: boolean },
  ): { cancel: () => void } {
    const priority = opts.priority || 'medium'
    const cancelToken = opts.cancelToken || ++this._globalToken
    const onBitmap = opts.onBitmap
    const cacheKey = `${docId}:${pageNum}:${Math.round(scale * 100)}`

    // 位图缓存命中？
    const cached = this._bitmaps.get(cacheKey)
    if (cached) {
      cached.lastAccess = Date.now()
      if (cached.phase === 'full') {
        // 全清缓存命中，立即回调
        console.log('[pdf-wasm-v2] bitmap cache hit', cacheKey)
        // 确保 bitmap 未 detached（跨渲染周期可能已 transfer）
        try {
          const w = cached.bitmap.width  // 触发 detached 检测
          void w
          setTimeout(() => onBitmap({ pageNum, bitmap: cached.bitmap, width: cached.width, height: cached.height, phase: 'full' }), 0)
        } catch {
          // detached，删除缓存项
          this._bitmaps.delete(cacheKey)
          this._bitmapBytes -= cached.bytes
        }
        return { cancel: () => {} }
      }
      // 只有低清缓存，先回调低清
      try {
        const w = cached.bitmap.width
        void w
        setTimeout(() => onBitmap({ pageNum, bitmap: cached.bitmap, width: cached.width, height: cached.height, phase: 'low' }), 0)
      } catch { /* detached */ }
      // 继续请求全清
    }

    // 检查是否已有该页的 pending 渲染
    for (const [, pending] of this._pending) {
      if (pending.type === 'renderPage' && pending.docId === docId && pending.pageNum === pageNum) {
        // 已有一个渲染在飞，发 cancel 信号让旧的丢弃
        return { cancel: () => { pending.cancelToken = -1; this._post({ type: 'cancelRender', requestId: 0, docId, pageNum }) } }
      }
    }

    // 跨 scale pending：取消旧请求（新旧 scale 不同则旧的没意义）
    for (const [rid, pending] of this._pending) {
      if (pending.type === 'renderPage' && pending.docId === docId && pending.pageNum === pageNum) {
        pending.cancelToken = -1
        this._pending.delete(rid)
        this._post({ type: 'cancelRender', requestId: 0, docId, pageNum })
      }
    }

    const doProgressive = !opts.skipProgressive

    // 渐进渲染：先请求 0.5x 低清
    if (doProgressive) {
      const lowScale = scale * 0.5
      const lowCacheKey = `${docId}:${pageNum}:${Math.round(lowScale * 100)}`

      if (!this._bitmaps.has(lowCacheKey)) {
        this._sendRender(docId, pageNum, lowScale, 'low', cancelToken, onBitmap, cacheKey)
      }
    }

    // 全清渲染
    this._sendRender(docId, pageNum, scale, 'full', cancelToken, onBitmap, cacheKey)

    return {
      cancel: () => {
        this._cancelTokens.add(cancelToken)
      },
    }
  }

  /** 取消某页的 Worker 渲染（视口回退时调用）。 */
  cancelPageRender(docId: number, pageNum: number) {
    for (const [rid, pending] of this._pending) {
      if (pending.type === 'renderPage' && pending.docId === docId && pending.pageNum === pageNum) {
        pending.cancelToken = -1
        this._pending.delete(rid)
      }
    }
    this._post({ type: 'cancelRender', requestId: 0, docId, pageNum })
  }

  /** 请求提取文本（返回 char positions + chars 字符串） */
  async requestTextExtract(docId: number, pageNum: number, scale: number): Promise<PageTextResult> {
    this._ensureWorker()
    const requestId = this._nextRequestId()

    const promise = new Promise<PageTextResult>((resolve, reject) => {
      this._pending.set(requestId, {
        type: 'extractText',
        resolve: (data: WorkerResponse & { type: 'textExtracted' }) => {
          resolve({ pageNum: data.pageNum, positions: data.positions, chars: data.chars, pageW: data.pageW, pageH: data.pageH })
        },
        reject,
        docId, pageNum,
      })
    })

    this._post({ type: 'extractText', requestId, docId, pageNum, scale })
    return promise
  }

  /** 清空特定文档的位图缓存（缩放时用） */
  evictDocBitmaps(docId: number) {
    const toDelete: string[] = []
    for (const [key, entry] of this._bitmaps) {
      if (key.startsWith(`${docId}:`)) {
        try { entry.bitmap.close() } catch {}
        this._bitmapBytes -= entry.bytes
        toDelete.push(key)
      }
    }
    for (const k of toDelete) this._bitmaps.delete(k)
    console.log('[pdf-wasm-v2] evicted', toDelete.length, 'bitmaps for docId=', docId)
    this._updateStatus()
  }

  /** 销毁协调器：终止 worker，释放所有缓存 */
  destroy() {
    console.log('[pdf-wasm-v2] destroy')
    if (this._idleTimer) { clearInterval(this._idleTimer); this._idleTimer = null }
    // 清理 pending
    for (const [, p] of this._pending) {
      p.reject(new Error('coordinator destroyed'))
    }
    this._pending.clear()
    // 清理位图
    for (const [, entry] of this._bitmaps) {
      try { entry.bitmap.close() } catch {}
    }
    this._bitmaps.clear()
    this._bitmapBytes = 0
    // 终止 worker
    if (this._worker) {
      try { this._post({ type: 'destroy' }) } catch {}
      this._worker.terminate()
      this._worker = null
      this._workerReady = false
    }
    this._docs.clear()
    this._queue = []
    this._status = { state: 'idle', documents: 0, bitmapEntries: 0, bitmapCacheMB: 0, queueDepth: 0 }
  }

  // ============ 私有方法 ============

  private _ensureWorker() {
    if (this._worker) return
    console.log('[pdf-wasm-v2] spawning worker')
    const t0 = performance.now()

    let worker: Worker
    if (this._workerFactory) {
      worker = this._workerFactory()
    } else {
      worker = new Worker(new URL('./worker-engine.ts', import.meta.url), { type: 'module' })
    }
    this._worker = worker

    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const data = ev.data
      if (data.type === 'ready') {
        this._workerReady = true
        console.log('[pdf-wasm-v2] worker ready', Math.round(performance.now() - t0), 'ms')
        usePerf.getState().set({ wasmWorkerInitMs: Math.round(performance.now() - t0) })
        this._status.state = 'ready'
        return
      }

      const pending = this._pending.get(data.requestId)
      if (!pending) return
      this._pending.delete(data.requestId)

      if (data.type === 'error') {
        pending.reject(new Error(data.message))
        return
      }

      if (data.type === 'pageRendered') {
        // 取消检查
        if (pending.cancelToken && this._cancelTokens.has(pending.cancelToken)) {
          try { data.bitmap.close() } catch {}
          return
        }
        // 缓存
        const scaleNum = Math.round((pending.scale || 1) * 100)
        const cacheKey = `${pending.docId}:${pending.pageNum}:${scaleNum}`
        const prevEntry = this._bitmaps.get(cacheKey)
        const bytes = data.width * data.height * 4

        // 如果已有同 key 缓存且是全清 → 替换低清
        if (prevEntry && data.phase === 'full') {
          try { prevEntry.bitmap.close() } catch {}
          this._bitmapBytes -= prevEntry.bytes
        }

        this._bitmaps.set(cacheKey, {
          bitmap: data.bitmap, width: data.width, height: data.height,
          bytes, phase: data.phase, lastAccess: Date.now(),
        })
        this._bitmapBytes += bytes
        this._evictBitmaps()

        pending.resolve(data)
      } else {
        pending.resolve(data)
      }
    }

    worker.onerror = (ev) => {
      console.error('[pdf-wasm-v2] worker error', ev)
      this._workerError = ev.message || 'unknown worker error'
      // Reject all pending
      for (const [, p] of this._pending) {
        p.reject(new Error(this._workerError))
      }
      this._pending.clear()
    }

    // 启动空闲清理定时器
    if (!this._idleTimer) {
      this._idleTimer = setInterval(() => this._pruneIdle(), IDLE_PRUNE_INTERVAL)
    }

    this._status.state = 'loading'
  }

  private _sendRender(
    docId: number,
    pageNum: number,
    scale: number,
    phase: 'low' | 'full',
    cancelToken: number,
    onBitmap: (r: PageRenderResult) => void,
    // 非渐进时用 _resolveRender 直接 resolve，渐进模式用 onBitmap 回调
    fullCacheKey?: string,
  ) {
    const requestId = this._nextRequestId()
    this._pending.set(requestId, {
      type: 'renderPage',
      resolve: (data: WorkerResponse & { type: 'pageRendered' }) => {
        if (this._cancelTokens.has(cancelToken)) {
          try { data.bitmap.close() } catch {}
          return
        }
        onBitmap({
          pageNum: data.pageNum,
          bitmap: data.bitmap,
          width: data.width,
          height: data.height,
          phase: data.phase,
        })
      },
      reject: (err) => {
        console.warn('[pdf-wasm-v2] render failed page=', pageNum, err.message)
      },
      cancelToken,
      docId,
      pageNum,
      scale,
    })
    this._post({ type: 'renderPage', requestId, docId, pageNum, scale, progressive: phase === 'low' })
  }

  private _releaseDoc(docId: number) {
    const entry = this._docs.get(docId)
    if (!entry) return
    entry.refCount--
    console.log('[pdf-wasm-v2] doc release', entry.url, 'refCount=', entry.refCount)
    if (entry.refCount <= 0) {
      // 发送 closeDocument 到 worker
      const requestId = this._nextRequestId()
      this._post({ type: 'closeDocument', requestId, docId })
      // 清理位图缓存
      this.evictDocBitmaps(docId)
      this._docs.delete(docId)
      this._updateStatus()
      console.log('[pdf-wasm-v2] doc closed', entry.url)
    }
  }

  private _evictDocs() {
    if (this._docs.size < MAX_DOCS) return
    let oldest: { id: number; access: number } | null = null
    for (const [id, entry] of this._docs) {
      if (!oldest || entry.lastAccess < oldest.access) {
        oldest = { id, access: entry.lastAccess }
      }
    }
    if (oldest) {
      const entry = this._docs.get(oldest.id)
      if (entry && entry.refCount <= 0) {
        this._releaseDoc(oldest.id)
      }
    }
  }

  private _evictBitmaps() {
    const maxBytes = MAX_CACHE_MB * 1024 * 1024
    while (this._bitmapBytes > maxBytes && this._bitmaps.size > 0) {
      // LRU 逐出
      let oldestKey: string | null = null
      let oldestAccess = Infinity
      for (const [key, entry] of this._bitmaps) {
        // 优先逐出低清缓存
        const weight = entry.phase === 'low' ? entry.lastAccess / 2 : entry.lastAccess
        if (weight < oldestAccess) {
          oldestAccess = weight
          oldestKey = key
        }
      }
      if (oldestKey) {
        const entry = this._bitmaps.get(oldestKey)!
        try { entry.bitmap.close() } catch {}
        this._bitmapBytes -= entry.bytes
        this._bitmaps.delete(oldestKey)
      }
    }
  }

  private _pruneIdle() {
    const now = Date.now()
    for (const [id, entry] of this._docs) {
      if (entry.refCount <= 0 && now - entry.lastAccess > DOC_IDLE_MS) {
        console.log('[pdf-wasm-v2] prune idle doc', entry.url)
        this._releaseDoc(id)
      }
    }
  }

  private _nextRequestId(): number {
    return ++this._requestId
  }

  private _post(msg: WorkerRequest) {
    if (!this._worker) throw new Error('worker not initialized')
    this._worker.postMessage(msg)
  }

  private _updateStatus() {
    this._status = {
      state: this._workerReady ? 'ready' : this._worker ? 'loading' : 'idle',
      documents: this._docs.size,
      bitmapEntries: this._bitmaps.size,
      bitmapCacheMB: Math.round(this._bitmapBytes / (1024 * 1024) * 10) / 10,
      queueDepth: this._pending.size,
    }
  }
}