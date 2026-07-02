// ============================================================
// 预测式上传 + 优先级队列
// 对标：Google Photos / iCloud 预上传策略
// 用户选择文件后立即后台静默上传，提交时感知延迟 → 0
// ============================================================

import { Semaphore } from './concurrency'

type Priority = 0 | 1 | 2  // 0=最高, 1=普通, 2=低

interface QueueItem {
  id: string
  file: File
  priority: Priority
  status: 'queued' | 'pre-uploading' | 'pre-done' | 'committed'
  progress: number
  url: string | null
  abort: AbortController
}

export class PredictiveUploader {
  private queue: QueueItem[] = []
  private semaphore: Semaphore
  private uploadFn: (file: File, signal: AbortSignal) => Promise<string>
  private onQueueChange?: () => void

  constructor(
    uploadFn: (file: File, signal: AbortSignal) => Promise<string>,
    concurrency: number = 2,
  ) {
    this.uploadFn = uploadFn
    this.semaphore = new Semaphore(concurrency)
  }

  /**
   * 预上传：用户选择文件时立即调用
   * 在后台静默上传，不阻塞用户操作
   */
  preUpload(file: File, priority: Priority = 1): string {
    const id = crypto.randomUUID()
    const item: QueueItem = {
      id, file, priority,
      status: 'queued',
      progress: 0,
      url: null,
      abort: new AbortController(),
    }

    // 按优先级插入队列
    const insertIdx = this.queue.findIndex(q => q.priority > priority)
    if (insertIdx === -1) {
      this.queue.push(item)
    } else {
      this.queue.splice(insertIdx, 0, item)
    }

    this.onQueueChange?.()
    this.processQueue()
    return id
  }

  /**
   * 批量预上传
   */
  preUploadAll(files: File[], priority: Priority = 1): string[] {
    return files.map(f => this.preUpload(f, priority))
  }

  /**
   * 消费者：处理队列
   */
  private async processQueue(): Promise<void> {
    const pending = this.queue.filter(q => q.status === 'queued')
    for (const item of pending) {
      this.semaphore.run(async () => {
        item.status = 'pre-uploading'
        this.onQueueChange?.()

        try {
          item.url = await this.uploadFn(item.file, item.abort.signal)
          item.status = 'pre-done'
          item.progress = 100
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            item.status = 'queued' // 失败重新入队
          }
        }

        this.onQueueChange?.()
      })
    }
  }

  /**
   * 提交：用户点击"提交"时调用
   * 大部分文件已预上传完成，感知延迟极低
   */
  async commit(id: string, metadata?: Record<string, any>): Promise<string | null> {
    const item = this.queue.find(q => q.id === id)
    if (!item) return null

    // 如果还在预上传中，等待完成
    if (item.status === 'pre-uploading' || item.status === 'queued') {
      await this.waitForPreUpload(item)
    }

    item.status = 'committed'
    this.onQueueChange?.()

    // 提交元数据（文件名、分类、描述等）
    if (metadata && item.url) {
      await fetch('/api/upload/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.url, ...metadata }),
      })
    }

    return item.url
  }

  /**
   * 批量提交
   */
  async commitAll(metadata?: Record<string, any>[]): Promise<(string | null)[]> {
    return Promise.all(this.queue.map((item, i) =>
      this.commit(item.id, metadata?.[i]),
    ))
  }

  private async waitForPreUpload(item: QueueItem): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        if (item.status === 'pre-done' || item.status === 'committed') {
          resolve()
        } else {
          setTimeout(check, 100)
        }
      }
      check()
    })
  }

  cancel(id: string): void {
    const item = this.queue.find(q => q.id === id)
    if (item) {
      item.abort.abort()
      this.queue = this.queue.filter(q => q.id !== id)
      this.onQueueChange?.()
    }
  }

  cancelAll(): void {
    this.queue.forEach(q => q.abort.abort())
    this.queue = []
    this.onQueueChange?.()
  }

  getQueue(): QueueItem[] {
    return [...this.queue]
  }

  getStats(): { total: number; preDone: number; uploading: number; queued: number } {
    return {
      total: this.queue.length,
      preDone: this.queue.filter(q => q.status === 'pre-done' || q.status === 'committed').length,
      uploading: this.queue.filter(q => q.status === 'pre-uploading').length,
      queued: this.queue.filter(q => q.status === 'queued').length,
    }
  }

  onChange(fn: () => void): void {
    this.onQueueChange = fn
  }
}