/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

/**
 * 把 miaoma 工作流 SSE 流适配为 @a2ui-stream/core 的 StreamPart 协议。
 *
 * 映射：
 *   workflow:start → card-start(workflow) + card-delta(executionId) + text-delta
 *   node:start    → card-start(nodeId)   + card-delta(nodeType/name/status) + text-delta
 *   log           → text-delta (附在当前节点上下文)
 *   node:end      → card-delta(outputs/error/duration) + card-end(nodeId) + text-delta
 *   workflow:end  → card-delta(final) + card-end(workflow) + done(usage=totalTokens)
 *   error         → error part（终态）
 *
 * 这样 useA2UIStream 的 StreamState.cards 自然形成 workflow → 各节点的 trace tree，
 * text 字段是用户可读的实时日志流，abort 时所有内容天然保留（abort-no-loss 不变量）。
 */

import { createProvider } from '@a2ui-stream/core/provider'
import { Part, type StreamPart } from '@a2ui-stream/core/protocol'
import type { ProviderAdapter, StreamRequest } from '@a2ui-stream/core/provider'

import type {
    ErrorEventData,
    NodeEndEventData,
    NodeStartEventData,
    SSEEvent,
    WorkflowEndEventData,
    WorkflowStartEventData,
} from '@/lib/types/test-run'

export interface MiaomaSseOptions {
    /** 完整 endpoint URL，默认 `/api/apps/:appId/workflow/run` */
    url: string
    /** POST body */
    body: unknown
    /** 请求超时 ms，默认 10 分钟 */
    timeoutMs?: number
}

export function createMiaomaSseProvider(opts: MiaomaSseOptions): ProviderAdapter {
    const timeoutMs = opts.timeoutMs ?? 600_000
    return createProvider('miaoma-workflow', async function* ({
        signal,
    }: StreamRequest): AsyncGenerator<StreamPart> {
        const timeoutCtrl = new AbortController()
        const timeoutId = setTimeout(() => timeoutCtrl.abort(), timeoutMs)
        const combinedSignal = signal
            ? AbortSignal.any([signal, timeoutCtrl.signal])
            : timeoutCtrl.signal

        let resp: Response
        try {
            resp = await fetch(opts.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(opts.body),
                signal: combinedSignal,
            })
        } catch (e) {
            clearTimeout(timeoutId)
            if (isAbort(e)) return
            yield Part.error('E_NETWORK', errMsg(e), true)
            return
        }

        if (!resp.ok) {
            clearTimeout(timeoutId)
            const text = await resp.text().catch(() => '')
            yield Part.error(`E_HTTP_${resp.status}`, `${resp.status}: ${text.slice(0, 200)}`, false)
            return
        }
        if (!resp.body) {
            clearTimeout(timeoutId)
            yield Part.error('E_NO_BODY', 'response has no body', false)
            return
        }

        // 内联 SSE 切块（与 OpenAI-compatible adapter 同款）
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let lineBuf = ''
        // node:start 时记录 nodeName/nodeType，便于 node:end 时复用
        const nodeMeta = new Map<string, { name: string; type: string }>()

        try {
            while (true) {
                let chunk: ReadableStreamReadResult<Uint8Array>
                try {
                    chunk = await reader.read()
                } catch (e) {
                    if (isAbort(e)) return
                    yield Part.error('E_READ', errMsg(e), true)
                    return
                }
                if (chunk.done) break
                lineBuf += decoder.decode(chunk.value, { stream: true })

                let nl: number
                while ((nl = lineBuf.indexOf('\n')) >= 0) {
                    const rawLine = lineBuf.slice(0, nl)
                    lineBuf = lineBuf.slice(nl + 1)
                    const line = rawLine.replace(/\r$/, '').trim()
                    if (!line || line.startsWith(':') || !line.startsWith('data:')) continue
                    const data = line.slice(5).trim()
                    if (!data) continue

                    let evt: SSEEvent
                    try {
                        evt = JSON.parse(data) as SSEEvent
                    } catch {
                        continue // 单事件解析失败跳过
                    }
                    yield* emitParts(evt, nodeMeta)
                }
            }
        } finally {
            clearTimeout(timeoutId)
            try {
                reader.releaseLock()
            } catch {
                // ignore
            }
        }

        // 流自然结束（服务端未发 workflow:end 即 close）——补一个 done 保终态
        yield Part.done()
    })
}

async function* emitParts(
    evt: SSEEvent,
    nodeMeta: Map<string, { name: string; type: string }>,
): AsyncGenerator<StreamPart> {
    switch (evt.type) {
        case 'workflow:start': {
            const d = evt.data as WorkflowStartEventData
            yield Part.cardStart('workflow', 'miaoma-workflow')
            yield Part.cardDelta('workflow', JSON.stringify({ executionId: d.executionId, status: 'running' }))
            yield Part.textDelta('t_wf_start', `🚀 workflow 启动 (exec=${d.executionId})\n`)
            return
        }
        case 'node:start': {
            const d = evt.data as NodeStartEventData
            nodeMeta.set(d.nodeId, { name: d.nodeName, type: d.nodeType })
            yield Part.cardStart(d.nodeId, `miaoma-node-${d.nodeType}`)
            yield Part.cardDelta(
                d.nodeId,
                JSON.stringify({
                    nodeName: d.nodeName,
                    nodeType: d.nodeType,
                    status: 'running',
                    startedAt: evt.timestamp,
                }),
            )
            yield Part.textDelta(`t_ns_${d.nodeId}`, `▶ ${d.nodeName} (${d.nodeType})\n`)
            return
        }
        case 'log': {
            const d = evt.data as { nodeId?: string; level?: string; message?: string }
            const level = d.level ?? 'info'
            const msg = d.message ?? ''
            yield Part.textDelta(
                `t_log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                `  [${level}] ${msg}\n`,
            )
            return
        }
        case 'node:end': {
            const d = evt.data as NodeEndEventData
            const meta = nodeMeta.get(d.nodeId)
            yield Part.cardDelta(
                d.nodeId,
                JSON.stringify({
                    nodeName: meta?.name ?? d.nodeId,
                    nodeType: meta?.type,
                    status: d.success ? 'success' : 'error',
                    inputs: d.inputs,
                    outputs: d.outputs,
                    error: d.error?.message,
                    duration: d.duration,
                    matchedBranch: d.matchedBranch,
                    endedAt: evt.timestamp,
                }),
            )
            yield Part.cardEnd(d.nodeId)
            const flag = d.success ? '✓' : '✗'
            yield Part.textDelta(
                `t_ne_${d.nodeId}`,
                `${flag} ${meta?.name ?? d.nodeId} 完成 (${d.duration}ms)\n`,
            )
            return
        }
        case 'workflow:end': {
            const d = evt.data as WorkflowEndEventData
            yield Part.cardDelta(
                'workflow',
                JSON.stringify({
                    status: d.success ? 'success' : 'error',
                    outputs: d.outputs,
                    duration: d.duration,
                    totalTokens: d.totalTokens,
                    error: d.error,
                }),
            )
            yield Part.cardEnd('workflow')
            yield Part.done(d.totalTokens ? { outputTokens: d.totalTokens } : undefined)
            return
        }
        case 'error': {
            const d = evt.data as ErrorEventData
            yield Part.error('E_WORKFLOW', d.message, false)
            return
        }
    }
}

function isAbort(e: unknown): boolean {
    return e instanceof DOMException
        ? e.name === 'AbortError'
        : e instanceof Error && e.name === 'AbortError'
}

function errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
}
