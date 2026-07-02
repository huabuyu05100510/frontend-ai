import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { history } from 'prosemirror-history'
import { schema } from './schema'
import { buildInputRules } from './inputRules'
import type { AIEngine } from '../ai/AIEngine'
import { aiSuggestionPlugin } from './plugins/AISuggestionPlugin'
import { collabCursorPlugin } from './plugins/CollabCursorPlugin'
import type { CollabUser } from '../core/types'

export interface EditorConfig {
  container: HTMLElement
  initialContent?: string
  aiEngine?: AIEngine
  collabUsers?: CollabUser[]
  onDocChange?: (doc: string) => void
}

export class EditorCore {
  view: EditorView
  private plugins: ReturnType<typeof aiSuggestionPlugin>[] = []

  constructor(config: EditorConfig) {
    const pluginList: ReturnType<typeof keymap | typeof history | typeof aiSuggestionPlugin | typeof collabCursorPlugin>[] = [
      history(),
      keymap(baseKeymap),
      buildInputRules(),
      collabCursorPlugin(),
      keymap({
        'Mod-b': () => this.toggleMark('bold'),
        'Mod-i': () => this.toggleMark('italic'),
        'Mod-u': () => this.toggleMark('underline'),
        'Mod-k': () => {
          const href = prompt('输入链接地址:')
          if (href) {
            this.view.dispatch(this.view.state.tr.addMark(
              this.view.state.selection.from,
              this.view.state.selection.to,
              schema.marks.link.create({ href })
            ))
          }
          return true
        },
      }),
    ]

    if (config.aiEngine) {
      pluginList.push(aiSuggestionPlugin(config.aiEngine))
    }

    const state = EditorState.create({
      schema,
      doc: config.initialContent
        ? schema.nodeFromJSON(JSON.parse(config.initialContent))
        : undefined,
      plugins: pluginList as any,
    })

    this.view = new EditorView(config.container, {
      state,
      dispatchTransaction: (tr) => {
        const newState = this.view.state.apply(tr)
        this.view.updateState(newState)
        if (tr.docChanged) {
          config.onDocChange?.(JSON.stringify(newState.doc.toJSON()))
        }
      },
    })
  }

  toggleMark(markName: string): boolean {
    const mark = schema.marks[markName]
    if (!mark) return false
    const { from, to } = this.view.state.selection
    if (from === to) return false
    const hasMark = this.view.state.doc.rangeHasMark(from, to, mark)
    const tr = hasMark
      ? this.view.state.tr.removeMark(from, to, mark)
      : this.view.state.tr.addMark(from, to, mark.create())
    this.view.dispatch(tr)
    return true
  }

  getContent(): string {
    return JSON.stringify(this.view.state.doc.toJSON())
  }

  setContent(content: string): void {
    const doc = schema.nodeFromJSON(JSON.parse(content))
    const tr = this.view.state.tr.replaceWith(0, this.view.state.doc.content.size, doc.content)
    this.view.dispatch(tr)
  }

  focus(): void {
    this.view.focus()
  }

  destroy(): void {
    this.view.destroy()
  }
}