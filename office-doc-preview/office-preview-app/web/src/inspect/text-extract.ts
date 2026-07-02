// 文本提取工具（从 InspectCompareModal 提取）
// 模型：claude-sonnet-4-6
import type { Task } from '../types'

/** fetch 纯文本，超限截断 */
export async function fetchRawText(url: string, max = 200 * 1024): Promise<string> {
  const r = await fetch(url, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`)
  const t = await r.text()
  return t.length > max ? t.slice(0, max) : t
}

/** 从 HTML 文字层提取纯文本（保留换行，跳过重叠标签） */
export function htmlToPlainText(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || div.innerText || ''
}

/**
 * 提取任务文本（支持 txt/md 直读 + PDF/DOCX 文字层拼接）
 * PDF/DOCX 转码完成后每页都有 textUrl（HTML 文字层），拼接即可
 */
export async function extractText(task: Task): Promise<string> {
  const ext = (task.previewExt || task.ext || '').toLowerCase()

  // 纯文本直接读
  if (['txt', 'md'].includes(ext)) {
    return fetchRawText(task.originalUrl)
  }

  // PDF/DOCX：从各页文字层拼接
  if (task.pages && task.pages.length > 0) {
    const pageTexts = await Promise.all(
      task.pages
        .filter(p => p.textUrl)
        .map(p => fetchRawText(p.textUrl!).then(htmlToPlainText))
    )
    const full = pageTexts.join('\n').trim()
    if (full.length > 0) return full
  }

  // 兜底：直接读原文件（对 txt 友好，对 binary 无意义）
  return fetchRawText(task.originalUrl)
}
