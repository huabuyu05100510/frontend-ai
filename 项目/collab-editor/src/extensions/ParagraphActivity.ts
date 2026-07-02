import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { AwarenessState } from '../types'

const PLUGIN_KEY = new PluginKey<DecorationSet>('paragraphActivity')

/**
 * 段落活动指示器 — 企业翻译协同场景的核心 UX
 *
 * 实现原理：
 * 1. 每个用户通过 Awareness 广播自己当前所在段落的 ProseMirror 起始位置
 * 2. 本扩展监听 Awareness 变更，触发 Meta Transaction 让 Plugin 重建 DecorationSet
 * 3. ProseMirror 的 Decoration.node() 为目标段落添加视觉样式（左侧彩色边框 + 背景色）
 * 4. 防止「译员重复翻译同一段」的协同场景问题
 *
 * 相比直接操作 DOM：ProseMirror Decoration 与文档状态同步，
 * 内容变更时自动跟随节点位置，不会出现位置偏移。
 */
export const ParagraphActivity = Extension.create<{
  getPeerStates: () => AwarenessState[]
}>({
  name: 'paragraphActivity',

  addProseMirrorPlugins() {
    const { getPeerStates } = this.options

    return [
      new Plugin({
        key: PLUGIN_KEY,

        state: {
          init: () => DecorationSet.empty,

          apply(tr, set, _, newState) {
            // 仅在 awareness 变更或文档变更时重建，避免每个 transaction 都全量重算
            if (!tr.getMeta('paragraphActivityUpdate') && !tr.docChanged) {
              return set.map(tr.mapping, tr.doc)
            }

            const peers = getPeerStates()
            // pos -> user: 多用户可能在同一段落，取第一个（实际可叠加展示）
            const activePosMap = new Map<number, AwarenessState>()
            peers.forEach(peer => {
              if (peer.activeParagraphPos !== undefined) {
                activePosMap.set(peer.activeParagraphPos, peer)
              }
            })

            if (activePosMap.size === 0) return DecorationSet.empty

            const decorations: Decoration[] = []
            newState.doc.descendants((node, pos) => {
              if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return
              const peer = activePosMap.get(pos)
              if (!peer) return

              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  class: 'paragraph-active',
                  // 动态注入用户颜色，体现「谁在编辑哪段」
                  style: `
                    border-left: 3px solid ${peer.user.color};
                    padding-left: 10px;
                    background: ${peer.user.color}18;
                    border-radius: 0 4px 4px 0;
                    transition: background 0.2s;
                  `.trim(),
                  'data-active-user': peer.user.name,
                })
              )
            })

            return DecorationSet.create(newState.doc, decorations)
          },
        },

        props: {
          decorations: state => PLUGIN_KEY.getState(state),
        },
      }),
    ]
  },
})
