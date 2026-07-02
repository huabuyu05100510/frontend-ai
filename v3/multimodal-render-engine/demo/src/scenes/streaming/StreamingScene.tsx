/**
 * StreamingScene — AI 流式渲染三子场景
 *
 * 1. Streaming Markdown  — 增量 Markdown 渲染（StreamingParser + rAF 节流）
 * 2. Generative UI       — Function Calling → 动态组件（BracketDepthTracker）
 * 3. Race Condition      — 竞态防护演示（useAbortableStream + 版本号）
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { StreamingParser, MarkdownToken } from './StreamingParser'
import { createTrackerState, trackBracketDepth } from './BracketDepthTracker'
import { useAbortableStream } from './useAbortableStream'
import { POICard } from './components/POICard'
import { RouteMap } from './components/RouteMap'
import { TipBlock } from './components/TipBlock'

// ─── 类型 ────────────────────────────────────────────────────────────────────

type SubScene = 'markdown' | 'genui' | 'race'

interface TokenChunk {
  text: string
  isCurrent: boolean
}

// ─── 模拟 SSE 数据 ─────────────────────────────────────────────────────────

const MOCK_MARKDOWN = `# 多模态 AI 渲染引擎

## 核心挑战

随着大语言模型的快速普及，前端工程师面临的核心挑战已不再是"如何展示数据"，而是"如何让 AI 推理结果与原始内容精准对齐"。

## 技术方案

> 采用服务端格式统一转换策略，前端仅接收 PageData 结构

\`\`\`typescript
interface PageData {
  pageNum: number
  imageUrl: string
  naturalWidth: number
  naturalHeight: number
  blocks: TextBlock[]
}
\`\`\`

## 性能指标

- 首屏渲染 < 100ms（TTI）
- 增量 patch 而非全量重绘
- rAF 节流：每帧最多 commit 一次
- VirtualPagePool：仅保留视口 ±2 页

---

以上即为多模态渲染引擎的核心设计思路。`

// 将文本切成 10-20 字符的随机 chunk
function* makeChunks(text: string, chunkSize = 12): Generator<string> {
  let i = 0
  while (i < text.length) {
    const size = Math.max(1, chunkSize + Math.floor(Math.random() * 8) - 4)
    yield text.slice(i, i + size)
    i += size
  }
}

// 模拟 Function Calling 场景
const FUNCTION_SCENARIOS = [
  {
    label: '附近地点',
    name: 'show_poi',
    args: { title: '故宫博物院', address: '北京市东城区景山前街4号', rating: 4.9, distance: '1.2km', category: '景点' },
  },
  {
    label: '路线规划',
    name: 'show_route',
    args: { origin: '天安门广场', destination: '颐和园', totalDuration: '约 45 分钟', totalDistance: '18km', mode: 'drive',
      steps: [{ name: '沿长安街向西', duration: '15min' }, { name: '转北四环', duration: '20min' }] },
  },
  {
    label: '温馨提示',
    name: 'show_tip',
    args: { level: 'warning', title: '出行提示', content: '故宫旺季门票需提前 7 天预约，建议尽早在官方 App 购票。', actions: [{ label: '立即预约' }] },
  },
]

// ─── 竞态演示用请求模拟 ────────────────────────────────────────────────────

interface RaceResult {
  id: string
  color: string
  label: string
  delay: number
  status: 'pending' | 'running' | 'done' | 'aborted'
  data?: string
}

// ─── 子场景：Streaming Markdown ───────────────────────────────────────────

function StreamingMarkdownDemo() {
  const [tokens, setTokens] = useState<MarkdownToken[]>([])
  const [chunkLog, setChunkLog] = useState<TokenChunk[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const parserRef = useRef(new StreamingParser())
  const rafRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chunkScrollRef = useRef<HTMLDivElement>(null)
  const { start: abortStart, abort } = useAbortableStream()

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    cancelAnimationFrame(rafRef.current)
    abort()
    parserRef.current = new StreamingParser()
    setTokens([])
    setChunkLog([])
    setProgress(0)
    setRunning(false)
  }, [abort])

  const start = useCallback(() => {
    reset()
    setRunning(true)
    abortStart()
    const parser = new StreamingParser()
    parserRef.current = parser

    const chunks = [...makeChunks(MOCK_MARKDOWN)]
    const total = chunks.length
    let idx = 0

    const tick = () => {
      if (idx >= chunks.length) {
        parser.commit()
        setTokens(parser.getTokens())
        setProgress(100)
        setRunning(false)
        // 最后一个 chunk 取消高亮
        setChunkLog(prev => prev.map(c => ({ ...c, isCurrent: false })))
        return
      }

      const batchSize = Math.min(3, chunks.length - idx)
      const newChunks: string[] = []
      for (let i = 0; i < batchSize; i++) {
        newChunks.push(chunks[idx++])
        parser.append(newChunks[newChunks.length - 1])
      }

      // rAF 节流：每帧 commit 一次
      rafRef.current = requestAnimationFrame(() => {
        parser.commit()
        setTokens(parser.getTokens())
        setProgress(Math.round((idx / total) * 100))

        // 更新 chunk 流日志：上一批取消高亮，新一批高亮最后一个
        setChunkLog(prev => {
          const cleared = prev.map(c => ({ ...c, isCurrent: false }))
          const added = newChunks.map((text, i) => ({ text, isCurrent: i === newChunks.length - 1 }))
          return [...cleared, ...added]
        })

        // 自动滚动到底部
        if (chunkScrollRef.current) {
          chunkScrollRef.current.scrollTop = chunkScrollRef.current.scrollHeight
        }
      })

      timerRef.current = setTimeout(tick, 60 + Math.random() * 40)
    }

    timerRef.current = setTimeout(tick, 0)
  }, [reset, abortStart])

  const handleAbort = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    cancelAnimationFrame(rafRef.current)
    abort()
    setRunning(false)
    setChunkLog(prev => prev.map(c => ({ ...c, isCurrent: false })))
  }, [abort])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      {/* 控制栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button onClick={start} disabled={running} style={btnStyle('#1890ff', running)}>
          {running ? '流式输出中…' : '▶ 开始'}
        </button>
        <button onClick={handleAbort} disabled={!running} style={btnStyle('#ff4d4f', !running)}>
          ⏹ 中断
        </button>
        <button onClick={reset} style={btnStyle('#8c8c8c')}>重置</button>
        <div style={{ flex: 1, height: 4, background: '#f0f0f0', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: '#1890ff', width: `${progress}%`, transition: 'width .1s' }} />
        </div>
        <span style={{ fontSize: 11, color: '#8c8c8c', minWidth: 30 }}>{progress}%</span>
      </div>

      {/* 双栏：左 SSE token 流 / 右渲染结果 */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, minHeight: 0 }}>
        {/* 左栏：SSE Token 流 */}
        <div style={{
          background: '#1e1e2e', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', minHeight: 0,
        }}>
          <div style={{ fontSize: 10, color: '#6c7086', marginBottom: 8, letterSpacing: 1, flexShrink: 0 }}>
            SSE TOKEN STREAM
          </div>
          <div
            ref={chunkScrollRef}
            style={{ flex: 1, overflowY: 'auto', fontSize: 11, fontFamily: 'monospace', lineHeight: 1.6 }}
          >
            {chunkLog.length === 0 && (
              <span style={{ color: '#45475a' }}>等待流式数据…</span>
            )}
            {chunkLog.map((chunk, i) => (
              <span
                key={i}
                style={{
                  background: chunk.isCurrent ? 'rgba(243,139,168,0.25)' : 'transparent',
                  color: chunk.isCurrent ? '#f38ba8' : '#cdd6f4',
                  borderRadius: 2,
                  transition: 'background 0.1s',
                }}
              >
                {chunk.text}
              </span>
            ))}
            {running && <span style={{ color: '#a6e3a1', animation: 'blink 0.8s step-end infinite' }}>▌</span>}
          </div>
        </div>

        {/* 右栏：渲染结果 */}
        <div style={{
          background: '#fff', borderRadius: 8, padding: 20, overflowY: 'auto',
          border: '1px solid #f0f0f0', minHeight: 0,
        }}>
          <div style={{ fontSize: 10, color: '#8c8c8c', marginBottom: 10, letterSpacing: 1 }}>
            RENDERED OUTPUT
          </div>
          {tokens.length === 0 && !running && (
            <div style={{ color: '#bfbfbf', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
              点击「开始」查看增量 Markdown 渲染
            </div>
          )}
          {tokens.map((t, i) => <TokenBlock key={i} token={t} />)}
          {running && <span style={{ display: 'inline-block', width: 8, height: 16, background: '#1890ff', animation: 'blink 1s step-end infinite', verticalAlign: 'text-bottom' }} />}
        </div>
      </div>

      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  )
}

