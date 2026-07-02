// ============================================================================
// mupdfLoader — 主线程侧 mupdf Web Worker 封装
//   load   → Worker 持有 Document，不再需要每页传 buffer
//   render → 通过 msgId 并发匹配多页请求
//   unload → 释放 Worker 内 C 堆内存
// ============================================================================
import type { OutMsg } from './mupdfWorker'

type MsgHandler = (msg: OutMsg) => void

let workerInstance: Worker | null = null
let nextMsgId = 0
const handlers = new Map<number, MsgHandler>()

function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(
      new URL('./mupdfWorker.ts', import.meta.url),
      { type: 'module' }
    )
    workerInstance.onmessage = (e: MessageEvent<OutMsg>) => {
      const msg = e.data
      const h = handlers.get(msg.msgId)
      if (h) { handlers.delete(msg.msgId); h(msg) }
    }
    workerInstance.onerror = (ev) => {
      const msg = ev.message ?? 'mupdf worker error'
      for (const [id, h] of handlers.entries()) {
        handlers.delete(id)
        h({ type: 'error', msgId: id, message: msg })
      }
    }
  }
  return workerInstance
}

/**
 * 将整个 PDF buffer 传入 Worker（转移所有权，零拷贝）。
 * Worker 内部创建并缓存 Document 对象，后续渲染不再需要传 buffer。
 * @returns PDF 总页数
 */
export function loadDocumentInWorker(buffer: ArrayBuffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const msgId = nextMsgId++
    handlers.set(msgId, (msg) => {
      if (msg.type === 'loaded') resolve(msg.pageCount)
      else if (msg.type === 'error') reject(new Error(msg.message))
    })
    getWorker().postMessage({ type: 'load', buffer, msgId }, [buffer])
  })
}

/**
 * 用 mupdf.wasm 渲染一页，返回 ImageData。
 * 需先调用 loadDocumentInWorker()。
 *
 * @param pageIndex  0-based 页码
 * @param scale      CSS 像素缩放（1.0 = 100%）
 * @param dpr        devicePixelRatio
 */
export function renderPageWithMupdf(
  pageIndex: number,
  scale: number,
  dpr: number
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const msgId = nextMsgId++
    handlers.set(msgId, (msg) => {
      if (msg.type === 'result') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        resolve(new ImageData(msg.data as any, msg.width, msg.height))
      } else if (msg.type === 'error') {
        reject(new Error(msg.message))
      }
    })
    getWorker().postMessage({ type: 'render', pageIndex, scale, dpr, msgId })
  })
}

/** 释放 Worker 内缓存的 Document（切换文档或组件 unmount 时调用） */
export function unloadDocumentFromWorker(): void {
  if (!workerInstance) return
  const msgId = nextMsgId++
  workerInstance.postMessage({ type: 'unload', msgId })
  // fire-and-forget: 不等回包
}

/** 终止 Worker（应用退出时调用） */
export function disposeMupdfWorker(): void {
  if (workerInstance) {
    workerInstance.terminate()
    workerInstance = null
    handlers.clear()
  }
}
