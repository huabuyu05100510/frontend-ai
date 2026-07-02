// 模型：claude-sonnet-4-6
// useCrossPageHandoff — 跨页面任务移交（点击 task card 跳到翻译/智检/OCR 并携带上下文）
//
// 用法：
//   const handoff = useCrossPageHandoff()
//   handoff('task-123', 'translate', { text: 'hello', src: 'en' })
//   → navigate(`/translate?task=task-123&text=hello&src=en`)

import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

export type HandoffTarget = 'translate' | 'qc' | 'ocr'

export interface HandoffOpts {
  /** 可选文本（用于 OCR/QC 实时粘贴模式） */
  text?: string
  /** 源语言代码（默认 'auto'） */
  src?: string
  /** 目标语言代码（默认 'zh-CN'） */
  tgt?: string
}

const TARGET_TO_PATH: Record<HandoffTarget, string> = {
  translate: '/translate',
  qc: '/qc',
  ocr: '/ocr',
}

export type HandoffFn = (taskId: string, target: HandoffTarget, opts?: HandoffOpts) => void

export function useCrossPageHandoff(): HandoffFn {
  const navigate = useNavigate()
  return useCallback<HandoffFn>((taskId, target, opts = {}) => {
    const path = TARGET_TO_PATH[target]
    const params = new URLSearchParams()
    params.set('task', taskId)
    if (opts.text) params.set('text', opts.text)
    if (opts.src) params.set('src', opts.src)
    if (opts.tgt) params.set('tgt', opts.tgt)
    const url = `${path}?${params.toString()}`
    const ts = new Date().toISOString()
    console.info(`[handoff ${ts}] ${taskId} → ${target}: ${url}`)
    navigate(url)
  }, [navigate])
}