function TokenBlock({ token }: { token: MarkdownToken }) {
  switch (token.type) {
    case 'heading': {
      const Tag = `h${token.depth || 1}` as 'h1'|'h2'|'h3'|'h4'|'h5'|'h6'
      const sizes: Record<number, number> = { 1: 22, 2: 18, 3: 15, 4: 14, 5: 13, 6: 12 }
      return <Tag style={{ margin: '12px 0 6px', fontSize: sizes[token.depth || 1], color: '#262626' }}>{token.text}</Tag>
    }
    case 'paragraph':
      return <p style={{ margin: '6px 0', fontSize: 13, color: '#595959', lineHeight: 1.7 }}>{token.text}</p>
    case 'code':
      return (
        <pre style={{
          background: '#1e1e2e', color: '#cdd6f4', borderRadius: 8, padding: '12px 16px',
          fontSize: 12, overflowX: 'auto', margin: '8px 0',
        }}>
          {token.lang && <span style={{ color: '#89b4fa', fontSize: 10, display: 'block', marginBottom: 4 }}>{token.lang}</span>}
          <code>{token.text}</code>
        </pre>
      )
    case 'blockquote':
      return (
        <blockquote style={{
          borderLeft: '3px solid #1890ff', paddingLeft: 12, margin: '8px 0',
          color: '#8c8c8c', fontSize: 13, fontStyle: 'italic',
        }}>{token.text}</blockquote>
      )
    case 'list_item':
      return <li style={{ fontSize: 13, color: '#595959', marginLeft: 20, lineHeight: 1.8 }}>{token.text}</li>
    case 'hr':
      return <hr style={{ border: 'none', borderTop: '1px solid #f0f0f0', margin: '12px 0' }} />
    default:
      return null
  }
}

