import { CollabDoc } from './CollabDoc'
import type { CollabUpdate, CollabSnapshot } from './CollabDoc'

// ============================================================================
// CollabClient — 浏览器侧协同传输（原生 WebSocket）
//   把本地 CollabDoc 的更新发往服务端，并把远端更新/快照合并回本地。
//   handleServerMessage 抽成纯函数以便单测。
// ============================================================================

export type ServerMessage<T = unknown> =
  | { t: 'snapshot'; snapshot: CollabSnapshot<T> }
  | { t: 'op'; update: CollabUpdate<T> }
  | { t: 'awareness'; from: string; state: unknown }

/** 把服务端消息合并进本地文档；返回本地是否需要刷新 */
export function handleServerMessage<T>(doc: CollabDoc<T>, msg: ServerMessage<T>): boolean {
  if (msg.t === 'snapshot') {
    doc.merge(msg.snapshot)
    return true
  }
  if (msg.t === 'op') {
    doc.applyUpdate(msg.update)
    return true
  }
  return false
}

export interface CollabClientOptions {
  url: string
  room: string
  onChange: () => void
  onStatus?: (s: 'connecting' | 'open' | 'closed') => void
}

export class CollabClient<T = unknown> {
  private ws: WebSocket | null = null
  private closedByUser = false

  constructor(
    private doc: CollabDoc<T>,
    private opts: CollabClientOptions,
  ) {}

  connect(): void {
    this.opts.onStatus?.('connecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(this.opts.url)
    } catch {
      this.opts.onStatus?.('closed')
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.opts.onStatus?.('open')
      ws.send(JSON.stringify({ t: 'join', room: this.opts.room }))
    }
    ws.onmessage = (e) => {
      let msg: ServerMessage<T>
      try {
        msg = JSON.parse(e.data as string)
      } catch {
        return
      }
      if (handleServerMessage(this.doc, msg)) this.opts.onChange()
    }
    ws.onclose = () => {
      this.opts.onStatus?.('closed')
      if (!this.closedByUser) setTimeout(() => this.connect(), 1500) // 断线重连
    }
    ws.onerror = () => ws.close()
  }

  /** 广播一条本地更新 */
  send(update: CollabUpdate<T>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: 'op', update }))
    }
  }

  close(): void {
    this.closedByUser = true
    this.ws?.close()
  }
}
