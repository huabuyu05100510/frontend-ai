// 任务列表状态：拉取 / 轮询转码状态 / 上传
import { create } from 'zustand'
import type { Task, InspectMode, LangCode, TranslateResponse, TranslateStatus, TranslateRenderMode } from './types'

const BOOKMARKS_KEY = 'bookmarks'

/** 从 localStorage 读取已收藏任务 id 集合 */
function loadBookmarks(): Set<string> {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

/** 持久化收藏任务 id 集合 */
function saveBookmarks(set: Set<string>): void {
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(Array.from(set)))
  } catch {
    // localStorage 满了，降级
  }
}

interface State {
  tasks: Task[]
  loading: boolean
  uploading: boolean
  uploadPct: number      // 当前上传进度 0..1
  uploadName: string | null
  selected: Task | null
  // ============ 智检 / 双栏对比 ============
  inspectOpen: boolean
  inspectSource: Task | null   // 源任务（左侧）
  inspectCompare: Task | null  // 对比任务（右侧，可选）
  inspectMode: InspectMode
  // ============ 翻译双栏对照 ============
  translateOpen: boolean
  translateSource: Task | null
  translateTargetLang: LangCode
  translateSourceLang: LangCode
  translateStatus: TranslateStatus
  translateResult: TranslateResponse | null
  translateError: string | null
  translateRenderMode: TranslateRenderMode
  // Phase A.3: 词级对比 toggle
  translateWordDiff: boolean
  // 拉取一次任务列表
  fetchTasks: () => Promise<void>
  // 上传单/多文件（XHR 上传进度）
  upload: (files: File[]) => Promise<void>
  // 选中预览
  select: (t: Task | null) => void
  // 轮询：当存在 pending/processing 任务时高频刷新
  refreshIfNeeded: () => Promise<void>
  // 打开智检弹层（source 必传；compare 可选，后续在弹层内选；opts.mode 可指定初始 mode）
  openInspect: (source: Task, compare?: Task | null, opts?: { mode?: InspectMode }) => void
  // 关闭智检弹层
  closeInspect: () => void
  // 切换智检 / 双栏对比 / 翻译模式
  setInspectMode: (m: InspectMode) => void
  // 设置对比任务（用于在弹层内选择第二个任务）
  setInspectCompare: (t: Task | null) => void
  // 打开翻译双栏预览
  openTranslate: (source: Task) => void
  // 关闭翻译双栏预览
  closeTranslate: () => void
  // 设置翻译目标语言
  setTranslateTargetLang: (lang: LangCode) => void
  // 设置翻译源语言
  setTranslateSourceLang: (lang: LangCode) => void
  // 注入翻译结果（由组件 fetch 后写入）
  setTranslateResult: (r: TranslateResponse | null) => void
  // 设置翻译状态
  setTranslateStatus: (s: TranslateStatus) => void
  // 设置翻译错误
  setTranslateError: (e: string | null) => void
  // 设置翻译弹层渲染格式（PDF / 图片+文字 / WASM）
  setTranslateRenderMode: (m: TranslateRenderMode) => void
  // Phase A.3: 词级对比 toggle
  setTranslateWordDiff: (v: boolean) => void
  // ============ 收藏夹（任务星标） ============
  bookmarks: Set<string>
  toggleBookmark: (taskId: string) => void
  isBookmarked: (taskId: string) => boolean
  // ============ 图片翻译最近 (最近 20 个 image taskId) ============
  imageTranslateRecent: string[]
  addImageTranslateRecent: (taskId: string) => void
}