// ─── 子场景：Generative UI ────────────────────────────────────────────────

interface GenUIResult {
  name: string
  args: Record<string, unknown>
}

function GenerativeUIDemo() {
  const [scenario, setScenario] = useState(0)
  const [rawChunks, setRawChunks] = useState<string[]>([])
  const [depth, setDepth] = useState(0)
  const [complete, setComplete] = useState(false)
  const [result, setResult] = useState<GenUIResult | null>(null)
  const [running, setRunning] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setRawChunks([])
    setDepth(0)
    setComplete(false)
    setResult(null)
    setRunning(false)
  }, [])

  const start = useCallback(() => {
    reset()
    const sc = FUNCTION_SCENARIOS[scenario]
    const fullJson = JSON.stringify(sc.args)
    const chunks = [...makeChunks(fullJson, 8)]
    let idx = 0
    const state = createTrackerState()
    const accumulated: string[] = []
    setRunning(true)

    const tick = () => {
      if (idx >= chunks.length) {
        setRunning(false)
        return
      }
      const chunk = chunks[idx++]
      accumulated.push(chunk)
      trackBracketDepth(chunk, state)
      setRawChunks([...accumulated])
      setDepth(state.depth)

      if (state.complete) {
        setComplete(true)
        setRunning(false)
        try {
          setResult({ name: sc.name, args: JSON.parse(state.buf) })
        } catch { /* ignore */ }
        return
      }
      timerRef.current = setTimeout(tick, 80 + Math.random() * 60)
    }
    timerRef.current = setTimeout(tick, 0)
  }, [scenario, reset])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 场景选择 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {FUNCTION_SCENARIOS.map((sc, i) => (
          <button key={i} onClick={() => { setScenario(i); reset() }}
            style={{
              ...btnStyle(i === scenario ? '#1890ff' : '#d9d9d9'),
              color: i === scenario ? '#fff' : '#595959',
            }}>
            {sc.label}
          </button>
        ))}
        <button onClick={start} disabled={running} style={{ ...btnStyle('#52c41a', running), marginLeft: 8 }}>
          {running ? '接收中…' : '▶ 模拟 Function Call'}
        </button>
        <button onClick={reset} style={btnStyle('#8c8c8c')}>重置</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* 左：原始 JSON chunks */}
        <div style={{ background: '#1e1e2e', borderRadius: 8, padding: 14, minHeight: 180 }}>
          <div style={{ fontSize: 10, color: '#6c7086', marginBottom: 8, letterSpacing: 1 }}>RAW JSON CHUNKS</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: '#cdd6f4' }}>括号深度：</span>
            <span style={{
              background: complete ? '#a6e3a1' : '#89b4fa',
              color: '#1e1e2e', borderRadius: 4, padding: '1px 8px', fontSize: 12, fontWeight: 700,
              transition: 'background 0.2s, color 0.2s',
              boxShadow: complete ? '0 0 8px rgba(166,227,161,0.6)' : 'none',
            }}>
              {depth} {complete ? '✓ 完成' : ''}
            </span>
          </div>
          <pre style={{ fontSize: 11, color: '#cdd6f4', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflowY: 'auto' }}>
            {rawChunks.map((c, i) => (
              <span key={i} style={{ color: i === rawChunks.length - 1 ? '#f38ba8' : '#cdd6f4' }}>{c}</span>
            ))}
            {running && <span style={{ color: '#a6e3a1', animation: 'blink 0.8s step-end infinite' }}>▌</span>}
          </pre>
        </div>

        {/* 右：渲染结果 */}
        <div style={{ background: '#fafafa', borderRadius: 8, padding: 14, minHeight: 180, border: '1px solid #f0f0f0' }}>
          <div style={{ fontSize: 10, color: '#8c8c8c', marginBottom: 12, letterSpacing: 1 }}>RENDERED COMPONENT</div>
          {!result && (
            <div style={{ color: '#bfbfbf', fontSize: 12, textAlign: 'center', paddingTop: 40 }}>
              {running ? '等待 JSON 完整闭合…' : '组件将在 JSON 完整后渲染'}
            </div>
          )}
          {result && (
            <div key={result.name} style={{ animation: 'genui-enter 280ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
              <DynamicComponent name={result.name} args={result.args} />
            </div>
          )}
          <style>{`
            @keyframes genui-enter {
              from { opacity: 0; transform: scale(0.90) translateY(8px); }
              to   { opacity: 1; transform: scale(1)    translateY(0);   }
            }
          `}</style>
        </div>
      </div>
    </div>
  )
}

