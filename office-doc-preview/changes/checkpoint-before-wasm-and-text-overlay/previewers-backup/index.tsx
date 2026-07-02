import { lazy, Suspense } from 'react'
import type { Task } from '../types'
import { previewKindOf } from '../types'

// 暂时切换回pdf.js版本（pdfium WASM返回空白bitmap）
const PdfPreview = lazy(() => import('./PdfPreview').then(m => ({ default: m.PdfPreview })))
const PdfImagesPreview = lazy(() => import('./PdfImagesPreview').then(m => ({ default: m.PdfImagesPreview })))
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

interface Props {
  task: Task
  /** 父级已解析的渲染模式：'pdf' 走 pdf.js；'images' 走服务端栅格化图片 */
  mode?: 'pdf' | 'images'
}

/**
 * PDF 渲染决策：
 *   - mode='images' 且 task.pages 存在  → 服务端栅格化图片（<img>）
 *   - 其他情况                          → pdf.js
 */
function pdfRenderer(task: Task, mode: 'pdf' | 'images') {
  const url = task.previewUrl || task.originalUrl
  if (mode === 'images' && task.pages && task.pages.length > 0) {
    return <PdfImagesPreview task={task} />
  }
  return <PdfPreview url={url} docSize={task.previewSize || task.size} task={task} />
}

export function PreviewRouter({ task, mode }: Props) {
  const kind = previewKindOf(task)
  const url = task.previewUrl || task.originalUrl
  const resolvedMode: 'pdf' | 'images' = mode ?? (task.pages && task.pages.length > 0 ? 'images' : 'pdf')

  // PDF 走双模式分发
  if (kind === 'pdf' || kind === 'pdf-images') {
    return (
      <Suspense fallback={<Fallback />}>
        {pdfRenderer(task, resolvedMode)}
      </Suspense>
    )
  }

  return (
    <Suspense fallback={<Fallback />}>
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