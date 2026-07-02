// ============================================================================
// textLayerPlan — PDF 文字层调度决策（纯函数）
//   把 scheduleTextLayer 的"是否继续"判断从 PdfViewer.tsx 抽出，
//   便于：1) 单测覆盖；2) 复用；3) 与 scheduleIdleTask 解耦。
//
// 决策顺序（短路）：
//   cancelled  → 放弃（页面 unmount 或 visibility 变 false）
//   !hasDiv    → 放弃（DOM 已被清空，无法挂载文字层）
//   !hasPage   → 放弃（bitmap 命中但 LRU 已淘汰 page，无法取 textContent）
//   其余       → 继续
// ============================================================================

export interface TextLayerPlanInput {
  cancelled: boolean
  hasDiv: boolean
  /** 能否拿到 PDFPageProxy（LRU 命中或刚 getPage） */
  hasPage: boolean
}

export interface TextLayerPlan {
  proceed: boolean
  reason?: 'cancelled' | 'no-div' | 'no-page'
}

export function planTextLayer(input: TextLayerPlanInput): TextLayerPlan {
  if (input.cancelled) return { proceed: false, reason: 'cancelled' }
  if (!input.hasDiv) return { proceed: false, reason: 'no-div' }
  if (!input.hasPage) return { proceed: false, reason: 'no-page' }
  return { proceed: true }
}
