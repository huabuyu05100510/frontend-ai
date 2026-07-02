// ImageTranslateMode — 图片翻译 thin shell
// 模型：claude-sonnet-4-6
//
// Phase C closed-loop wrapper（参考 DocTranslateMode shell pattern）：
// - URL state (?stage=&task=) 驱动 4 阶段状态机
// - 编排逻辑迁入 <ImageTranslateStagePanel>（含 OCR / 校对 / 导出）
// - <Toast /> 在此边界挂载一次；所有子组件 push 的通知均可见
// - 浏览器前进/后退 + 可分享链接（?stage=review&task=t_xxx）
//
// 内部细节：旧版 (451 行) 的 ImageDualView / DictionaryCard / ImageBatchQueue /
// OCR + 翻译逻辑全部由 ImageTranslateStagePanel 复用，本组件不再包含业务代码。

import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Toast } from '../components/Toast'
import { useToastStore } from '../hooks/useToast'
import { ImageTranslateStagePanel } from './ImageTranslateStagePanel'
import type { TranslateStage } from '../hooks/useTranslateStage'
import type { Task } from '../types'

interface Props {
  tasks: Task[]
}

function coerceStage(raw: string | null): TranslateStage {
  if (raw === 'pick' || raw === 'translating' || raw === 'review' || raw === 'export') {
    return raw
  }
  return 'pick'
}

/**
 * 图片翻译 shell — URL state + Toast 挂载 + ImageTranslateStagePanel
 *
 * 用法：由 TranslationPage 在 mode=image 时挂载
 *   <ImageTranslateMode tasks={tasks} />
 */
export function ImageTranslateMode({ tasks: _tasks }: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawStage = searchParams.get('stage')
  const initialTaskId = searchParams.get('task') || undefined
  const stage: TranslateStage = coerceStage(rawStage)

  const onStageChange = useCallback(
    (s: TranslateStage) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('stage', s)
          // 若没有 task 但存在 initialTaskId，则保留以便后续阶段（如 review/export）能用到
          if (!next.get('task') && initialTaskId) next.set('task', initialTaskId)
          return next
        },
        { replace: false },
      )
    },
    [setSearchParams, initialTaskId],
  )

  const queue = useToastStore((s) => s.queue)
  const dismissToast = useToastStore((s) => s.dismiss)

  return (
    <>
      <Toast queue={queue} onDismiss={dismissToast} />
      <ImageTranslateStagePanel
        stage={stage}
        onStageChange={onStageChange}
        initialTaskId={initialTaskId}
      />
    </>
  )
}

// 兼容：旧版以 default 导出方式引用本组件的代码可继续工作（rare）。
export default ImageTranslateMode