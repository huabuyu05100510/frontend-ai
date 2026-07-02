// Worker 通信封装 — 计算文件指纹
import HashWorker from './workers/hash.worker?worker'
import type { HashResult } from './workers/hash.worker'

export function computeHash(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new HashWorker()
    worker.onmessage = (e: MessageEvent<HashResult>) => {
      worker.terminate()
      if (e.data.type === 'done') resolve(e.data.hash)
      else reject(new Error(e.data.error))
    }
    worker.onerror = (err: ErrorEvent) => {
      worker.terminate()
      reject(err)
    }
    worker.postMessage({ file })
  })
}