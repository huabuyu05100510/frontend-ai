import { lazy, Suspense } from 'react'
import type { Task } from '../types'
import { previewKindOf } from '../types'

// 按格式分包：PDF（pdf.js ~1MB）、DOCX（mammoth ~300KB）按需懒加载，
// 不在首屏任务列表的初始 bundle 里 → FCP/LCP 更快。
const PdfPreview = lazy(() => import('./PdfPreview').then(m => ({ default: m.PdfPreview })))
const DocxPreview = lazy(() => import('./DocxPreview').then(m => ({ default: m.DocxPreview })))
const ImagePreview = lazy(() => import('./MediaPreview').then(m => ({ default: m.ImagePreview })))
const VideoPreview = lazy(() => import('./MediaPreview').then(m => ({ default: m.VideoPreview })))
const AudioPreview = lazy(() => import('./MediaPreview').then(m => ({ default: m.AudioPreview })))
const TextPreview = lazy(() => import('./TextPreview').then(m => ({ default: m.TextPreview })))

function Fallback() {
  return (
    <div className="center-msg">
      <div className="spin" />
      <div className="hint" style={{ marginTop: 10 }}>加载预览器…</div>
    </div>
  )
}

interface Props { task: Task }

export function PreviewRouter({ task }: Props) {
  const kind = previewKindOf(task)
  const url = task.previewUrl || task.originalUrl

  return (
    <Suspense fallback={<Fallback />}>
      {kind === 'pdf' && <PdfPreview url={url} docSize={task.previewSize || task.size} />}
      {kind === 'docx' && <DocxPreview url={url} />}
      {kind === 'image' && <ImagePreview url={url} />}
      {kind === 'video' && <VideoPreview url={url} />}
      {kind === 'audio' && <AudioPreview url={url} />}
      {kind === 'text' && <TextPreview url={url} />}
      {kind === 'unsupported' && (
        <div className="center-msg err">暂不支持的预览格式：.{task.ext}</div>
      )}
    </Suspense>
  )
}
