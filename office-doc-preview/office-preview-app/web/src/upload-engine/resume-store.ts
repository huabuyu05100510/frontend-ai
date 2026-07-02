// ============================================================
// 断点续传存储
// localStorage 存元数据（hash + 已上传分片索引）
// 秒传命中 / 上传完成后清理
// ============================================================

const PREFIX = 'upload_meta_'

interface ResumeMeta {
  fileName: string
  fileSize: number
  totalChunks: number
  uploadedIndexes: number[]
  hash: string
}

export const ResumeStore = {
  get(hash: string): ResumeMeta | null {
    try {
      const raw = localStorage.getItem(PREFIX + hash)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  },

  set(hash: string, meta: ResumeMeta): void {
    try {
      localStorage.setItem(PREFIX + hash, JSON.stringify(meta))
    } catch {
      // localStorage 满了，降级
    }
  },

  markUploaded(hash: string, index: number): void {
    const meta = this.get(hash)
    if (meta && !meta.uploadedIndexes.includes(index)) {
      meta.uploadedIndexes.push(index)
      this.set(hash, meta)
    }
  },

  remove(hash: string): void {
    localStorage.removeItem(PREFIX + hash)
  },
}