function DynamicComponent({ name, args }: { name: string; args: Record<string, unknown> }) {
  if (name === 'show_poi') {
    return <POICard {...args as unknown as Parameters<typeof POICard>[0]} />
  }
  if (name === 'show_route') {
    return <RouteMap {...args as unknown as Parameters<typeof RouteMap>[0]} />
  }
  if (name === 'show_tip') {
    return <TipBlock {...args as unknown as Parameters<typeof TipBlock>[0]} />
  }
  return <pre style={{ fontSize: 11 }}>{JSON.stringify(args, null, 2)}</pre>
}

// ─── 子场景：Race Condition ───────────────────────────────────────────────

function RaceConditionDemo() {
  const { start, abort, isCurrentVersion, getCurrentVersion } = useAbortableStream()
  const [results, setResults] = useState<RaceResult[]>([])
  const [winner, setWinner] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])

  const addLog = useCallback((msg: string) => {
    setLog(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 20))
  }, [])

  const simulateRequest = useCallback((id: string, label: string, color: string, delay: number) => {
    const controller = start()
    const capturedVersion = getCurrentVersion()
    addLog(`→ 发起请求 ${label}（v${capturedVersion}，${delay}ms 后响应）`)

    setResults(prev => {
      const next = prev.filter(r => r.id !== id)
      return [...next, { id, color, label, delay, status: 'running' }]
    })

    setTimeout(() => {
      if (controller.signal.aborted) {
        addLog(`✗ 请求 ${label} 已被中止（AbortController）`)
        setResults(prev => prev.map(r => r.id === id ? { ...r, status: 'aborted' } : r))
        return
      }

      if (!isCurrentVersion(capturedVersion)) {
        addLog(`✗ 请求 ${label} 版本号 v${capturedVersion} 已过期，丢弃响应`)
        setResults(prev => prev.map(r => r.id === id ? { ...r, status: 'aborted' } : r))
        return
      }

      addLog(`✓ 请求 ${label} v${capturedVersion} 通过版本校验，更新 UI`)
      setWinner(label)
      setResults(prev => prev.map(r => r.id === id ? { ...r, status: 'done', data: `来自 ${label} 的数据` } : r))
    }, delay)
  }, [start, getCurrentVersion, isCurrentVersion, addLog])

  const runRaceScenario = useCallback(() => {
    setResults([])
    setWinner(null)
    setLog([])
    addLog('=== 开始竞态场景 ===')

    // 请求 A 先发，但响应慢（1500ms）
    simulateRequest('A', '请求A (慢)', '#ff4d4f', 1500)

    // 请求 B 后发，响应快（800ms）
    setTimeout(() => {
      simulateRequest('B', '请求B (快)', '#1890ff', 800)
    }, 200)
  }, [simulateRequest, addLog])

  const runAbortScenario = useCallback(() => {
    setResults([])
    setWinner(null)
    setLog([])
    addLog('=== 开始 Abort 场景 ===')

    simulateRequest('C', '请求C', '#722ed1', 2000)
    setTimeout(() => {
      addLog('→ 手动调用 abort()')
      abort()
    }, 500)
  }, [simulateRequest, abort, addLog])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 控制按钮 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={runRaceScenario} style={btnStyle('#1890ff')}>
          ⚡ 竞态场景（A慢B快）
        </button>
        <button onClick={runAbortScenario} style={btnStyle('#722ed1')}>
          🛑 手动 Abort 场景
        </button>
        <button onClick={() => { setResults([]); setWinner(null); setLog([]) }} style={btnStyle('#8c8c8c')}>
          重置
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* 请求状态卡片 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.length === 0 && (
            <div style={{ background: '#fafafa', borderRadius: 8, padding: 20, border: '1px solid #f0f0f0', color: '#bfbfbf', fontSize: 13, textAlign: 'center' }}>
              点击上方按钮开始演示
            </div>
          )}
          {results.map(r => (
            <div key={r.id} style={{
              background: '#fff', borderRadius: 8, padding: 14,
              border: `2px solid ${r.status === 'done' ? '#52c41a' : r.status === 'aborted' ? '#ff4d4f' : r.color}`,
              opacity: r.status === 'aborted' ? 0.6 : 1, transition: 'all .3s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#262626' }}>{r.label}</span>
                <span style={{
                  marginLeft: 'auto', fontSize: 11, padding: '1px 8px', borderRadius: 8, fontWeight: 600,
                  background: r.status === 'done' ? '#f6ffed' : r.status === 'aborted' ? '#fff2f0' : '#e6f4ff',
                  color: r.status === 'done' ? '#52c41a' : r.status === 'aborted' ? '#ff4d4f' : '#1890ff',
                  border: `1px solid ${r.status === 'done' ? '#b7eb8f' : r.status === 'aborted' ? '#ffccc7' : '#91caff'}`,
                }}>
                  {r.status === 'running' ? '⏳ 请求中' : r.status === 'done' ? '✓ 成功' : '✗ 丢弃'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#8c8c8c' }}>延迟 {r.delay}ms</div>
              {r.data && <div style={{ fontSize: 12, color: '#52c41a', marginTop: 4, fontWeight: 500 }}>{r.data}</div>}
            </div>
          ))}

          {winner && (
            <div style={{
              background: 'linear-gradient(135deg, #f6ffed, #d9f7be)', borderRadius: 8, padding: 12,
              border: '1px solid #b7eb8f', fontSize: 13, fontWeight: 600, color: '#237804', textAlign: 'center',
            }}>
              🏆 UI 展示：{winner} 的响应
            </div>
          )}
        </div>

        {/* 日志 */}
        <div style={{ background: '#1e1e2e', borderRadius: 8, padding: 14, maxHeight: 300, overflowY: 'auto' }}>
          <div style={{ fontSize: 10, color: '#6c7086', marginBottom: 8, letterSpacing: 1 }}>EVENT LOG</div>
          {log.length === 0 && (
            <div style={{ color: '#45475a', fontSize: 12 }}>等待事件…</div>
          )}
          {log.map((entry, i) => (
            <div key={i} style={{
              fontSize: 11, color: entry.includes('✓') ? '#a6e3a1' : entry.includes('✗') ? '#f38ba8' : '#cdd6f4',
              lineHeight: 1.7, fontFamily: 'monospace',
            }}>
              {entry}
            </div>
          ))}
        </div>
      </div>

      {/* 原理说明 */}
      <div style={{ background: '#f0f5ff', borderRadius: 8, padding: 12, border: '1px solid #adc6ff', fontSize: 12, color: '#1d4ed8' }}>
        <strong>原理：</strong>每次 start() 递增版本号并中止上一个 AbortController；
        SSE 回调先调用 isCurrentVersion(v)，版本不匹配则丢弃，确保只有最新请求能更新 UI。
      </div>
    </div>
  )
}

