import { Plugin, PluginKey, EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { AnnotationStore } from '../../core/AnnotationStore'
import type { EventBus } from '../../core/EventBus'
import type { Annotation } from '../../core/types'

/** Maps annotation error type to CSS wavy underline class */
const TYPE_WAVY_CLASS: Record<string, string> = {
  'error-spelling':    'wavy-red',
  'error-grammar':     'wavy-orange',
  'error-punctuation': 'wavy-blue',
  'error-number':      'wavy-green',
  'error-political':   'wavy-purple',
}

export const decorationPluginKey = new PluginKey<DecorationSet>('decorationPlugin')

/**
 * Creates a ProseMirror decoration plugin that renders wavy underlines
 * for inspection annotations. Subscribes to EventBus for annotation lifecycle.
 */
export function createDecorationPlugin(store: AnnotationStore, bus: EventBus): Plugin {
  let pluginView: { update: () => void } | null = null

  // Build DecorationSet from current store state
  function buildDecorations(state: EditorState): DecorationSet {
    const annotations = store.getAll()
    const decorations: Decoration[] = []

    for (const ann of annotations) {
      if (ann.position.kind !== 'offset') continue
      if (ann.status === 'accepted') continue

      const { from, to } = ann.position
      const docSize = state.doc.content.size

      // Guard against stale positions
      if (from < 0 || to > docSize || from >= to) continue

      const wavyClass = ann.status === 'ignored'
        ? 'wavy-muted'
        : (TYPE_WAVY_CLASS[ann.type] ?? 'wavy-red')

      decorations.push(
        Decoration.inline(from, to, {
          class: `wavy-underline ${wavyClass}`,
          'data-id': ann.id,
        })
      )
    }

    return DecorationSet.create(state.doc, decorations)
  }

  const plugin: Plugin<DecorationSet> = new Plugin<DecorationSet>({
    key: decorationPluginKey,

    state: {
      init(_, state) {
        return buildDecorations(state)
      },
      apply(tr, _old, _oldState, newState) {
        // Re-compute on every transaction that changes meta flag
        if (tr.getMeta(decorationPluginKey) === 'refresh') {
          return buildDecorations(newState)
        }
        // Map existing decorations through document changes
        return _old.map(tr.mapping, tr.doc)
      },
    },

    props: {
      decorations(state) {
        return this.getState(state)
      },
    },

    view(editorView) {
      pluginView = {
        update() {
          const tr = editorView.state.tr.setMeta(decorationPluginKey, 'refresh')
          editorView.dispatch(tr)
        },
      }

      // Subscribe to annotation lifecycle events
      const unsubs = [
        bus.on('ANNOTATIONS_LOADED', () => pluginView?.update()),
        bus.on('ANNOTATION_ADDED',   () => pluginView?.update()),
        bus.on('ANNOTATION_ACCEPT',  () => pluginView?.update()),
        bus.on('ANNOTATION_IGNORE',  () => pluginView?.update()),
      ]

      return {
        destroy() {
          unsubs.forEach(fn => fn())
          pluginView = null
        },
      }
    },
  })

  return plugin
}

/**
 * Inject global CSS for wavy underline styles.
 * Call once when the inspection scene mounts.
 */
export function injectWavyStyles(): void {
  if (document.getElementById('wavy-underline-styles')) return

  const style = document.createElement('style')
  style.id = 'wavy-underline-styles'
  style.textContent = `
    .wavy-underline {
      position: relative;
      cursor: pointer;
    }
    .wavy-red    { text-decoration: underline wavy #ff4d4f 1.5px; }
    .wavy-orange { text-decoration: underline wavy #fa8c16 1.5px; }
    .wavy-blue   { text-decoration: underline wavy #1890ff 1.5px; }
    .wavy-green  { text-decoration: underline wavy #52c41a 1.5px; }
    .wavy-purple { text-decoration: underline wavy #722ed1 1.5px; }
    .wavy-muted  { text-decoration: underline wavy #ccc 1.5px; }
    .wavy-underline:hover { background: rgba(24,144,255,0.08); border-radius: 2px; }
  `
  document.head.appendChild(style)
}
