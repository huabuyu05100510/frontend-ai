import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { CollabUser } from '../../core/types'

const KEY = new PluginKey<CollabUser[]>('collab-cursors')

/**
 * Renders remote collaborators' cursors as colored decorations.
 * Stores user list in plugin state, updated via setMeta.
 */
export function collabCursorPlugin() {
  return new Plugin<CollabUser[]>({
    key: KEY,

    state: {
      init(): CollabUser[] {
        return []
      },
      apply(tr, value): CollabUser[] {
        const meta = tr.getMeta(KEY)
        return meta ?? value
      },
    },

    props: {
      decorations(state) {
        const users = KEY.getState(state)
        if (!users || users.length === 0) return DecorationSet.empty

        const decorations: Decoration[] = []
        for (const user of users) {
          if (!user.cursor) continue

          // Find the block and offset position
          let pos = 0
          state.doc.descendants((node, offset) => {
            if (node.attrs?.id === user.cursor!.blockId) {
              pos = offset + Math.min(user.cursor!.offset, node.textContent.length)
              return false
            }
            return true
          })

          if (pos > 0) {
            // Cursor label
            const label = Decoration.widget(pos, () => {
              const el = document.createElement('span')
              el.className = 'collab-cursor'
              el.style.cssText = `
                position: absolute;
                border-left: 2px solid ${user.color};
                height: 1.2em;
                margin-left: 0;
              `
              const label = document.createElement('span')
              label.className = 'collab-cursor-label'
              label.style.cssText = `
                position: absolute;
                top: -1.2em;
                left: 0;
                background: ${user.color};
                color: #fff;
                font-size: 10px;
                padding: 1px 4px;
                border-radius: 3px;
                white-space: nowrap;
              `
              label.textContent = user.name
              el.appendChild(label)
              return el
            })
            decorations.push(label)
          }

          if (user.selection) {
            // Highlight selection range
            const deco = Decoration.inline(
              pos,
              pos + 5, // simplified: decorate a small range
              { style: `background: ${user.color}33; border-radius: 2px;` }
            )
            decorations.push(deco)
          }
        }

        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}

export { KEY as collabCursorKey }