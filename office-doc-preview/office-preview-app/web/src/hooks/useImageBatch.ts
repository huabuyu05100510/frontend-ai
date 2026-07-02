// useImageBatch — 批量图片翻译 hook
// 模型：claude-sonnet-4-6
//
// 包装 batch API + 复用 useTranslateJob 做进度轮询
// - start(): POST /api/translate/image/batch → { jobId, total }
// - cancel(): 调用 useTranslateJob.cancel() (内部 POST /:jobId/cancel)
// - reset(): 清空所有状态
//
// items 数组：从 useTranslateJob.frames 派生（按 taskId 聚合）
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BatchStatus, ImageBatchItem } from '../types'
import { useTranslateJob } from './useTranslateJob'

interface StartOpts {
  taskIds: string[]
  sourceLang: string
  targetLang: string
  glossaryId?: string
  tmId?: string
}

interface Result {
  jobId: string | null
  status: BatchStatus
  items: ImageBatchItem[]
  start: (opts: StartOpts) => Promise<string>
  cancel: () => Promise<void>
  reset: () => void
}

const TERMINAL_BATCH: BatchStatus[] = ['completed', 'failed', 'cancelled']

/**
 * 把 TranslateJobFrame[] 转换为按 taskId 聚合的 ImageBatchItem[]
 * - 同一 taskId 的多个 frame 按发生顺序收敛到最新 status
 * - 100% (image-done) > 50% (ocr-done) > failed > pending
 */
function aggregateItems(frames: import('../types').TranslateJobFrame[], seedTaskIds: string[]): ImageBatchItem[] {
  const map = new Map<string, ImageBatchItem>()
  // 先用 seed taskIds 初始化 pending
  for (const t of seedTaskIds) {
    map.set(t, { taskId: t, status: 'pending', percent: 0 })
  }
  for (const f of frames) {
    const taskId = (f.payload?.taskId as string) || ''
    if (!taskId) continue
    const cur = map.get(taskId) || { taskId, status: 'pending' as const, percent: 0 }
    if (f.kind === 'ocr-done') {
      cur.status = 'ocr-done'
      cur.percent = 50
    } else if (f.kind === 'image-done' || f.kind === 'page-done') {
      cur.status = 'image-done'
      cur.percent = 100
    } else if (f.kind === 'failed') {
      cur.status = 'failed'
    }
    map.set(taskId, cur)
  }
  return Array.from(map.values())
}

export function useImageBatch(): Result {
  const [jobId, setJobId] = useState<string | null>(null)
  const [status, setStatus] = useState<BatchStatus>('idle')
  const [seedTaskIds, setSeedTaskIds] = useState<string[]>([])

  const job = useTranslateJob(jobId, { pollMs: 600 })

  // 派生 items
  const items = useMemo<ImageBatchItem[]>(
    () => aggregateItems(job.frames, seedTaskIds),
    [job.frames, seedTaskIds]
  )

  // 同步 job.status → batch status（终态立即同步）
  useEffect(() => {
    if (job.status === 'finished') setStatus('completed')
    else if (job.status === 'failed') setStatus('failed')
    else if (job.status === 'cancelled') setStatus('cancelled')
  }, [job.status])

  const start = useCallback(async (opts: StartOpts): Promise<string> => {
    setStatus('started')
    setSeedTaskIds(opts.taskIds)
    const r = await fetch('/api/translate/image/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        taskIds: opts.taskIds,
        sourceLang: opts.sourceLang,
        targetLang: opts.targetLang,
        glossaryId: opts.glossaryId,
        tmId: opts.tmId,
      }),
    })
    if (!r.ok) {
      const txt = await r.text().catch(() => '')
      setStatus('failed')
      throw new Error(`batch ${r.status} ${txt}`.trim())
    }
    const data = await r.json()
    const newJobId = data.jobId as string
    setJobId(newJobId)
    // status 保持 'started'，由 useTranslateJob 第一次 fetch 后会推进到 'running'
    return newJobId
  }, [])

  const cancel = useCallback(async (): Promise<void> => {
    await job.cancel()
    setStatus('cancelled')
  }, [job])

  const reset = useCallback(() => {
    setJobId(null)
    setStatus('idle')
    setSeedTaskIds([])
  }, [])

  return { jobId, status, items, start, cancel, reset }
}

// 内部用：避免在 export 上出现未用变量
void TERMINAL_BATCH
