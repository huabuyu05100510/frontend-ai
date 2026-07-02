// 模型：claude-sonnet-4-6
// useTranslateStage — 翻译页 4 阶段状态机 hook
//
// 4 阶段: pick → translating → review → export
// URL search params 双向同步（浏览器前进/后退 + 可分享链接）
// 不依赖 store.ts，保持纯净；store 由 DocTranslateStagePanel 等容器组件订阅。
//
// 返回:
//   stage / setStage / goNext / goBack / reset
//   canGoNext / canGoBack / isFirst / isLast
//   stageLabel (中文) / stageIndex (0..3)

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

export type TranslateStage = 'pick' | 'translating' | 'review' | 'export'

export const STAGE_ORDER: TranslateStage[] = ['pick', 'translating', 'review', 'export']

const STAGE_LABELS: Record<TranslateStage, string> = {
  pick: '选择文件',
  translating: '翻译中',
  review: '校对',
  export: '导出',
}

/** 验证字符串是否为合法 stage；否则回退 'pick' */
function coerceStage(value: string | null | undefined): TranslateStage {
  if (value === 'pick' || value === 'translating' || value === 'review' || value === 'export') {
    return value
  }
  return 'pick'
}

export interface UseTranslateStageOptions {
  /** URL search param key（默认 'stage'） */
  paramKey?: string
  /** 若提供，同步 task id 到 URL `?task=…` 旁边 */
  taskIdParamKey?: string
}

export interface UseTranslateStageResult {
  stage: TranslateStage
  setStage: (s: TranslateStage) => void
  goNext: () => void
  goBack: () => void
  reset: () => void
  canGoNext: boolean
  canGoBack: boolean
  isFirst: boolean
  isLast: boolean
  stageLabel: string
  stageIndex: number
}

/**
 * 4 阶段状态机 hook
 *
 * 实现:
 * 1. 从 URL searchParams 读取 stage（paramKey 可自定义）
 * 2. setStage / goNext / goBack / reset 通过 setSearchParams 写回 URL（保留其他 param）
 * 3. reset() 显式清除 task param（保留 mode 等无关参数）
 * 4. 阶段变化时打印 `[translate-ui ISO] stage=…` 日志
 */
export function useTranslateStage(opts?: UseTranslateStageOptions): UseTranslateStageResult {
  const paramKey = opts?.paramKey ?? 'stage'
  const taskIdParamKey = opts?.taskIdParamKey ?? 'task'

  const [searchParams, setSearchParams] = useSearchParams()

  const stage = coerceStage(searchParams.get(paramKey))
  const stageIndex = STAGE_ORDER.indexOf(stage)
  const isFirst = stageIndex === 0
  const isLast = stageIndex === STAGE_ORDER.length - 1
  const canGoNext = !isLast
  const canGoBack = !isFirst
  const stageLabel = STAGE_LABELS[stage]

  const logStage = useCallback((next: TranslateStage) => {
    const task = searchParams.get(taskIdParamKey) ?? '-'
    // annotations placeholder — useStore annotation count 由容器组件在 setStage 时附加
    console.info(`[translate-ui ${new Date().toISOString()}] stage=${next} task=${task} annotations=0`)
  }, [searchParams, taskIdParamKey])

  const setStage = useCallback((next: TranslateStage) => {
    setSearchParams(
      (prev) => {
        const out = new URLSearchParams(prev)
        out.set(paramKey, next)
        return out
      },
      { replace: false },
    )
    logStage(next)
  }, [setSearchParams, paramKey, logStage])

  const goNext = useCallback(() => {
    if (isLast) return
    const next = STAGE_ORDER[stageIndex + 1]
    setStage(next)
  }, [isLast, stageIndex, setStage])

  const goBack = useCallback(() => {
    if (isFirst) return
    const next = STAGE_ORDER[stageIndex - 1]
    setStage(next)
  }, [isFirst, stageIndex, setStage])

  const reset = useCallback(() => {
    setSearchParams(
      (prev) => {
        const out = new URLSearchParams(prev)
        out.set(paramKey, 'pick')
        out.delete(taskIdParamKey)
        return out
      },
      { replace: false },
    )
    logStage('pick')
  }, [setSearchParams, paramKey, taskIdParamKey, logStage])

  return useMemo<UseTranslateStageResult>(() => ({
    stage,
    setStage,
    goNext,
    goBack,
    reset,
    canGoNext,
    canGoBack,
    isFirst,
    isLast,
    stageLabel,
    stageIndex,
  }), [stage, setStage, goNext, goBack, reset, canGoNext, canGoBack, isFirst, isLast, stageLabel, stageIndex])
}