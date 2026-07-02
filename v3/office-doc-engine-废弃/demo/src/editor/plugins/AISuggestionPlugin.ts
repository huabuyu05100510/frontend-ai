import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import { AIEngine } from '../../ai/AIEngine'

// ── Plugin state ──────────────────────────────────────────────────────────────

interface AISuggestionState {
  /** Current ghost text displayed at cursor */
  ghostText: string | null
  /** Whether AI is currently generating */
  isGenerating: boolean
  /** Abort controller for the current stream */
  controller: AbortController | null
}

const PLUGIN_KEY = new PluginKey<AISuggestionState>('ai-suggestion')

// ── Constants ─────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 800
const MIN_CONTEXT_LENGTH = 10

// ── Plugin ────────────────────────────────────────────────────────────────────

export function aiSuggestionPlugin(aiEngine: AIEngine) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let currentController: AbortController | null = null

  return new Plugin<AISuggestionState>({
    key: PLUGIN_KEY,

    state: {
      init(): AISuggestionState {
        return { ghostText: null, isGenerating: false, controller: null }
      },
      apply(tr, value): AISuggestionState {
        // Reset on any user edit
        if (tr.docChanged) {
          // Cancel any active generation
          return { ghostText: null, isGenerating: false, controller: null }
        }
        const meta = tr.getMeta(PLUGIN_KEY)
        if (meta) return { ...value, ...meta }
        return value
      },
    },

    view(editorView: EditorView) {
      return {
        update(view: EditorView, prevState: EditorState) {
          const { state } = view
          if (state.doc === prevState.doc) return

          // Cancel previous
          if (debounceTimer) clearTimeout(debounceTimer)
          if (currentController) {
            currentController.abort()
            currentController = null
          }

          // Get text around cursor
          const { $head } = state.selection
          const cursorPos = $head.pos
          const before = $head.parent.textContent.slice(0, $head.parentOffset)
          const after = $head.parent.textContent.slice($head.parentOffset)

          // Only trigger if user has typed enough
          if (before.trim().length < MIN_CONTEXT_LENGTH) return

          // Debounce
          debounceTimer = setTimeout(async () => {
            const controller = new AbortController()
            currentController = controller

            const dispatch = view.dispatch.bind(view)
            dispatch(
              view.state.tr.setMeta(PLUGIN_KEY, { isGenerating: true, controller })
            )

            try {
              const tokens: string[] = []
              const gen = aiEngine.stream(
                {
                  command: 'continue',
                  selectedText: '',
                  context: before.slice(-100),
                },
                controller.signal
              )

              for await (const token of gen) {
                if (controller.signal.aborted) break
                tokens.push(token)
                // Update ghost text incrementally
                const ghost = tokens.join('')
                dispatch(
                  view.state.tr.setMeta(PLUGIN_KEY, { ghostText: ghost, isGenerating: true, controller })
                )
              }

              if (!controller.signal.aborted) {
                dispatch(
                  view.state.tr.setMeta(PLUGIN_KEY, { ghostText: tokens.join(''), isGenerating: false, controller })
                )
              }
            } catch {
              // Stream cancelled or error — ignore
            } finally {
              if (currentController === controller) {
                currentController = null
              }
            }
          }, DEBOUNCE_MS)
        },
        destroy() {
          if (debounceTimer) clearTimeout(debounceTimer)
          if (currentController) currentController.abort()
        },
      }
    },

    props: {
      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        const state = PLUGIN_KEY.getState(view.state)
        if (!state?.ghostText) return false

        if (event.key === 'Tab') {
          event.preventDefault()
          const { $head } = view.state.selection
          view.dispatch(
            view.state.tr
              .insertText(state.ghostText, $head.pos)
              .setMeta(PLUGIN_KEY, { ghostText: null, isGenerating: false, controller: null })
              .addMark(
                $head.pos,
                $head.pos + state.ghostText.length,
                view.state.schema.marks.ai_generated.create()
              )
          )
          return true
        }

        if (event.key === 'Escape') {
          event.preventDefault()
          view.dispatch(
            view.state.tr.setMeta(PLUGIN_KEY, { ghostText: null, isGenerating: false, controller: null })
          )
          return true
        }

        return false
      },

      decorations(state: EditorState): DecorationSet {
        const aiState = PLUGIN_KEY.getState(state)
        if (!aiState?.ghostText) return DecorationSet.empty

        const { $head } = state.selection
        const decorations: Decoration[] = []

        const ghostDecoration = Decoration.widget($head.pos, () => {
          const span = document.createElement('span')
          span.className = 'ai-ghost-text'
          span.textContent = aiState.ghostText
          span.title = '按 Tab 接受 · Esc 拒绝'
          return span
        }, { side: 1 })

        decorations.push(ghostDecoration)
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}