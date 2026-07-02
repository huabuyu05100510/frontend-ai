// 任务列表状态：拉取 / 轮询转码状态 / 上传
import { create } from 'zustand'
import type { Task } from './types'

interface State {
  tasks: Task[]
  loading: boolean
  uploading: boolean
  uploadPct: number      // 当前上传进度 0..1
  uploadName: string | null
  selected: Task | null
  // 拉取一次任务列表
  fetchTasks: () => Promise<void>
  // 上传单/多文件（XHR 上传进度）
  upload: (files: File[]) => Promise<void>
  // 选中预览
  select: (t: Task | null) => void
  // 轮询：当存在 pending/processing 任务时高频刷新
  refreshIfNeeded: () => Promise<void>
}

export const useStore = create<State>((set, get) => ({
  tasks: [],
  loading: false,
  uploading: false,
  uploadPct: 0,
  uploadName: null,
  selected: null,

  async fetchTasks() {
    set({ loading: true })
    try {
      const r = await fetch('/api/tasks')
      const j = await r.json()
      set({ tasks: j.tasks || [] })
    } finally {
      set({ loading: false })
    }
  },

  async upload(files) {
    set({ uploading: true, uploadPct: 0, uploadName: null })
    try {
      for (const f of Array.from(files)) {
        set({ uploadName: f.name, uploadPct: 0 })
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.upload.onprogress = (e: ProgressEvent) => {
            if (e.lengthComputable) set({ uploadPct: e.loaded / e.total })
          }
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve()
            else {
              let msg = `上传失败 ${f.name}`
              try { msg = JSON.parse(xhr.responseText).error || msg } catch {}
              reject(new Error(msg))
            }
          }
          xhr.onerror = () => reject(new Error(`网络错误 ${f.name}`))
          const fd = new FormData()
          fd.append('file', f, f.name)
          xhr.open('POST', '/api/upload')
          xhr.send(fd)
        })
      }
      await get().fetchTasks()
    } finally {
      set({ uploading: false, uploadPct: 0, uploadName: null })
    }
  },

  select(t) {
    set({ selected: t })
  },

  async refreshIfNeeded() {
    const { tasks } = get()
    const busy = tasks.some(t => t.convertStatus === 'pending' || t.convertStatus === 'processing' || t.convertStatus === 'retrying')
    if (!busy) return
    await get().fetchTasks()
    // 若当前预览中的任务刚刚 ready，自动选中最新版本
    const cur = get().selected
    if (cur) {
      const next = get().tasks.find(t => t.id === cur.id)
      if (next && next !== cur) set({ selected: next })
    }
  }
}))
