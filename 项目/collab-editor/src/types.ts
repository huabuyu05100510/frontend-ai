export interface UserInfo {
  id: string
  name: string
  color: string
}

/** 每个在线用户的 Awareness 状态 */
export interface AwarenessState {
  user: UserInfo
  /** 当前光标所在段落的 ProseMirror 起始位置，用于段落活动指示 */
  activeParagraphPos?: number
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'
