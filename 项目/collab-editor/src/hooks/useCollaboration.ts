import { useMemo, useEffect, useState, useCallback, useRef } from 'react'
import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'
import type { UserInfo, AwarenessState, ConnectionStatus } from '../types'

/**
 * 核心协同 Hook
 *
 * 技术亮点：
 * 1. Yjs CRDT — 多人并发编辑无冲突合并，操作可交换结合，天然支持离线
 * 2. y-webrtc — 同浏览器多 Tab 走 BroadcastChannel（零延迟），跨机器走 WebRTC
 * 3. Awareness 协议 — 轻量级用户状态广播（光标位置、在线状态），与文档数据分离
 * 4. 段落活动感知 — 基于 Awareness 的段落级编辑指示，无需额外信道
 */
export function useCollaboration(roomId: string, user: UserInfo) {
  // useMemo 保证 ydoc/provider 在 roomId 变化前引用稳定，避免 TipTap 重复初始化
  const ydoc = useMemo(() => new Y.Doc(), [roomId])

  const provider = useMemo(
    () =>
      new WebrtcProvider(`collab-demo-${roomId}`, ydoc, {
        // 优先 BroadcastChannel（同机器多Tab零延迟），降级到 WebRTC 信令服务器
        signaling: ['wss://signaling.yjs.dev'],
      }),
    [roomId, ydoc]
  )

  const [peers, setPeers] = useState<AwarenessState[]>([])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')

  // 用 ref 持有 peers 最新值，供 ProseMirror 插件（闭包）读取，避免过时闭包
  const peersRef = useRef<AwarenessState[]>([])
  peersRef.current = peers

  useEffect(() => {
    // 注册本地用户信息到 Awareness
    provider.awareness.setLocalState({ user, activeParagraphPos: undefined })

    const syncPeers = () => {
      const states: AwarenessState[] = []
      provider.awareness.getStates().forEach((state, clientId) => {
        if (clientId !== ydoc.clientID && state?.user) {
          states.push(state as AwarenessState)
        }
      })
      setPeers(states)
    }

    const onStatus = ({ status: s }: { status: string }) => {
      setStatus(s === 'connected' ? 'connected' : s === 'disconnected' ? 'disconnected' : 'connecting')
    }

    provider.awareness.on('change', syncPeers)
    provider.on('status', onStatus)

    return () => {
      provider.awareness.off('change', syncPeers)
      provider.off('status', onStatus)
    }
  }, [provider, ydoc, user])

  // 组件卸载时销毁，释放 WebRTC 连接与 Yjs 内存
  useEffect(() => {
    return () => {
      provider.destroy()
      ydoc.destroy()
    }
  }, [provider, ydoc])

  /**
   * 更新当前用户的「活动段落位置」到 Awareness
   * 其他用户收到后渲染段落指示器（不阻止编辑，仅视觉提示）
   */
  const setActiveParagraph = useCallback(
    (pos: number | undefined) => {
      provider.awareness.setLocalStateField('activeParagraphPos', pos)
    },
    [provider]
  )

  return { ydoc, provider, peers, peersRef, status, setActiveParagraph }
}
