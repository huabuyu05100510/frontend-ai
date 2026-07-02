import React, { useRef, useEffect } from 'react'
import { EditorCore } from '../editor/EditorCore'
import type { AIEngine } from '../ai/AIEngine'
import type { CollabUser } from '../core/types'

interface DocEditorProps {
  editorRef: React.MutableRefObject<EditorCore | null>
  aiEngine: AIEngine
  collabUsers: CollabUser[]
  onDocChange: (doc: string) => void
  onSelectionChange: (text: string) => void
  content?: string
}

export const DocEditor: React.FC<DocEditorProps> = ({
  editorRef, aiEngine, collabUsers, onDocChange, onSelectionChange, content,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const aiEngineRef = useRef(aiEngine) // stable ref to avoid re-init
  aiEngineRef.current = aiEngine

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return

    const editor = new EditorCore({
      container: containerRef.current,
      aiEngine: aiEngineRef.current,
      collabUsers,
      onDocChange,
      initialContent: content,
    })
    editorRef.current = editor
    // Set initial content if provided
    if (content) {
      setTimeout(() => editor.setContent(content), 50)
    }

    // Track selection
    const handleSelection = () => {
      const { view } = editor
      const { from, to } = view.state.selection
      const text = from < to ? view.state.doc.textBetween(from, to) : ''
      onSelectionChange(text)
    }
    const interval = setInterval(handleSelection, 300)

    return () => {
      clearInterval(interval)
      editor.destroy()
      editorRef.current = null
    }
  }, []) // mount once

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '40px 60px',
        background: '#1e1e2e',
        fontFamily: 'inherit',
      }}
    />
  )
}