// 模型：claude-sonnet-4-6
// StageIndicator — 4 阶段步骤指示器
// Phase A.1: Translation UX Overhaul Agent 1
//
// 横向 chip 链：pick → translating → review → export
// - 当前 stage: var(--color-translate-stage-active) (= --blue-7)
// - 已完成 stage: var(--color-translate-stage-done) (= --green-5)
// - 未到达 stage: var(--color-translate-stage-pending) (= --slate-3)
// - chip 之间 Material-style connector
// - 尊重 <html data-motion="off"> 守卫（即使加了 transition）
// - data-testid: oa-stage-{key} / oa-stage-connector-{idx}
// - 日志: [translate-ui ISO] stage={key} on click

import { KeyboardEvent as ReactKeyboardEvent, useMemo } from 'react'

export type TranslateStageKey = 'pick' | 'translating' | 'review' | 'export'

export interface StageIndicatorLabels {
  pick: string
  translating: string
  review: string
  export: string
}

export interface StageIndicatorProps {
  current: TranslateStageKey
  /** 自定义 stage 顺序与标签；缺省为 4 阶段标准流程 */
  labels?: Partial<StageIndicatorLabels>
  /** 点击或键盘激活 stage 时触发 */
  onChange?: (stage: TranslateStageKey) => void
  /** 自定义 stage 顺序（高级用例，缺省使用 DEFAULT_STAGES） */
  stages?: readonly TranslateStageKey[]
  /** 自定义 className（容器） */
  className?: string
  /** 国际化：aria-label 翻译提示 */
  ariaLabel?: string
}

export const DEFAULT_STAGES: readonly TranslateStageKey[] = [
  'pick',
  'translating',
  'review',
  'export',
] as const

export const DEFAULT_LABELS: StageIndicatorLabels = {
  pick: '选文件',
  translating: '翻译中',
  review: '校对',
  export: '导出',
}

function isMotionOff(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.getAttribute('data-motion') === 'off'
}

export function StageIndicator({
  current,
  labels,
  onChange,
  stages = DEFAULT_STAGES,
  className,
  ariaLabel = '翻译流程步骤',
}: StageIndicatorProps) {
  // 守卫：reduced motion — 只读取 data-motion，不调用 usePrefersReducedMotion
  // （避免 hook 副作用覆盖测试中显式设置的 data-motion 属性）
  const motionOff = isMotionOff()

  const currentIndex = stages.indexOf(current)

  const mergedLabels: StageIndicatorLabels = useMemo(
    () => ({ ...DEFAULT_LABELS, ...(labels ?? {}) }),
    [labels]
  )

  const handleSelect = (key: TranslateStageKey) => {
    if (key === current) return
    const ts = new Date().toISOString()
    // eslint-disable-next-line no-console
    console.info(`[translate-ui ${ts}] stage=${key}`)
    onChange?.(key)
  }

  const handleKeyDown = (
    e: ReactKeyboardEvent<HTMLButtonElement>,
    key: TranslateStageKey
  ) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleSelect(key)
    }
  }

  return (
    <nav
      className={`oa-stage-indicator ${className ?? ''}`}
      role="navigation"
      aria-label={ariaLabel}
      data-testid="oa-stage-indicator"
      data-motion-off={motionOff ? 'true' : 'false'}
    >
      <ol className="oa-stage-list" data-testid="oa-stage-list">
        {stages.map((key, idx) => {
          const isActive = key === current
          const isDone = idx < currentIndex
          // 严格按 current 计算；idx === currentIndex 是 active，其余是 done 或 pending
          const status: 'active' | 'done' | 'pending' = isActive
            ? 'active'
            : isDone
              ? 'done'
              : 'pending'

          const statusClass = `is-${status}`

          return (
            <li
              key={key}
              className={`oa-stage-item oa-stage-item-${key}`}
              data-testid={`oa-stage-item-${key}`}
              data-status={status}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-current={isActive ? 'step' : undefined}
                className={`oa-stage-chip ${statusClass}`}
                data-testid={`oa-stage-${key}`}
                data-stage-key={key}
                data-status={status}
                onClick={() => handleSelect(key)}
                onKeyDown={(e) => handleKeyDown(e, key)}
                tabIndex={isActive ? 0 : -1}
              >
                <span
                  className="oa-stage-chip-dot"
                  data-testid={`oa-stage-dot-${key}`}
                  aria-hidden="true"
                />
                <span className="oa-stage-chip-label">{mergedLabels[key]}</span>
              </button>
              {idx < stages.length - 1 && (
                <span
                  className={`oa-stage-connector ${
                    idx < currentIndex ? 'is-done' : 'is-pending'
                  }`}
                  data-testid={`oa-stage-connector-${idx}`}
                  data-connector-index={idx}
                  aria-hidden="true"
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}