// ─── 主组件 ──────────────────────────────────────────────────────────────

const SUB_SCENES: Array<{ id: SubScene; label: string; icon: string; desc: string }> = [
  { id: 'markdown', icon: '📝', label: 'Streaming Markdown', desc: '增量解析 · rAF 节流 · getNewTokens delta' },
  { id: 'genui',    icon: '⚡', label: 'Generative UI',      desc: 'BracketDepth 检测 · Function Call → 动态组件' },
  { id: 'race',     icon: '🔒', label: 'Race Condition',     desc: 'AbortController · 版本号竞态防护' },
]

export function StreamingScene() {
  const [active, setActive] = useState<SubScene>('markdown')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* 子场景 Tab */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #f0f0f0',
        padding: '0 20px', display: 'flex', gap: 4, flexShrink: 0,
      }}>
        {SUB_SCENES.map(s => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            title={s.desc}
            style={{
              padding: '10px 16px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: active === s.id ? 600 : 400,
              background: 'transparent',
              color: active === s.id ? '#1890ff' : '#595959',
              borderBottom: active === s.id ? '2px solid #1890ff' : '2px solid transparent',
              display: 'flex', alignItems: 'center', gap: 6, transition: 'all .15s',
            }}
          >
            <span>{s.icon}</span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, padding: '16px 20px', overflow: 'auto' }}>
        {active === 'markdown' && <StreamingMarkdownDemo />}
        {active === 'genui'    && <GenerativeUIDemo />}
        {active === 'race'     && <RaceConditionDemo />}
      </div>
    </div>
  )
}

// ─── 工具函数 ────────────────────────────────────────────────────────────

function btnStyle(color: string, disabled?: boolean): React.CSSProperties {
  return {
    padding: '6px 14px', borderRadius: 6, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled ? '#d9d9d9' : color, color: '#fff', fontSize: 12, fontWeight: 500,
    opacity: disabled ? 0.7 : 1, transition: 'opacity .15s',
  }
}
