import React, { useState, useRef } from 'react'
import type { AIEngine } from '../ai/AIEngine'
import type { AICommand } from '../core/types'

interface AICopilotProps {
  aiEngine: AIEngine
  selectedText: string
  onReplace: (text: string) => void
  onInsert: (text: string) => void
  isOpen: boolean
  onClose: () => void
}

interface Message {
  id: number
  role: 'user' | 'ai'
  content: string
}

const commandDefs: { cmd: AICommand; label: string; icon: string }[] = [
  { cmd: 'summarize', label: '摘要', icon: 'S' },
  { cmd: 'translate', label: '翻译', icon: 'T' },
  { cmd: 'fix_grammar', label: '修正语法', icon: 'G' },
  { cmd: 'expand', label: '扩写', icon: 'E' },
  { cmd: 'shorten', label: '精简', icon: 'C' },
]

export const AICopilot: React.FC<AICopilotProps> = ({
  aiEngine, selectedText, onReplace, onInsert, isOpen, onClose,
}) => {
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [input, setInput] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  if (!isOpen) return null

  const scrollToBottom = () => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  const runCommand = async (cmd: AICommand) => {
    if (isStreaming) return
    const controller = new AbortController()
    abortRef.current = controller
    setIsStreaming(true)

    const userMsg: Message = { id: Date.now(), role: 'user', content: `/${cmd} — ${selectedText.slice(0, 50)}${selectedText.length > 50 ? '...' : ''}` }
    setMessages(prev => [...prev, userMsg])

    const aiMsg: Message = { id: Date.now() + 1, role: 'ai', content: '' }
    setMessages(prev => [...prev, aiMsg])
    scrollToBottom()

    try {
      let full = ''
      const gen = aiEngine.stream(
        { command: cmd, selectedText, targetLanguage: cmd === 'translate' ? 'zh' : undefined },
        controller.signal
      )
      for await (const token of gen) {
        full += token
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'ai') last.content = full
          return updated
        })
        scrollToBottom()
      }

      if (cmd === 'translate' || cmd === 'fix_grammar') {
        onReplace(full)
      } else {
        onInsert(full)
      }
    } catch {
      // aborted
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return
    const userMsg: Message = { id: Date.now(), role: 'user', content: input }
    setMessages(prev => [...prev, userMsg])

    const controller = new AbortController()
    abortRef.current = controller
    setIsStreaming(true)

    const aiMsg: Message = { id: Date.now() + 1, role: 'ai', content: '' }
    setMessages(prev => [...prev, aiMsg])
    scrollToBottom()

    try {
      let full = ''
      const gen = aiEngine.stream(
        { command: 'continue', selectedText: '', context: input },
        controller.signal
      )
      for await (const token of gen) {
        full += token
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'ai') last.content = full
          return updated
        })
        scrollToBottom()
      }
      onInsert(full)
    } catch {
      // aborted
    } finally {
      setIsStreaming(false)
      abortRef.current = null
      setInput('')
    }
  }

  const abort = () => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }

  return (
    <div style={{
      width: 320,
      background: '#1e1e2e',
      borderLeft: '1px solid #313244',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #313244',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontWeight: 700, color: '#cba6f7', fontSize: 14 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: -2, marginRight: 6 }}>
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          AI Copilot
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: 16 }}>x</button>
      </div>

      {selectedText && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #313244', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {commandDefs.map(({ cmd, label, icon }) => (
            <button
              key={cmd}
              onClick={() => runCommand(cmd)}
              disabled={isStreaming}
              style={{
                background: '#313244',
                border: 'none',
                color: '#cdd6f4',
                padding: '4px 10px',
                borderRadius: 14,
                fontSize: 12,
                cursor: isStreaming ? 'not-allowed' : 'pointer',
                opacity: isStreaming ? 0.5 : 1,
                fontFamily: 'inherit',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.length === 0 && (
          <div style={{ color: '#6c7086', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
            选中文本后使用快捷操作<br />或在下方输入指令
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} style={{
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '90%',
            padding: '8px 12px',
            borderRadius: 10,
            background: msg.role === 'user' ? '#45475a' : '#313244',
            fontSize: 13,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}>
            {msg.content || (isStreaming && msg.role === 'ai' ? <span className="thinking-dots">...</span> : null)}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: '8px 16px', borderTop: '1px solid #313244', display: 'flex', gap: 6 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="输入指令..."
          disabled={isStreaming}
          style={{
            flex: 1,
            background: '#313244',
            border: '1px solid #45475a',
            borderRadius: 8,
            padding: '8px 12px',
            color: '#cdd6f4',
            fontSize: 13,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        {isStreaming ? (
          <button
            onClick={abort}
            style={{
              background: '#f38ba8',
              border: 'none',
              color: '#1e1e2e',
              padding: '8px 12px',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 700,
              fontFamily: 'inherit',
            }}
          >
            停止
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            style={{
              background: '#cba6f7',
              border: 'none',
              color: '#1e1e2e',
              padding: '8px 12px',
              borderRadius: 8,
              cursor: input.trim() ? 'pointer' : 'not-allowed',
              opacity: input.trim() ? 1 : 0.5,
              fontSize: 13,
              fontWeight: 700,
              fontFamily: 'inherit',
            }}
          >
            发送
          </button>
        )}
      </div>
    </div>
  )
}