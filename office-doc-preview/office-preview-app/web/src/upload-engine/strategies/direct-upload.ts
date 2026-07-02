// ============================================================
// 小文件直传策略（document < 50MB, image < 4MB）
// 使用 XHR 以获取精确上传进度（fetch 不支持上传进度）
// ============================================================

import type { UploadConfig } from '../types'
import { retryWithBackoff } from '../concurrency'

interface DirectUploadOptions {
  file: File
  config: UploadConfig
  hash: string
  signal?: AbortSignal
  onProgress: (pct: number) => void
}

export async function directUpload(opts: DirectUploadOptions): Promise<string> {
  const { file, config, hash, signal, onProgress } = opts

  return retryWithBackoff(async () => {
    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const form = new FormData()
      form.append('file', file)
      form.append('hash', hash)
      form.append('scenario', config.scenario)

      signal?.addEventListener('abort', () => {
        xhr.abort()
        reject(new DOMException('Aborted', 'AbortError'))
      })

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText)
            resolve(data.url ?? '')
          } catch {
            resolve('')
          }
        } else if (xhr.status >= 400 && xhr.status < 500) {
          resolve('') // 4xx 不重试，返回空 URL
        } else {
          reject(new Error(`HTTP ${xhr.status}`))
        }
      }

      xhr.onerror = () => reject(new Error('Network error'))
      xhr.ontimeout = () => reject(new Error('Timeout'))

      xhr.open('POST', config.uploadUrl)
      if (config.headers) {
        for (const [k, v] of Object.entries(config.headers)) {
          xhr.setRequestHeader(k, v)
        }
      }
      xhr.send(form)
    })
  }, config.retry)
}