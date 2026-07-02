import React, { useEffect, useRef, useState, useCallback } from 'react'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { schema } from 'prosemirror-schema-basic'
import { baseKeymap } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'

import { EventBus } from '../../core/EventBus'
import { AnnotationStore } from '../../core/AnnotationStore'
import type { Annotation } from '../../core/types'
import type { PerfCollector } from '../../perf/PerfCollector'

import { createDecorationPlugin, injectWavyStyles, decorationPluginKey } from './DecorationPlugin'
import { useInspection } from './useInspection'
import { ErrorPanel } from './ErrorPanel'

// ──────────────────── Mock inspection data ────────────────────

const SAMPLE_TEXT = `人工智能技朮的快速发展，使得自然语言处理领域取得了前所未有的突破。
大模型（Large Language Model，缩写LLM）已经成为人工智能领域的研究热点和落脚点。
目前，GPT-4等大模型已能够处理复杂的多膜态任务，包括图片理解、代码生成等。
据统计，截止2023年底，全球已有超过1,0000家公司部署了AI解决方案。
习近平指出，要牢牢把握住人工智能发展的战略机遇，在核心技术上取得重大突破。`

interface MockError {
  from: number
  to: number
  type: Annotation['type']
  original: string
  suggestion: string
}

function generateMockErrors(text: string): MockError[] {
  const errors: MockError[] = []

  const patterns: Array<{
    regex: RegExp
    type: Annotation['type']
    getSuggestion: (match: string) => string
  }> = [
    { regex: /技朮/g,  type: 'error-spelling',    getSuggestion: () => '技术' },
    { regex: /膜态/g,  type: 'error-spelling',    getSuggestion: () => '模态' },
    { regex: /落脚点/g, type: 'error-grammar',    getSuggestion: () => '落脚点（建议改为：着力点）' },
    { regex: /截止/g,  type: 'error-grammar',    getSuggestion: () => '截至' },
    { regex: /1,0000/g, type: 'error-number',   getSuggestion: () => '10000' },
    { regex: /，缩写LLM）/g, type: 'error-punctuation', getSuggestion: () => '，缩写：LLM）' },
    { regex: /习近平/g, type: 'error-political',  getSuggestion: () => '（请核实相关表述的规范性）' },
  ]

  for (const { regex, type, getSuggestion } of patterns) {
    let m: RegExpExecArray | null
    regex.lastIndex = 0
    while ((m = regex.exec(text)) !== null) {
      errors.push({
        from: m.index,
        to: m.index + m[0].length,
        type,
        original: m[0],
        suggestion: getSuggestion(m[0]),
      })
    }
  }

  return errors
}

