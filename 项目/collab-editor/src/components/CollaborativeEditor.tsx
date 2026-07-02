import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { useEffect, useRef, useState } from 'react'

import { useCollaboration } from '../hooks/useCollaboration'
import { ParagraphActivity } from '../extensions/ParagraphActivity'
import { Toolbar } from './Toolbar'
import { UserPresence } from './UserPresence'
import type { UserInfo } from '../types'

interface CollaborativeEditorProps {
  user: UserInfo
  roomId: string
}

export function CollaborativeEditor({ user, roomId }: CollaborativeEditorProps) {
  const { ydoc, provider, peers, peersRef, status, setActiveParagraph } = useCollaboration(roomId, user)
  const [wordCount, setWordCount] = useState(0)
  const currentParaPos = useRef<number | undefined>(undefined)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 禁用内置 history，由 Yjs 的 UndoManager 接管（支持协同撤销）
        history: false,
      }),
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({
        provider,
        user: { name: user.name, color: user.color },
      }),
      Placeholder.configure({
        placeholder: '开始输入内容，多人实时协同编辑...',
      }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      // 段落活动指示器扩展 — 通过闭包读取 peersRef 获取最新 peers
      ParagraphActivity.configure({
        getPeerStates: () => peersRef.current,
      }),
    ],
    onUpdate({ editor }) {
      // 统计字数
      const text = editor.getText()
      setWordCount(text.replace(/\s/g, '').length)
    },
    onSelectionUpdate({ editor }) {
      /**
       * 检测当前光标所在段落的 ProseMirror 起始位置
       * 通过向上遍历节点层级，找到最近的 paragraph 或 heading 节点
       * 将位置广播到 Awareness，触发其他用户的段落指示器更新
       */
      const { $anchor } = editor.state.selection
      let depth = $anchor.depth
      let newPos: number | undefined

      while (depth > 0) {
        const node = $anchor.node(depth)
        if (node.type.name === 'paragraph' || node.type.name === 'heading') {
          newPos = $anchor.start(depth)
          break
        }
        depth--
      }

      // 仅在段落变化时更新，避免频繁广播
      if (newPos !== currentParaPos.current) {
        currentParaPos.current = newPos
        setActiveParagraph(newPos)
      }
    },
    onBlur() {
      // 失焦时清除活动段落，释放「占用」提示
      currentParaPos.current = undefined
      setActiveParagraph(undefined)
    },
  })

  // 当 peers 的段落位置变化时，触发 Meta Transaction 让 ParagraphActivity 插件重建 DecorationSet
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(
      editor.view.state.tr.setMeta('paragraphActivityUpdate', true)
    )
  }, [editor, peers])

  return (
    <div className="editor-layout">
      <div className="editor-main">
        {/* 文档头部 */}
        <header className="doc-header">
          <div className="doc-title-area">
            <div className="doc-icon">📄</div>
            <input
              className="doc-title"
              defaultValue="未命名文档"
              placeholder="输入文档标题..."
            />
          </div>
          <div className="doc-meta">
            <span className={`conn-indicator conn-${status}`}>
              {status === 'connected' ? '● 协同中' : status === 'connecting' ? '◌ 连接中' : '○ 已断线'}
            </span>
          </div>
        </header>

        {/* 工具栏 */}
        <Toolbar editor={editor} />

        {/* 编辑区 */}
        <div className="editor-scroll">
          <div className="editor-page">
            <EditorContent editor={editor} className="editor-content" />
          </div>
        </div>

        {/* 状态栏 */}
        <footer className="editor-footer">
          <span>{wordCount} 字</span>
          <span>{peers.length + 1} 人在线</span>
          <span className="footer-hint">⌘Z 撤销 · ⌘⇧Z 重做（协同感知）</span>
        </footer>
      </div>

      {/* 右侧在线用户面板 */}
      <UserPresence
        currentUser={user}
        peers={peers}
        status={status}
        roomId={roomId}
      />
    </div>
  )
}
