// 模型：claude-sonnet-4-6
// useTranslateStage hook tests — 4 阶段状态机 + URL search params 双向同步
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React, { useState as reactUseState } from 'react'

// Mock react-router-dom useSearchParams — 我们直接控制 mock 引用
// 用 internal React state + bump version 让组件在 setSearchParams 后重渲染
type SearchParamsInit = Record<string, string | undefined>
const mockSetSearchParams = vi.fn()
let currentParams: URLSearchParams = new URLSearchParams()
let mockRef: { bump: () => void } = { bump: () => {} }

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useSearchParams: () => {
      // useState forces re-render whenever version changes
      const [, setVersion] = reactUseState(0)
      mockRef.bump = () => setVersion((v) => v + 1)
      return [
        currentParams,
        (next: SearchParamsInit | ((prev: URLSearchParams) => URLSearchParams)) => {
          if (typeof next === 'function') {
            const nextParams = (next as (p: URLSearchParams) => URLSearchParams)(currentParams)
            currentParams = nextParams
          } else {
            const nextParams = new URLSearchParams(currentParams)
            for (const [k, v] of Object.entries(next)) {
              if (v === undefined) {
                nextParams.delete(k)
              } else {
                nextParams.set(k, v)
              }
            }
            currentParams = nextParams
          }
          mockSetSearchParams(next)
          // schedule a re-render in the next tick
          Promise.resolve().then(() => mockRef.bump())
        },
      ] as const
    },
  }
})

import { useTranslateStage } from '../../src/hooks/useTranslateStage'

describe('useTranslateStage', () => {
  beforeEach(() => {
    currentParams = new URLSearchParams()
    mockSetSearchParams.mockClear()
  })

  it('initial stage defaults to "pick" when URL has no stage param', () => {
    const { result } = renderHook(() => useTranslateStage())
    expect(result.current.stage).toBe('pick')
    expect(result.current.stageIndex).toBe(0)
    expect(result.current.stageLabel).toBe('选择文件')
    expect(result.current.isFirst).toBe(true)
    expect(result.current.isLast).toBe(false)
    expect(result.current.canGoNext).toBe(true)
    expect(result.current.canGoBack).toBe(false)
  })

  it('reads initial stage from URL search params (?stage=review)', () => {
    currentParams = new URLSearchParams('stage=review')
    const { result } = renderHook(() => useTranslateStage())
    expect(result.current.stage).toBe('review')
    expect(result.current.stageIndex).toBe(2)
    expect(result.current.stageLabel).toBe('校对')
    expect(result.current.isFirst).toBe(false)
    expect(result.current.isLast).toBe(false)
  })

  it('setStage() updates URL via setSearchParams', async () => {
    const { result } = renderHook(() => useTranslateStage())
    await act(async () => {
      result.current.setStage('translating')
    })
    expect(mockSetSearchParams).toHaveBeenCalledTimes(1)
    // URL should now have stage=translating
    expect(currentParams.get('stage')).toBe('translating')
    expect(result.current.stage).toBe('translating')
  })

  it('goNext() advances stage; no-op at "export"', async () => {
    currentParams = new URLSearchParams('stage=review')
    const { result } = renderHook(() => useTranslateStage())
    await act(async () => {
      result.current.goNext()
    })
    expect(result.current.stage).toBe('export')
    expect(currentParams.get('stage')).toBe('export')

    // at last stage; goNext is no-op
    await act(async () => {
      result.current.goNext()
    })
    expect(result.current.stage).toBe('export')
    expect(currentParams.get('stage')).toBe('export')
  })

  it('goBack() regresses stage; no-op at "pick"', async () => {
    currentParams = new URLSearchParams('stage=translating')
    const { result } = renderHook(() => useTranslateStage())
    await act(async () => {
      result.current.goBack()
    })
    expect(result.current.stage).toBe('pick')

    // at first stage; goBack is no-op
    await act(async () => {
      result.current.goBack()
    })
    expect(result.current.stage).toBe('pick')
  })

  it('reset() returns to "pick" and clears task param', async () => {
    currentParams = new URLSearchParams('stage=export&task=t_42&mode=doc')
    const { result } = renderHook(() => useTranslateStage())
    await act(async () => {
      result.current.reset()
    })
    expect(result.current.stage).toBe('pick')
    // task param should be removed (other params like mode may remain)
    expect(currentParams.get('task')).toBeNull()
    expect(currentParams.get('stage')).toBe('pick')
  })

  it('isFirst/isLast correctly reflect position in STAGE_ORDER', () => {
    currentParams = new URLSearchParams('stage=pick')
    const { result: r1 } = renderHook(() => useTranslateStage())
    expect(r1.current.isFirst).toBe(true)
    expect(r1.current.isLast).toBe(false)

    currentParams = new URLSearchParams('stage=export')
    const { result: r2 } = renderHook(() => useTranslateStage())
    expect(r2.current.isFirst).toBe(false)
    expect(r2.current.isLast).toBe(true)
  })

  it('stageLabel Chinese labels for each stage', () => {
    const labels: Array<[string, string]> = [
      ['pick', '选择文件'],
      ['translating', '翻译中'],
      ['review', '校对'],
      ['export', '导出'],
    ]
    for (const [stage, label] of labels) {
      currentParams = new URLSearchParams(`stage=${stage}`)
      const { result } = renderHook(() => useTranslateStage())
      expect(result.current.stageLabel).toBe(label)
    }
  })

  it('honors custom paramKey (e.g., ?translateStage=review)', async () => {
    currentParams = new URLSearchParams('translateStage=review')
    const { result } = renderHook(() => useTranslateStage({ paramKey: 'translateStage' }))
    expect(result.current.stage).toBe('review')

    await act(async () => {
      result.current.setStage('export')
    })
    expect(currentParams.get('translateStage')).toBe('export')
    // standard 'stage' key should NOT be set
    expect(currentParams.get('stage')).toBeNull()
  })

  it('invalid stage values fall back to "pick"', () => {
    currentParams = new URLSearchParams('stage=bogus')
    const { result } = renderHook(() => useTranslateStage())
    expect(result.current.stage).toBe('pick')
  })
})