function errorsToAnnotations(errors: MockError[]): Annotation[] {
  return errors.map((e, i) => ({
    id: `insp-${i}-${Date.now()}`,
    type: e.type,
    // ProseMirror doc：段落节点开标签占位 1，文本字符从 pos 1 开始
    // regex 返回的 m.index 是字符串 0-based 偏移，需 +1 转换为 PM position
    position: { kind: 'offset' as const, from: e.from + 1, to: e.to + 1 },
    content: { original: e.original, suggestion: e.suggestion },
    status: 'active' as const,
  }))
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// ──────────────────── ThinkingDots component ────────────────────

function ThinkingDots() {
  return (
    <span style={{ fontSize: 12, color: '#1890ff', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      AI 分析中
      <span style={{ display: 'inline-flex', gap: 3, marginLeft: 2 }}>
        {[0, 1, 2].map(i => (
          <span
            key={i}
            style={{
              width: 5, height: 5, borderRadius: '50%', background: '#1890ff',
              display: 'inline-block',
              animation: 'thinking-bounce 1.2s ease-in-out infinite',
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </span>
    </span>
  )
}

// ──────────────────── Tooltip component ────────────────────

interface TooltipInfo {
  x: number
  y: number
  annotation: Annotation
}

const Tooltip: React.FC<{
  info: TooltipInfo
  onAccept: (id: string) => void
  onIgnore: (id: string) => void
  onClose: () => void
}> = ({ info, onAccept, onIgnore, onClose }) => {
  const { x, y, annotation } = info
  return (
    // data-annotation-tooltip：供 mouseout 判断是否移入了 tooltip，避免提前关闭
    <div data-annotation-tooltip onMouseLeave={onClose} style={{
      position: 'fixed',
      left: x,
      top: y - 4,
      transform: 'translate(-50%, -100%)',
      background: '#fff',
      border: '1px solid #e8e8e8',
      borderRadius: 6,
      padding: '8px 12px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
      zIndex: 9999,
      fontSize: 13,
      minWidth: 180,
      maxWidth: 260,
      pointerEvents: 'all',
    }}>
      <div style={{ fontWeight: 600, color: '#333', marginBottom: 4 }}>
        {annotation.content.original}
      </div>
      {annotation.content.suggestion && (
        <div style={{ color: '#52c41a', marginBottom: 8 }}>
          建议：{annotation.content.suggestion}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => onAccept(annotation.id)}
          style={{
            padding: '2px 8px',
            background: '#1890ff',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          接受
        </button>
        <button
          onClick={() => onIgnore(annotation.id)}
          style={{
            padding: '2px 8px',
            background: '#f5f5f5',
            color: '#666',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          忽略
        </button>
      </div>
    </div>
  )
}

// ──────────────────── Main component ────────────────────

interface InspectionTextProps {
  collector?: PerfCollector
}

export const InspectionText: React.FC<InspectionTextProps> = ({ collector }) => {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const debounceTimerRef = useRef<number | null>(null)
  const staggerTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null)
  const [thinking, setThinking] = useState(false)

  // Core instances, stable across renders
  const busRef = useRef(new EventBus())
  const storeRef = useRef(new AnnotationStore(busRef.current))

  const { annotations, activeId, accept, ignore, focusNext, focusPrev } =
    useInspection(busRef.current, storeRef.current)

  // 清除 stagger timers
  const clearStaggerTimers = useCallback(() => {
    staggerTimersRef.current.forEach(t => clearTimeout(t))
    staggerTimersRef.current = []
  }, [])

  // 流式标注：thinking 1.5s → 逐条 add（80ms stagger）
  const runInspection = useCallback((text: string) => {
    clearStaggerTimers()
    setThinking(true)
    storeRef.current.load([])  // 清空旧标注

    const t0 = performance.now()
    const errors = generateMockErrors(text)
    const anns = errorsToAnnotations(errors)

    // 1.5s 后开始逐条加载
    const thinkingTimer = setTimeout(() => {
      setThinking(false)
      anns.forEach((ann, i) => {
        const t = setTimeout(() => {
          storeRef.current.add(ann)
          if (i === anns.length - 1) {
            collector?.recordRender(performance.now() - t0)
            collector?.setAnnotationCount(anns.length)
          }
        }, i * 80)
        staggerTimersRef.current.push(t)
      })
    }, 1500)
    staggerTimersRef.current.push(thinkingTimer)
  }, [clearStaggerTimers, collector])

  // ── 强制 ProseMirror 重算 decorations（绕开 EventBus 可能的异步时序）──
  const refreshDecorations = useCallback(() => {
    const v = viewRef.current
    if (!v) return
    v.dispatch(v.state.tr.setMeta(decorationPluginKey, 'refresh'))
  }, [])

  useEffect(() => {
    injectWavyStyles()

    if (!editorRef.current) return

    const decorationPlugin = createDecorationPlugin(storeRef.current, busRef.current)

    const state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text(SAMPLE_TEXT)]),
      ]),
      plugins: [
        history(),
        keymap({ 'Mod-z': undo, 'Mod-y': redo }),
        keymap(baseKeymap),
        decorationPlugin,
      ],
    })

    const view = new EditorView(editorRef.current, {
      state,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)

        if (tr.docChanged) {
          if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = window.setTimeout(() => {
            const text = newState.doc.textContent
            runInspection(text)
          }, 500)
        }
      },
      handleDOMEvents: {
        mouseover(_view, event) {
          const target = event.target as HTMLElement
          // 忽略移入 tooltip 内部的事件（tooltip 是 fixed 定位，在 editor DOM 树外）
          const span = target.closest('[data-id]') as HTMLElement | null
          if (!span) {
            // 只有在非 tooltip 区域才重置
            if (!target.closest('[data-annotation-tooltip]')) {
              setTooltip(null)
              busRef.current.emit({ type: 'ANNOTATION_HOVER', id: null })
            }
            return false
          }
          const id = span.getAttribute('data-id')
          if (!id) return false
          const ann = storeRef.current.getById(id)
          if (!ann || ann.status !== 'active') {
            setTooltip(null)
            busRef.current.emit({ type: 'ANNOTATION_HOVER', id: null })
            return false
          }
          const bcr = span.getBoundingClientRect()
          setTooltip({
            x: bcr.left + bcr.width / 2,
            y: bcr.top,
            annotation: ann,
          })
          // 联动右侧 ErrorPanel：高亮对应卡片
          busRef.current.emit({ type: 'ANNOTATION_HOVER', id })
          return false
        },
        mouseout(_view, event) {
          const related = (event as MouseEvent).relatedTarget as HTMLElement | null
          // 鼠标移入 tooltip 本身时不关闭，用户需要点击 tooltip 内的按钮
          if (related?.closest('[data-annotation-tooltip]')) return false
          if (!related?.closest('[data-id]')) {
            setTooltip(null)
            busRef.current.emit({ type: 'ANNOTATION_HOVER', id: null })
          }
          return false
        },
      },
    })

    viewRef.current = view

    // Run initial inspection
    runInspection(SAMPLE_TEXT)

    return () => {
      if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
      clearStaggerTimers()
      view.destroy()
    }
  }, [runInspection, clearStaggerTimers])

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', fontFamily: 'sans-serif' }}>
      {/* ProseMirror editor pane */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24, position: 'relative' }}>
        <style>{`
          @keyframes thinking-bounce {
            0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
            40% { transform: scale(1); opacity: 1; }
          }
          @keyframes ann-fade-in {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
          [data-id] {
            animation: ann-fade-in 200ms ease-out;
          }
        `}</style>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, color: '#333' }}>智能文本校对</h3>
            {thinking && <ThinkingDots />}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={focusPrev}
              title="Shift+F8"
              style={navBtnStyle}
            >↑ 上一处</button>
            <button
              onClick={focusNext}
              title="F8"
              style={navBtnStyle}
            >↓ 下一处</button>
          </div>
        </div>

        <div
          ref={editorRef}
          style={{
            border: '1px solid #e8e8e8',
            borderRadius: 6,
            padding: '16px 20px',
            minHeight: 200,
            background: '#fff',
            fontSize: 15,
            lineHeight: 1.8,
            color: '#333',
            outline: 'none',
          }}
        />

        <div style={{ marginTop: 12, fontSize: 12, color: '#aaa' }}>
          提示：文字输入后 0.5s 自动重新校对 · F8 跳到下一处 · Shift+F8 跳到上一处
        </div>
      </div>

      {/* Error panel */}
      <ErrorPanel
        annotations={annotations}
        activeId={activeId}
        onAccept={id => { accept(id); setTooltip(null); refreshDecorations() }}
        onIgnore={id => { ignore(id); setTooltip(null); refreshDecorations() }}
        onFocus={id => {
          // 面板点击 → 编辑器滚动到对应位置
          busRef.current.emit({ type: 'SCROLL_TO', annotationId: id })
          const ann = storeRef.current.getById(id)
          if (ann?.position.kind === 'offset' && viewRef.current) {
            const { from } = ann.position
            viewRef.current.dispatch(
              viewRef.current.state.tr.scrollIntoView()
            )
            // 将光标移到错误位置触发滚动
            try {
              const resolved = viewRef.current.state.doc.resolve(from)
              const tr = viewRef.current.state.tr
                .setSelection(TextSelection.near(resolved))
                .scrollIntoView()
              viewRef.current.dispatch(tr)
              viewRef.current.focus()
            } catch { /* ignore */ }
          }
        }}
      />

      {/* Hover tooltip */}
      {tooltip && (
        <Tooltip
          info={tooltip}
          onAccept={id => { accept(id); setTooltip(null); refreshDecorations() }}
          onIgnore={id => { ignore(id); setTooltip(null); refreshDecorations() }}
          onClose={() => setTooltip(null)}
        />
      )}
    </div>
  )
}

const navBtnStyle: React.CSSProperties = {
  padding: '4px 12px',
  border: '1px solid #d9d9d9',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 12,
  color: '#555',
}
