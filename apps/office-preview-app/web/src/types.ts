// 与后端对齐的任务类型
export type ConvertStatus = 'pending' | 'processing' | 'retrying' | 'done' | 'failed'
export type Strategy = 'frontend' | 'convert_pdf' | 'unsupported'

export interface Task {
  id: string
  name: string
  size: number
  ext: string
  mime: string
  strategy: Strategy
  originalUrl: string
  previewUrl: string | null
  previewExt: string | null
  convertStatus: ConvertStatus
  convertError?: string | null
  convertDurationMs?: number
  convertRetries?: number
  convertEtaSec?: number
  convertElapsedSec?: number
  convertBytesPerSec?: number
  previewSize?: number
  status: string
  createdAt: number
  updatedAt: number
}

// 渲染分类（前端根据 ext + strategy 派发）
export type PreviewKind =
  | 'pdf'         // pdf.js（包含原生 pdf + 转码后的 pdf）
  | 'docx'        // mammoth
  | 'image'
  | 'audio'
  | 'video'
  | 'text'
  | 'unsupported'

export function previewKindOf(task: Task): PreviewKind {
  const ext = (task.previewExt || task.ext).toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'svg'].includes(ext)) return 'image'
  if (['mp3', 'wav', 'm4a', 'aac', 'pcm', 'amr'].includes(ext)) return 'audio'
  if (['mp4', 'm4v', 'mov', 'mkv', 'flv', 'webm'].includes(ext)) return 'video'
  if (['txt', 'md'].includes(ext)) return 'text'
  return 'unsupported'
}

export function humanSize(n?: number) {
  if (!n && n !== 0) return '-'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

export function formatTime(t: number) {
  const d = new Date(t)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fileIcon(ext: string): string {
  const e = ext.toLowerCase()
  if (e === 'pdf') return 'PDF'
  if (e === 'docx' || e === 'doc') return 'DOC'
  if (e === 'pptx' || e === 'ppt') return 'PPT'
  if (e === 'xlsx' || e === 'xls') return 'XLS'
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif'].includes(e)) return 'IMG'
  if (['mp3', 'wav', 'm4a', 'aac'].includes(e)) return 'AUD'
  if (['mp4', 'mov', 'mkv', 'flv', 'webm'].includes(e)) return 'VID'
  if (['txt', 'md'].includes(e)) return 'TXT'
  return e.slice(0, 3).toUpperCase()
}
