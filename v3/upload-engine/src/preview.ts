// ============================================================
// 文件预览管理器
// 图片：原生预览 + EXIF 矫正后对比
// 视频：WebCodecs 关键帧缩略图 + video 元素降级
// 音频：波形绘制 + 播放
// 文档：PDF 首页渲染 + 文本预览
// ============================================================

import { extractVideoThumbnail, generateAudioWaveform, drawWaveform } from './webcodecs-preview'

export type PreviewType = 'image' | 'video' | 'audio' | 'document' | 'unknown'

export interface FilePreview {
  type: PreviewType
  name: string
  size: number
  // 图片
  originalUrl?: string
  processedUrl?: string  // EXIF 矫正后
  exifOrientation?: string
  // 视频
  thumbnails?: { dataUrl: string; timestamp: number }[]
  duration?: number
  // 音频
  waveformCanvas?: HTMLCanvasElement
  // 文档
  textContent?: string
  pageCount?: number
}

/**
 * 生成文件预览
 */
export async function generatePreview(file: File): Promise<FilePreview> {
  const type = detectPreviewType(file)
  const preview: FilePreview = { type, name: file.name, size: file.size }

  switch (type) {
    case 'image':
      preview.originalUrl = URL.createObjectURL(file)
      break

    case 'video': {
      const thumbs = await extractVideoThumbnail(file, 3)
      preview.thumbnails = thumbs.map(t => ({
        dataUrl: t.dataUrl,
        timestamp: t.timestamp,
      }))
      preview.duration = await getVideoDuration(file)
      break
    }

    case 'audio': {
      const waveform = await generateAudioWaveform(file)
      if (waveform) {
        preview.duration = waveform.duration
        const canvas = document.createElement('canvas')
        canvas.width = 400
        canvas.height = 80
        drawWaveform(canvas, waveform)
        preview.waveformCanvas = canvas
      }
      break
    }

    case 'document':
      if (file.type === 'application/pdf') {
        preview.pageCount = await getPDFPageCount(file)
      } else if (file.type.startsWith('text/')) {
        preview.textContent = await file.text()
      }
      break
  }

  return preview
}

function detectPreviewType(file: File): PreviewType {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type === 'application/pdf' ||
      file.type.includes('document') ||
      file.type.includes('spreadsheet') ||
      file.type.includes('presentation') ||
      file.type.startsWith('text/') ||
      file.name.match(/\.(pdf|docx?|pptx?|xlsx?|txt|md|csv)$/i)) {
    return 'document'
  }
  return 'unknown'
}

async function getVideoDuration(file: File): Promise<number> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(video.duration)
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(0)
    }
    video.src = url
  })
}

async function getPDFPageCount(file: File): Promise<number> {
  // 读 PDF 头部获取页数（/Type/Pages/Count 或读取 xref 表）
  // 简化实现：读文件找 /N 标记
  const text = await file.slice(0, 65536).text()
  // PDF 页码通常在 trailer 中：/Count N
  const match = text.match(/\/Count\s+(\d+)/)
  return match ? parseInt(match[1], 10) : 1
}

/**
 * 清理解预览资源
 */
export function revokePreview(preview: FilePreview): void {
  if (preview.originalUrl) URL.revokeObjectURL(preview.originalUrl)
  if (preview.processedUrl) URL.revokeObjectURL(preview.processedUrl)
  if (preview.waveformCanvas) {
    preview.waveformCanvas.width = 0
    preview.waveformCanvas.height = 0
  }
}