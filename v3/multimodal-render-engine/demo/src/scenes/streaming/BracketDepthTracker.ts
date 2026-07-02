/**
 * BracketDepthTracker — Generative UI 核心算法
 *
 * Function Calling 的 arguments 字段以 JSON 字符串形式按 chunk 分片到达，
 * 不能直接 JSON.parse（中间态非法 JSON）。
 *
 * 通过括号深度计数（O(n) 逐字符扫描）判断 JSON 是否合法闭合：
 *   '{' → depth++
 *   '}' → depth--，depth===0 时闭合完成
 *
 * 特殊处理：字符串内的 '{' / '}' 不计入深度（状态机跟踪引号状态）
 */

export interface TrackerState {
  depth: number
  buf: string
  complete: boolean
  /** 当前是否在字符串字面量内 */
  _inString: boolean
  /** 上一个字符是否是转义符 */
  _escaped: boolean
}

export function createTrackerState(): TrackerState {
  return { depth: 0, buf: '', complete: false, _inString: false, _escaped: false }
}

/**
 * 追加一个 chunk，更新 state，返回 state 引用（方便链式）
 */
export function trackBracketDepth(chunk: string, state: TrackerState): TrackerState {
  if (!chunk || state.complete) return state

  for (const ch of chunk) {
    state.buf += ch

    if (state._escaped) {
      state._escaped = false
      continue
    }

    if (ch === '\\' && state._inString) {
      state._escaped = true
      continue
    }

    if (ch === '"') {
      state._inString = !state._inString
      continue
    }

    if (state._inString) continue   // 字符串内的括号不计

    if (ch === '{') {
      state.depth++
    } else if (ch === '}') {
      state.depth--
      if (state.depth === 0) {
        state.complete = true
        break
      }
    }
  }

  return state
}
