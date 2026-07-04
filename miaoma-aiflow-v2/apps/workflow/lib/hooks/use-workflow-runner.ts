/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */
'use client'

import { useCallback, useRef, useState } from 'react'

import { useWorkflowStream } from '@/lib/a2ui/use-workflow-stream'
import type { TestRunState } from '@/lib/types/test-run'
import { createInitialTestRunState } from '@/lib/types/test-run'

interface FlowNode {
    id: string
    type: string
    position: { x: number; y: number }
    data?: {
        label?: string
        config?: Record<string, unknown>
    }
}

interface FlowEdge {
    id: string
    source: string
    sourceHandle?: string
    target: string
}

interface UseWorkflowRunnerOptions {
    appId: string
    nodes: FlowNode[]
    edges: FlowEdge[]
}

interface UseWorkflowRunnerReturn {
    state: TestRunState
    execute: (inputs: Record<string, unknown>) => Promise<void>
    reset: () => void
    isRunning: boolean
    abort: () => void
    /**
     * SDK 加成：暴露原始 parts 与 streamState 给 smith 可视化组件订阅。
     * 旧消费者可忽略。
     */
    parts: ReturnType<typeof useWorkflowStream>['parts']
    streamState: ReturnType<typeof useWorkflowStream>['streamState']
}

/**
 * useWorkflowRunner —— back-compat shim，内部委托给 useWorkflowStream（SDK 内核）。
 *
 * 改造前：手写 SSE buffer.split + 命令式 switch mutate + abort 静默丢数据
 * 改造后：miaomaSseProvider 把 SSE 转 StreamPart，useA2UIStream 走纯 reducer
 *
 * 外部 API 完全保留（state/execute/reset/isRunning/abort），新增 parts/streamState
 * 供 smith 可视化（双 tab：Protocol 调试器 + Timeline 时间轴）消费。
 */
export function useWorkflowRunner({
    appId,
    nodes,
    edges,
}: UseWorkflowRunnerOptions): UseWorkflowRunnerReturn {
    const stream = useWorkflowStream({ appId, nodes, edges })
    const [softState, setSoftState] = useState<TestRunState>(createInitialTestRunState())

    // execute 时把 SDK projected state 同步到 softState，让 startTime/endTime 在 UI 上有值
    const startTimeRef = useRef<Date | null>(null)

    const execute = useCallback(
        async (inputs: Record<string, unknown>) => {
            startTimeRef.current = new Date()
            setSoftState({
                ...createInitialTestRunState(),
                status: 'running',
                startTime: startTimeRef.current,
                inputs,
                nodeTraces: new Map(),
            })
            await stream.execute(inputs)
        },
        [stream],
    )

    const reset = useCallback(() => {
        startTimeRef.current = null
        setSoftState(createInitialTestRunState())
        stream.reset()
    }, [stream])

    // 合并：projected state 提供节点 traces/executionId，softState 提供 startTime
    const merged: TestRunState = useMemo_merge(stream.state, softState)

    return {
        state: merged,
        execute,
        reset,
        isRunning: stream.isRunning,
        abort: stream.abort,
        parts: stream.parts,
        streamState: stream.streamState,
    }
}

function useMemo_merge(streamState: TestRunState, softState: TestRunState): TestRunState {
    // streamState 包含 nodeTraces / executionId / result（SDK 投影）
    // softState 包含 startTime（execute 时刻立即写入，SDK 流没出来之前 UI 不至于空）
    return {
        ...streamState,
        startTime: softState.startTime ?? streamState.startTime,
        inputs: softState.inputs ?? streamState.inputs,
    }
}
