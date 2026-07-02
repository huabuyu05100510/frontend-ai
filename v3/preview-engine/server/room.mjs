// ============================================================================
// room — 房间内的 LWW-Map 权威状态（与客户端 CollabDoc 决胜规则一致）
//   决胜：Lamport 时钟大者胜；平局按 clientId 字典序大者胜。
//   服务端维护合并态，用于：① 新成员加入时下发快照 ② 仅在状态真正改变时广播。
// ============================================================================

export function createRoom() {
  return { state: new Map() } // key -> { value, ts, client, deleted }
}

function wins(incoming, current) {
  if (!current) return true
  if (incoming.ts !== current.ts) return incoming.ts > current.ts
  return incoming.client > current.client
}

/** 合并单条更新；返回是否改变了状态（用于决定是否广播） */
export function applyUpdate(room, update) {
  const { key, value, ts, client, deleted } = update
  const entry = { value, ts, client, deleted: !!deleted }
  const current = room.state.get(key)
  if (wins(entry, current)) {
    room.state.set(key, entry)
    return true
  }
  return false
}

/** 全量快照（含墓碑），用于新成员同步 */
export function snapshot(room) {
  const out = {}
  for (const [k, e] of room.state) out[k] = e
  return out
}
