import { lazy, Suspense } from 'react'
import type { Task } from '../types'
import { previewKindOf } from '../types'

// 三种 PDF 渲染实现：pdf.js（兜底）/ 图片栅格化 / pdfium WASM（性能最佳）
const PdfPreview = lazy(() => import('./PdfPreview').then(m => ({ default: m.PdfPreview })))
const PdfImagesPreview = lazy(() => import('./PdfImagesPreview').then(m => ({ default: m.PdfImagesPreview })))
const PdfPreviewWASM = lazy(() => import('./PdfPreviewWASM').then(m => ({ default: m.PdfPreviewWASM })))
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

export type PdfRenderMode = 'pdf' | 'images' | 'wasm'

interface Props {
  task: Task
  /** 父级已解析的渲染模式：'pdf' | 'images' | 'wasm' */
  mode?: PdfRenderMode
}

/**
 * PDF 渲染决策：
 *   - mode='images' 且 task.pages 存在  → 服务端栅格化图片（<img>，最快但不可选）
 *   - mode='wasm'                       → pdfium WASM（性能最佳，支持线程；需要 crossOriginIsolated）
 *   - 其他                              → pdf.js（默认，兼容性最好）
 */
function pdfRenderer(task: Task, mode: PdfRenderMode) {
  const url = task.previewUrl || task.originalUrl
  if (mode === 'images' && task.pages && task.pages.length > 0) {
    return <PdfImagesPreview task={task} />
  }
  if (mode === 'wasm') {
    // 上传文件场景：从 task.pages 构造 serverTextUrlTemplate
    const firstPage = task.pages?.[0]
    const serverTextUrlTemplate = firstPage?.textUrl
      ? firstPage.textUrl.replace(/n=\d+/, 'n=N')
      : undefined
    return (
      <PdfPreviewWASM
        url={url}
        docSize={task.previewSize || task.size}
        serverTextUrlTemplate={serverTextUrlTemplate}
      />
    )
  }
  return <PdfPreview url={url} docSize={task.previewSize || task.size} task={task} />
}

/** auto 模式：根据是否有 pages 决定 images / pdf（wasm 必须显式选） */
function resolveAutoMode(task: Task): PdfRenderMode {
  if (task.pages && task.pages.length > 0) return 'images'
  return 'pdf'
}

export function PreviewRouter({ task, mode }: Props) {
  const kind = previewKindOf(task)
  const url = task.previewUrl || task.originalUrl
  const resolvedMode: PdfRenderMode = mode ?? resolveAutoMode(task)

  // PDF 走三模式分发
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