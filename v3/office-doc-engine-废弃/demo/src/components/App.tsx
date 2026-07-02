import React, { useState, useRef, useEffect, useCallback } from 'react'
import { EditorCore } from '../editor/EditorCore'
import { AIEngine } from '../ai/AIEngine'
import { VersionStore } from '../history/VersionStore'
import { ExportEngine } from '../export/ExportEngine'
import { PerfCollector } from '../perf/PerfCollector'
import { DocumentModel } from '../core/DocumentModel'
import { EventBus } from '../core/EventBus'
import { OTEngine } from '../ot/OTEngine'
import { collabCursorKey } from '../editor/plugins/CollabCursorPlugin'
import type { CollabUser } from '../core/types'

import { Toolbar } from './Toolbar'
import { DocEditor } from './DocEditor'
import { AICopilot } from './AICopilot'
import { VersionHistory } from './VersionHistory'
import { PerfPanel } from './PerfPanel'
import { CollabAvatars } from './CollabAvatars'

// ── Mock collaborators ────────────────────────────────────────────────────────
const MOCK_USERS: CollabUser[] = [
  { id: 'bob', name: 'Bob', color: '#f38ba8', cursor: { blockId: '', offset: 0 }, selection: null, isOnline: true, lastSeen: Date.now() },
  { id: 'carol', name: 'Carol', color: '#89b4fa', cursor: { blockId: '', offset: 0 }, selection: null, isOnline: true, lastSeen: Date.now() },
]

// ── Initial document (rich content demo) ──────────────────────────────────────
const INITIAL_DOC = `{"type":"doc","content":[{"type":"heading","attrs":{"level":1,"id":"h1"},"content":[{"type":"text","text":"在线 Office 文档引擎演示"}]},{"type":"paragraph","attrs":{"id":"p1"},"content":[{"type":"text","text":"本演示展示了对标 Google Docs / Notion 的在线文档引擎核心能力：富文本编辑、AI Copilot、实时协同、版本历史、性能监控。"}]},{"type":"heading","attrs":{"level":2,"id":"h2a"},"content":[{"type":"text","text":"富文本编辑"}]},{"type":"paragraph","attrs":{"id":"p2"},"content":[{"type":"text","text":"支持 Markdown 快捷输入：输入 "},{"type":"text","marks":[{"type":"code"}],"text":"# 空格"},{"type":"text","text":" 创建标题，"},{"type":"text","marks":[{"type":"code"}],"text":"- 空格"},{"type":"text","text":" 创建列表，"},{"type":"text","marks":[{"type":"code"}],"text":"> 空格"},{"type":"text","text":" 创建引用块。支持 "},{"type":"text","marks":[{"type":"bold"}],"text":"加粗"},{"type":"text","text":"、"},{"type":"text","marks":[{"type":"italic"}],"text":"斜体"},{"type":"text","text":"、"},{"type":"text","marks":[{"type":"underline"}],"text":"下划线"},{"type":"text","text":" 等格式。"}]},{"type":"heading","attrs":{"level":2,"id":"h2b"},"content":[{"type":"text","text":"AI Copilot"}]},{"type":"paragraph","attrs":{"id":"p3"},"content":[{"type":"text","text":"停止输入 800ms 后，AI 会在光标处生成幽灵文本建议，按 "},{"type":"text","marks":[{"type":"code"}],"text":"Tab"},{"type":"text","text":" 接受，"},{"type":"text","marks":[{"type":"code"}],"text":"Esc"},{"type":"text","text":" 拒绝。选中文本后可使用摘要、翻译、语法修正等操作。"}]},{"type":"heading","attrs":{"level":2,"id":"h2c"},"content":[{"type":"text","text":"实时协同"}]},{"type":"paragraph","attrs":{"id":"p4"},"content":[{"type":"text","text":"点击右上角用户头像激活模拟协作者，观察光标和多用户同时编辑的效果。本引擎基于 OT 变换算法保证最终一致性。"}]},{"type":"heading","attrs":{"level":2,"id":"h2d"},"content":[{"type":"text","text":"关于 AI"}]},{"type":"paragraph","attrs":{"id":"p5"},"content":[{"type":"text","text":"人工智能正在重塑我们与文档的交互方式。大型语言模型通过自然语言理解，能够帮助用户更快速、更精准地完成写作、分析和协作任务。这不仅提升了个人生产力，也为团队知识管理带来了全新的可能性。"}]}]}`

