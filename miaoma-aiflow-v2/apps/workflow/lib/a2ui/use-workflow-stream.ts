/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

/**
 * useWorkflowStream —— useWorkflowRunner 的 SDK 内核版。
 *
 * 改造点：
 *   1. SSE 解析交给 @a2ui-stream/core 的 miaomaSseProvider（不再手写 buffer.split）
 *   2. state 累积靠纯 reducer（不再命令式 switch mutate）
 *   3. abort 不再静默丢数据（SDK 的 abort-no-loss 不变量守护）
 *   4. 暴露 parts/rawState 给 smith 可视化双 tab 消费
 *
 * 外层 API 与原 useWorkflowRunner 完全兼容（state/execute/reset/abort/isRunning），
 * 新增 parts/streamState 供可视化组件订阅。
 */

'use client'

import type { StreamPart } from '@a2ui-stream/core/protocol'
import { useA2UIStream } from '@a2ui-stream/core/react'
import type { CardView, StreamState } from '@a2ui-stream/core'
import { useCallback, useMemo, useRef, useState } from 'react'

import { createMiaomaSseProvider } from './miaoma-sse-provider'
import type {
    NodeTraceInfo,
    NodeTraceStatus,
    TestRunState,
} from '@/lib/types/test-run'
import type { NodeKind } from '@miaoma-aiflow/ai-engine'

interface FlowNode {
    id: string
    type: string
    position: { x: number; y: number }
    data?: { label?: string; config?: Record<string, unknown> }
}
interface FlowEdge {
    id: string
    source: string
    sourceHandle?: string
    target: string
}

interface UseWorkflowStreamOptions {
    appId: string
    nodes: FlowNode[]
    edges: FlowEdge[]
}

interface MiaomaNodeCardBody {
    nodeName?: string
    nodeType?: string
    status?: NodeTraceStatus
    startedAt?: string
    endedAt?: string
    duration?: number
    inputs?: Record<string, unknown>
    outputs?: Record<string, unknown>
    error?: string
    matchedBranch?: string
}

interface MiaomaWorkflowCardBody {
    executionId?: string
    status?: NodeTraceStatus
    outputs?: Record<string, unknown>
    duration?: number
    totalTokens?: number
    error?: string
}

/** 把 SDK 的 StreamState 投影回 miaoma 的 TestRunState（纯函数） */
function project(streamState: StreamState, initialNodes: FlowNode[]): TestRunState {
    const wfCard = streamState.cards['workflow']
    const wfBody: MiaomaWorkflowCardBody = safeParse(wfCard?.body) ?? {}

    const status: TestRunState['status'] =
        streamState.status === 'streaming'
            ? 'running'
            : streamState.status === 'done'
                ? 'success'
                : 'error'

    // 节点 traces：用初始 nodes 兜底 pending，再覆盖 SDK card 数据
    const traces = new Map<string, NodeTraceInfo>()
    for (const n of initialNodes) {
        traces.set(n.id, {
            nodeId: n.id,
            nodeName: (n.data?.label as string) || n.id,
            nodeType: n.type as NodeKind,
            status: 'pending',
            logs: [],
        })
    }
    for (const [nodeId, card] of Object.entries(streamState.cards)) {
        if (nodeId === 'workflow') continue
        const body: MiaomaNodeCardBody = safeParse(card.body) ?? {}
        const initial = traces.get(nodeId)
        const nodeName = body.nodeName ?? initial?.nodeName ?? nodeId
        const nodeType = (body.nodeType ?? initial?.nodeType ?? 'unknown') as NodeKind
        traces.set(nodeId, {
            nodeId,
            nodeName,
            nodeType,
            status: body.status ?? (card.done ? 'success' : 'running'),
            startTime: body.startedAt ? new Date(body.startedAt) : undefined,
            endTime: body.endedAt ? new Date(body.endedAt) : undefined,
            duration: body.duration,
            inputs: body.inputs,
            outputs: body.outputs,
            error: body.error,
            logs: [],
        })
    }

    return {
        status,
        inputs: {},
        result:
            status === 'success' || status === 'error'
                ? {
                    success: status === 'success',
                    outputs: wfBody.outputs ?? {},
                    error: wfBody.error ? new Error(wfBody.error) : undefined,
                    executionId: wfBody.executionId ?? '',
                    duration: wfBody.duration ?? 0,
                    logs: [],
                }
                : null,
        startTime: null,
        endTime: null,
        duration: wfBody.duration ?? 0,
        executionId: wfBody.executionId ?? null,
        nodeTraces: traces,
        totalTokens: wfBody.totalTokens ?? 0,
    }
}

function safeParse<T = unknown>(s?: string): T | undefined {
    if (!s) return undefined
    try {
        return JSON.parse(s) as T
    } catch {
        return undefined
    }
}

export function useWorkflowStream({ appId, nodes, edges }: UseWorkflowStreamOptions) {
    const [parts, setParts] = useState<StreamPart[]>([])
    const [runToken, setRunToken] = useState(0) // 每次 execute 自增触发 provider 重建
    const inputsRef = useRef<Record<string, unknown>>({})
    const partsRef = useRef<StreamPart[]>([])
    partsRef.current = parts

    // 每次 runToken 变化，重建 provider（用最新 inputs/body）
    const provider = useMemo(
        () =>
            createMiaomaSseProvider({
                url: `/api/apps/${appId}/workflow/run`,
                body: { nodes, edges, inputs: inputsRef.current },
            }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [appId, runToken],
    )

    const { state: streamState, send, cancel, isStreaming } = useA2UIStream({
        provider,
        messages: [],
        auto: false,
        onPart: (p) => setParts((prev) => [...prev, p]),
    })

    const projected = useMemo(
        () => project(streamState as StreamState, nodes),
        [streamState, nodes],
    )

    const execute = useCallback(
        async (inputs: Record<string, unknown>) => {
            inputsRef.current = inputs
            setParts([])
            setRunToken((t) => t + 1)
            // 等 provider useMemo 重建后再 send —— 用 microtask 让一次
            await Promise.resolve()
            send()
        },
        [send],
    )

    const reset = useCallback(() => {
        cancel()
        setParts([])
    }, [cancel])

    const abort = useCallback(() => {
        // SDK 的 abort-no-loss：cancel 后 streamState 保留，parts 也保留
        cancel()
    }, [cancel])

    return {
        state: projected,
        streamState: streamState as StreamState,
        parts,
        execute,
        reset,
        abort,
        isRunning: isStreaming,
    }
}
