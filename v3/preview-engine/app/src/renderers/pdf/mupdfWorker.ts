// ============================================================================
// mupdfWorker — mupdf.wasm Web Worker
//   协议（三条消息）：
//   1) { type:'load',   buffer, msgId }  → { type:'loaded',  msgId, pageCount }
//      Worker 接管 buffer 所有权，创建并缓存 Document 对象。
//   2) { type:'render', pageIndex, scale, dpr, msgId }
//                                         → { type:'result',  msgId, ... } | 'error'
//      使用缓存的 Document 渲染一页，不需要再传 buffer。
//   3) { type:'unload', msgId }           → { type:'unloaded', msgId }
//      销毁缓存 Document，释放 C 堆内存。
// ============================================================================
import * as mupdf from 'mupdf'

let cachedDoc: mupdf.Document | null = null

type InMsg =
  | { type: 'load';   buffer: ArrayBuffer; msgId: number }
  | { type: 'render'; pageIndex: number; scale: number; dpr: number; msgId: number }
  | { type: 'unload'; msgId: number }

export type OutMsg =
  | { type: 'loaded';   msgId: number; pageCount: number }
  | { type: 'result';   msgId: number; pageIndex: number; width: number; height: number; data: Uint8ClampedArray }
  | { type: 'error';    msgId: number; message: string }
  | { type: 'unloaded'; msgId: number }

function reply(msg: OutMsg, transfer?: Transferable[]): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(self as any).postMessage(msg, transfer ?? [])
}

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data

  // ── load ──────────────────────────────────────────────────────────────────
  if (msg.type === 'load') {
    try {
      if (cachedDoc) { try { cachedDoc.destroy() } catch { /* ignore */ } cachedDoc = null }
      cachedDoc = mupdf.Document.openDocument(msg.buffer, 'application/pdf')
      reply({ type: 'loaded', msgId: msg.msgId, pageCount: cachedDoc.countPages() })
    } catch (err) {
      reply({ type: 'error', msgId: msg.msgId, message: String(err) })
    }
    return
  }

  // ── render ─────────────────────────────────────────────────────────────────
  if (msg.type === 'render') {
    if (!cachedDoc) {
      reply({ type: 'error', msgId: msg.msgId, message: 'document not loaded' })
      return
    }
    let page: mupdf.Page | null = null
    let pixmap: mupdf.Pixmap | null = null
    try {
      const { pageIndex, scale, dpr, msgId } = msg
      page = cachedDoc.loadPage(pageIndex)
      const matrix = mupdf.Matrix.scale(scale * dpr, scale * dpr)
      pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false)

      const width = pixmap.getWidth()
      const height = pixmap.getHeight()
      const stride = pixmap.getStride()
      const nComp = pixmap.getNumberOfComponents()
      const src = pixmap.getPixels()

      // Convert RGB → RGBA for ImageData (handles stride padding per row)
      const data = new Uint8ClampedArray(width * height * 4)
      for (let row = 0; row < height; row++) {
        const sBase = row * stride
        const dBase = row * width * 4
        for (let col = 0; col < width; col++) {
          const s = sBase + col * nComp
          const d = dBase + col * 4
          data[d]     = src[s]
          data[d + 1] = src[s + 1]
          data[d + 2] = src[s + 2]
          data[d + 3] = nComp === 4 ? src[s + 3] : 255
        }
      }
      reply({ type: 'result', msgId, pageIndex, width, height, data }, [data.buffer])
    } catch (err) {
      reply({ type: 'error', msgId: msg.msgId, message: String(err) })
    } finally {
      try { pixmap?.destroy() } catch { /* ignore */ }
      try { page?.destroy() } catch { /* ignore */ }
    }
    return
  }

  // ── unload ─────────────────────────────────────────────────────────────────
  if (msg.type === 'unload') {
    if (cachedDoc) { try { cachedDoc.destroy() } catch { /* ignore */ } cachedDoc = null }
    reply({ type: 'unloaded', msgId: msg.msgId })
  }
}