export const App: React.FC = () => {
  // ── State ──────────────────────────────────────────────────────────────
  const [perfVisible, setPerfVisible] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [activeUsers, setActiveUsers] = useState<Set<string>>(new Set())
  const [notification, setNotification] = useState<string | null>(null)

  // ── Refs ───────────────────────────────────────────────────────────────
  const editorRef = useRef<EditorCore | null>(null)
  const aiEngineRef = useRef(new AIEngine())
  const versionStoreRef = useRef(new VersionStore({ maxSnapshots: 30 }))
  const exportEngineRef = useRef(new ExportEngine())
  const perfCollectorRef = useRef(new PerfCollector())
  const docModelRef = useRef(DocumentModel.empty('demo', '演示文档'))

  // ── Effects ────────────────────────────────────────────────────────────
  useEffect(() => {
    perfCollectorRef.current.start()
    return () => perfCollectorRef.current.stop()
  }, [])

  // Auto-snapshot every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      if (editorRef.current) {
        const content = editorRef.current.getContent()
        const id = versionStoreRef.current.snapshot(
          { body: content, timestamp: Date.now() },
          'auto'
        )
        perfCollectorRef.current.setBlockCount(
          versionStoreRef.current.list().length
        )
      }
    }, 30000)
    return () => clearInterval(timer)
  }, [])

  // Simulate collaborators
  useEffect(() => {
    const intervals: ReturnType<typeof setInterval>[] = []

    for (const user of MOCK_USERS) {
      if (!activeUsers.has(user.id)) continue

      const interval = setInterval(() => {
        if (!editorRef.current?.view) return
        const view = editorRef.current.view
        const docSize = view.state.doc.content.size
        if (docSize < 5) return

        // Simulate random insert at end of doc
        const phrases = user.id === 'bob'
          ? ['同意。', '有道理！', '补充一点：']
          : ['这里可能需要更多细节。', '建议改成：', '已确认。']

        const text = phrases[Math.floor(Math.random() * phrases.length)]
        const pos = Math.min(docSize - 1, Math.floor(Math.random() * docSize))

        try {
          const tr = view.state.tr.insertText(text + ' ', pos)
          view.dispatch(tr)
        } catch { /* ignore invalid positions */ }
      }, 3000 + Math.random() * 4000)

      intervals.push(interval)
    }

    return () => intervals.forEach(clearInterval)
  }, [activeUsers])

  // Update collab cursors
  useEffect(() => {
    if (!editorRef.current?.view) return
    const users = MOCK_USERS.filter(u => activeUsers.has(u.id)).map(u => ({
      ...u,
      cursor: { blockId: '', offset: Math.floor(Math.random() * 10) },
    }))
    editorRef.current.view.dispatch(
      editorRef.current.view.state.tr.setMeta(collabCursorKey, users)
    )
  }, [activeUsers])

  // ── Handlers ───────────────────────────────────────────────────────────
  const notify = useCallback((msg: string) => {
    setNotification(msg)
    setTimeout(() => setNotification(null), 2000)
  }, [])

  const handleDocChange = useCallback((doc: string) => {
    const start = performance.now()
    // Could run OT transform here
    const elapsed = performance.now() - start
    perfCollectorRef.current.recordOperation(elapsed)
    perfCollectorRef.current.setDocumentSize(doc.length)
  }, [])

  const handleSelectionChange = useCallback((text: string) => {
    setSelectedText(text)
  }, [])

  const handleBold = () => editorRef.current?.toggleMark('bold')
  const handleItalic = () => editorRef.current?.toggleMark('italic')
  const handleUnderline = () => editorRef.current?.toggleMark('underline')

  const handleExportMD = () => {
    if (!editorRef.current) return
    // Simple string export for demo
    const text = editorRef.current.view.state.doc.textContent
    const blob = new Blob([text], { type: 'text/markdown' })
    downloadBlob(blob, 'document.md')
    notify('已导出 Markdown')
  }

  const handleExportHTML = () => {
    if (!editorRef.current) return
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:sans-serif;max-width:800px;margin:2rem auto;line-height:1.8}</style></head><body>${editorRef.current.view.dom.innerHTML}</body></html>`
    const blob = new Blob([html], { type: 'text/html' })
    downloadBlob(blob, 'document.html')
    notify('已导出 HTML')
  }

  const handleToggleUser = (userId: string) => {
    setActiveUsers(prev => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  const handleRestore = (snapshotId: string) => {
    const content = versionStoreRef.current.restore(snapshotId)
    if (editorRef.current && content.body) {
      editorRef.current.setContent(content.body as string)
      notify('已恢复到所选版本')
    }
  }

  const handleAIReplace = (text: string) => {
    if (!editorRef.current?.view) return
    const { from, to } = editorRef.current.view.state.selection
    if (from < to) {
      editorRef.current.view.dispatch(editorRef.current.view.state.tr.insertText(text, from, to))
    }
    notify('AI 已替换选中内容')
  }

  const handleAIInsert = (text: string) => {
    if (!editorRef.current?.view) return
    const pos = editorRef.current.view.state.selection.$head.pos
    editorRef.current.view.dispatch(
      editorRef.current.view.state.tr.insertText('\n' + text + '\n', pos)
    )
    notify('AI 内容已插入')
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#1e1e2e' }}>
      <Toolbar
        onBold={handleBold}
        onItalic={handleItalic}
        onUnderline={handleUnderline}
        onExportMD={handleExportMD}
        onExportHTML={handleExportHTML}
        onVersionHistory={() => setHistoryOpen(true)}
        onTogglePerf={() => setPerfVisible(v => !v)}
        perfVisible={perfVisible}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <DocEditor
          editorRef={editorRef}
          aiEngine={aiEngineRef.current}
          collabUsers={MOCK_USERS.filter(u => activeUsers.has(u.id))}
          onDocChange={handleDocChange}
          onSelectionChange={handleSelectionChange}
          content={INITIAL_DOC}
        />

        {/* Right sidebar */}
        <div style={{
          width: 40,
          background: '#181825',
          borderLeft: '1px solid #313244',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 12,
          gap: 8,
        }}>
          <CollabAvatars users={MOCK_USERS} activeIds={activeUsers} onToggleUser={handleToggleUser} />

          <button
            onClick={() => setAiOpen(v => !v)}
            title="AI Copilot"
            style={{
              width: 30, height: 30, borderRadius: 8,
              background: aiOpen ? '#cba6f7' : '#313244',
              border: 'none', color: aiOpen ? '#1e1e2e' : '#6c7086',
              cursor: 'pointer', fontSize: 16, marginTop: 8,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </button>
        </div>

        <AICopilot
          aiEngine={aiEngineRef.current}
          selectedText={selectedText}
          onReplace={handleAIReplace}
          onInsert={handleAIInsert}
          isOpen={aiOpen}
          onClose={() => setAiOpen(false)}
        />
      </div>

      <VersionHistory
        store={versionStoreRef.current}
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onRestore={handleRestore}
      />

      <PerfPanel
        collector={perfCollectorRef.current}
        visible={perfVisible}
        onClose={() => setPerfVisible(false)}
      />

      {/* Toast notification */}
      {notification && (
        <div style={{
          position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: '#a6e3a1', color: '#1e1e2e', padding: '8px 20px',
          borderRadius: 20, fontSize: 13, fontWeight: 600, zIndex: 99999,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)', animation: 'fadeIn 0.2s',
        }}>
          {notification}
        </div>
      )}

      {/* Global styles */}
      <style>{`
        .ProseMirror { outline: none; min-height: 100%; padding: 16px 0; }
        .ProseMirror p { margin: 4px 0; line-height: 1.7; }
        .ProseMirror h1 { font-size: 28px; font-weight: 700; margin: 16px 0 8px; color: #cba6f7; }
        .ProseMirror h2 { font-size: 22px; font-weight: 600; margin: 14px 0 6px; color: #89dceb; }
        .ProseMirror h3 { font-size: 18px; font-weight: 600; margin: 12px 0 4px; color: #94e2d5; }
        .ProseMirror blockquote { border-left: 3px solid #cba6f7; padding-left: 16px; margin: 8px 0; color: #a6adc8; font-style: italic; }
        .ProseMirror pre { background: #11111b; padding: 14px 18px; border-radius: 8px; margin: 8px 0; font-family: "JetBrains Mono", monospace; font-size: 13px; overflow-x: auto; }
        .ProseMirror code { background: #313244; padding: 2px 6px; border-radius: 4px; font-family: "JetBrains Mono", monospace; font-size: 0.9em; }
        .ProseMirror pre code { background: none; padding: 0; }
        .ProseMirror ul, .ProseMirror ol { padding-left: 24px; margin: 4px 0; }
        .ProseMirror li { margin: 2px 0; }
        .ProseMirror hr { border: none; border-top: 1px solid #45475a; margin: 16px 0; }
        .ProseMirror strong { color: #f5c2e7; }
        .ProseMirror em { color: #f5e0dc; }
        .ProseMirror u { text-decoration-color: #89b4fa; text-underline-offset: 2px; }
        .ProseMirror s { color: #6c7086; }
        .ProseMirror a { color: #89b4fa; text-decoration: underline; }
        .ProseMirror mark { background: #f9e2af44; color: #f9e2af; padding: 1px 4px; border-radius: 3px; }
        .ai-ghost-text { color: #6c7086; font-style: italic; animation: ghostPulse 1.5s infinite; }
        .ai-generated { background: linear-gradient(90deg, #cba6f722, transparent); border-radius: 2px; }
        .collab-cursor { position: relative; }
        @keyframes ghostPulse { 0%,100% { opacity: 0.5; } 50% { opacity: 0.8; } }
        @keyframes fadeIn { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
        /* Scrollbar */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #45475a; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #585b70; }
        /* Placeholder */
        .ProseMirror p.is-editor-empty:first-child::before { color: #6c7086; content: attr(data-placeholder); float: left; height: 0; pointer-events: none; }
      `}</style>
    </div>
  )
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}