// types.ts 测试
import { describe, it, expect } from 'vitest'
import { previewKindOf, fileIcon, stageLabel, humanSize, formatTime, type Task } from '../src/types'

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1', name: 'a.pdf', size: 100, ext: 'pdf', mime: 'application/pdf',
    strategy: 'frontend', originalUrl: '/o', previewUrl: '/p', previewExt: 'pdf',
    convertStatus: 'done', status: 'ready', createdAt: 0, updatedAt: 0,
    ...over
  } as Task
}

describe('previewKindOf', () => {
  it('PDF 且无 pages → pdf（pdf.js）', () => {
    expect(previewKindOf(task({ ext: 'pdf' }))).toBe('pdf')
  })

  it('PDF 且有 pages → pdf-images（性能模式）', () => {
    expect(previewKindOf(task({
      ext: 'pdf',
      pages: [{ page: 1, url: '/p/1', width: 100, height: 100, bytes: 1000 }]
    }))).toBe('pdf-images')
  })

  it('PDF 但 pages=[] → pdf（不空数组才生效）', () => {
    expect(previewKindOf(task({ ext: 'pdf', pages: [] }))).toBe('pdf')
  })

  it('DOCX → docx', () => {
    expect(previewKindOf(task({ ext: 'docx', previewExt: 'docx' }))).toBe('docx')
  })

  it('PNG → image', () => {
    expect(previewKindOf(task({ ext: 'png', previewExt: 'png' }))).toBe('image')
  })

  it('MP4 → video', () => {
    expect(previewKindOf(task({ ext: 'mp4', previewExt: 'mp4' }))).toBe('video')
  })

  it('MP3 → audio', () => {
    expect(previewKindOf(task({ ext: 'mp3', previewExt: 'mp3' }))).toBe('audio')
  })

  it('TXT → text', () => {
    expect(previewKindOf(task({ ext: 'txt', previewExt: 'txt' }))).toBe('text')
  })

  it('未知扩展 → unsupported', () => {
    expect(previewKindOf(task({ ext: 'zip', previewExt: 'zip' }))).toBe('unsupported')
  })

  it('previewExt 优先于 ext（PDF 转码后）', () => {
    expect(previewKindOf(task({ ext: 'docx', previewExt: 'pdf' }))).toBe('pdf')
  })
})

describe('fileIcon', () => {
  it('每个常见扩展返回正确徽章', () => {
    expect(fileIcon('pdf')).toBe('PDF')
    expect(fileIcon('docx')).toBe('DOC')
    expect(fileIcon('pptx')).toBe('PPT')
    expect(fileIcon('xlsx')).toBe('XLS')
    expect(fileIcon('png')).toBe('IMG')
    expect(fileIcon('mp4')).toBe('VID')
    expect(fileIcon('mp3')).toBe('AUD')
    expect(fileIcon('txt')).toBe('TXT')
    expect(fileIcon('zip')).toBe('ZIP')
  })
  it('大写不敏感', () => {
    expect(fileIcon('PDF')).toBe('PDF')
    expect(fileIcon('Docx')).toBe('DOC')
  })
})

describe('stageLabel', () => {
  it('每个阶段有中文标签', () => {
    expect(stageLabel('convert')).toMatch(/转换/)
    expect(stageLabel('linearize')).toMatch(/线性化/)
    expect(stageLabel('thumb')).toMatch(/缩略图/)
    expect(stageLabel('pages')).toMatch(/栅格化/)
  })
  it('null 返回空串', () => {
    expect(stageLabel(null)).toBe('')
  })
})

describe('humanSize', () => {
  it('单位换算', () => {
    expect(humanSize(0)).toBe('0 B')
    expect(humanSize(512)).toBe('512 B')
    expect(humanSize(2048)).toBe('2.0 KB')
    expect(humanSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
  it('undefined 显示 -', () => {
    expect(humanSize(undefined)).toBe('-')
  })
})

describe('formatTime', () => {
  it('输出 YYYY-MM-DD HH:MM', () => {
    const s = formatTime(new Date('2026-06-20T03:30:00').getTime())
    expect(s).toMatch(/^2026-06-20 03:30$/)
  })
})