export const useStore = create<State>((set, get) => ({
  tasks: [],
  loading: false,
  uploading: false,
  uploadPct: 0,
  uploadName: null,
  selected: null,
  // 智检初始态
  inspectOpen: false,
  inspectSource: null,
  inspectCompare: null,
  inspectMode: 'inspect',
  // 翻译双栏预览初始态
  translateOpen: false,
  translateSource: null,
  translateTargetLang: 'en',
  translateSourceLang: 'zh-CN',
  translateStatus: 'idle',
  translateResult: null,
  translateError: null,
  translateRenderMode: 'images',
  translateWordDiff: false,
  // 收藏夹：从 localStorage 恢复
  bookmarks: loadBookmarks(),
  // 图片翻译最近：初始为空
  imageTranslateRecent: [],

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
  },

  // 智检：打开弹层
  openInspect(source, compare = null, opts) {
    const nextMode: InspectMode = opts?.mode
      || (compare ? 'dual' : 'inspect')
    console.info('[store] openInspect src=', source.id, 'cmp=', compare?.id || 'none', 'mode=', nextMode)
    set({
      inspectOpen: true,
      inspectSource: source,
      inspectCompare: compare,
      inspectMode: nextMode
    })
  },

  // 智检：关闭
  closeInspect() {
    set({ inspectOpen: false, inspectSource: null, inspectCompare: null })
  },

  // 智检：切换模式
  setInspectMode(m) {
    set({ inspectMode: m })
  },

  // 智检：选择第二个对比任务
  setInspectCompare(t) {
    set({ inspectCompare: t })
  },

  // 翻译双栏预览：打开（与智检解耦，可独立使用）
  openTranslate(source) {
    console.info('[store] openTranslate src=', source.id, 'name=', source.name)
    // 恢复上次偏好的渲染格式（默认 images）
    let initialMode: TranslateRenderMode = 'images'
    try {
      const saved = localStorage.getItem('translate-render-mode')
      if (saved === 'pdf' || saved === 'images' || saved === 'wasm') initialMode = saved
    } catch {}
    set({
      translateOpen: true,
      translateSource: source,
      translateStatus: 'idle',
      translateResult: null,
      translateError: null,
      translateRenderMode: initialMode
    })
  },

  // 翻译双栏预览：关闭
  closeTranslate() {
    console.info('[store] closeTranslate')
    set({ translateOpen: false, translateSource: null, translateResult: null, translateError: null })
  },

  // 翻译双栏预览：目标语言
  setTranslateTargetLang(lang) {
    console.info('[store] setTranslateTargetLang =', lang)
    set({ translateTargetLang: lang })
  },

  // 翻译双栏预览：源语言
  setTranslateSourceLang(lang) {
    console.info('[store] setTranslateSourceLang =', lang)
    set({ translateSourceLang: lang })
  },

  // 翻译双栏预览：注入结果
  setTranslateResult(r) {
    set({ translateResult: r })
  },

  // 翻译双栏预览：状态
  setTranslateStatus(s) {
    set({ translateStatus: s })
  },

  // 翻译双栏预览：错误
  setTranslateError(e) {
    set({ translateError: e })
  },

  // 翻译双栏预览：渲染格式
  setTranslateRenderMode(m) {
    console.info('[store] setTranslateRenderMode =', m)
    try { localStorage.setItem('translate-render-mode', m) } catch {}
    set({ translateRenderMode: m })
  },

  // Phase A.3: 词级对比 toggle
  setTranslateWordDiff(v: boolean) {
    console.info('[store] setTranslateWordDiff =', v)
    set({ translateWordDiff: !!v })
  },

  // 收藏夹：切换任务星标
  toggleBookmark(taskId) {
    const next = new Set(get().bookmarks)
    const ts = new Date().toISOString()
    if (next.has(taskId)) {
      next.delete(taskId)
      console.info(`[store ${ts}] toggleBookmark remove:`, taskId)
    } else {
      next.add(taskId)
      console.info(`[store ${ts}] toggleBookmark add:`, taskId)
    }
    saveBookmarks(next)
    set({ bookmarks: next })
  },

  // 收藏夹：是否已收藏
  isBookmarked(taskId) {
    return get().bookmarks.has(taskId)
  },

  // 图片翻译最近：插入并去重，保留最近 20 个
  addImageTranslateRecent(taskId) {
    if (!taskId) return
    const cur = get().imageTranslateRecent
    const next = [taskId, ...cur.filter(t => t !== taskId)].slice(0, 20)
    console.info('[store] addImageTranslateRecent:', taskId, '-> size=', next.length)
    set({ imageTranslateRecent: next })
  },
}))
