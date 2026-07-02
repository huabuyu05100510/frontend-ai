import type { Editor } from '@tiptap/react'

interface ToolbarProps {
  editor: Editor | null
}

interface ToolbarButton {
  label: string
  title: string
  action: () => void
  isActive: () => boolean
}

export function Toolbar({ editor }: ToolbarProps) {
  if (!editor) return null

  const groups: ToolbarButton[][] = [
    [
      {
        label: 'H1',
        title: '标题 1',
        action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        isActive: () => editor.isActive('heading', { level: 1 }),
      },
      {
        label: 'H2',
        title: '标题 2',
        action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        isActive: () => editor.isActive('heading', { level: 2 }),
      },
      {
        label: 'H3',
        title: '标题 3',
        action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        isActive: () => editor.isActive('heading', { level: 3 }),
      },
    ],
    [
      {
        label: 'B',
        title: '粗体 (⌘B)',
        action: () => editor.chain().focus().toggleBold().run(),
        isActive: () => editor.isActive('bold'),
      },
      {
        label: 'I',
        title: '斜体 (⌘I)',
        action: () => editor.chain().focus().toggleItalic().run(),
        isActive: () => editor.isActive('italic'),
      },
      {
        label: 'U',
        title: '下划线 (⌘U)',
        action: () => editor.chain().focus().toggleUnderline().run(),
        isActive: () => editor.isActive('underline'),
      },
      {
        label: 'S',
        title: '删除线',
        action: () => editor.chain().focus().toggleStrike().run(),
        isActive: () => editor.isActive('strike'),
      },
    ],
    [
      {
        label: '≡',
        title: '无序列表',
        action: () => editor.chain().focus().toggleBulletList().run(),
        isActive: () => editor.isActive('bulletList'),
      },
      {
        label: '№',
        title: '有序列表',
        action: () => editor.chain().focus().toggleOrderedList().run(),
        isActive: () => editor.isActive('orderedList'),
      },
      {
        label: '❝',
        title: '引用块',
        action: () => editor.chain().focus().toggleBlockquote().run(),
        isActive: () => editor.isActive('blockquote'),
      },
      {
        label: '</>',
        title: '代码块',
        action: () => editor.chain().focus().toggleCodeBlock().run(),
        isActive: () => editor.isActive('codeBlock'),
      },
    ],
    [
      {
        label: '←',
        title: '左对齐',
        action: () => editor.chain().focus().setTextAlign('left').run(),
        isActive: () => editor.isActive({ textAlign: 'left' }),
      },
      {
        label: '↔',
        title: '居中',
        action: () => editor.chain().focus().setTextAlign('center').run(),
        isActive: () => editor.isActive({ textAlign: 'center' }),
      },
      {
        label: '→',
        title: '右对齐',
        action: () => editor.chain().focus().setTextAlign('right').run(),
        isActive: () => editor.isActive({ textAlign: 'right' }),
      },
    ],
    [
      {
        label: '↩',
        title: '撤销 (⌘Z)',
        action: () => editor.chain().focus().undo().run(),
        isActive: () => false,
      },
      {
        label: '↪',
        title: '重做 (⌘⇧Z)',
        action: () => editor.chain().focus().redo().run(),
        isActive: () => false,
      },
    ],
  ]

  return (
    <div className="toolbar">
      {groups.map((group, i) => (
        <div key={i} className="toolbar-group">
          {group.map(btn => (
            <button
              key={btn.label}
              title={btn.title}
              className={`toolbar-btn ${btn.isActive() ? 'active' : ''}`}
              onMouseDown={e => {
                e.preventDefault() // 防止编辑器失焦
                btn.action()
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
