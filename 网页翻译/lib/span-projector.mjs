/**
 * span-projector — Lilt §4.3 算法（对标 tech-plan §2.2）
 *
 * 复现 Lilt 论文核心：在 LLM 时代没有 attention 的情况下，
 * 用「嵌入对齐 + span-scoring」推断 inline 标签在译文中的最优投影位置。
 *
 * 算法核心：
 *   对每个 src tag (openToken..closeToken)，
 *   枚举 tgt 中所有可能 span (open..close)，
 *   评分 = in_span + out_span
 *     in_span:  src 在 tag 内 AND tgt 在 span 内  → 贡献 align[t][s]
 *     out_span: src 在 tag 外 AND tgt 在 span 外 → 贡献 align[t][s]
 *   取评分最高的 span
 *
 * 优化：prefix sum 把枚举从 O(tgtLen² × tgtLen × srcLen) 降到 O(tgtLen² × srcLen)
 *
 * 后续会替换 computeAlignment 为 multilingual-e5-small ONNX 推理
 */

const EPS = 1e-9  // 避免归一化除零

/**
 * 把单个 src tag 投影到 tgt 上
 * @param {{id: string, openToken: number, closeToken: number}} tag
 * @param {number[][]} align align[t][s] ∈ [0,1]，行已 softmax 归一化
 * @param {number} srcLen
 * @param {number} tgtLen
 * @returns {{tagId: string, open: number, close: number, score: number}}
 */
export function projectTag(tag, align, srcLen, tgtLen) {
  if (tgtLen === 0) {
    return { tagId: tag.id, open: 0, close: 0, score: 0 }
  }

  // Step 1: 预计算每个 tgt 位置的 in/out 分数
  const inScore = new Float64Array(tgtLen)
  const outScore = new Float64Array(tgtLen)
  let totalIn = 0
  let totalOut = 0

  for (let t = 0; t < tgtLen; t++) {
    for (let s = 0; s < srcLen; s++) {
      const p = align[t][s] || 0
      const srcIn = s >= tag.openToken && s < tag.closeToken
      if (srcIn) {
        inScore[t] += p
        totalIn += p
      } else {
        outScore[t] += p
        totalOut += p
      }
    }
  }

  // Step 2: 构造前缀和，O(1) 取任意区间和
  const inPrefix = new Float64Array(tgtLen + 1)
  const outPrefix = new Float64Array(tgtLen + 1)
  for (let t = 0; t < tgtLen; t++) {
    inPrefix[t + 1] = inPrefix[t] + inScore[t]
    outPrefix[t + 1] = outPrefix[t] + outScore[t]
  }

  // Step 3: 枚举所有 (open, close)，取 in + totalOut - outInWindow 最大
  let bestOpen = 0
  let bestClose = 0
  let bestScore = -Infinity

  for (let open = 0; open <= tgtLen; open++) {
    for (let close = open; close <= tgtLen; close++) {
      const inSpan = inPrefix[close] - inPrefix[open]
      const outSpan = totalOut - (outPrefix[close] - outPrefix[open])
      const score = inSpan + outSpan
      if (score > bestScore) {
        bestScore = score
        bestOpen = open
        bestClose = close
      }
    }
  }

  return { tagId: tag.id, open: bestOpen, close: bestClose, score: bestScore }
}

/**
 * 批量投影所有 tag
 * @param {Array<{id, openToken, closeToken}>} tags
 * @param {number[][]} align
 * @param {number} srcLen
 * @param {number} tgtLen
 */
export function projectAll(tags, align, srcLen, tgtLen) {
  return tags.map(t => projectTag(t, align, srcLen, tgtLen))
}

/**
 * 简单 token 对齐 —— 字符重叠 + 行 softmax 归一化
 *
 * ⚠️ 这是占位实现，生产应替换为 multilingual-e5-small ONNX 推理
 * 见 tech-plan §2.4
 *
 * @param {string[]} srcTokens
 * @param {string[]} tgtTokens
 * @returns {number[][]} align[t][s]，每行 sum=1
 */
export function computeAlignment(srcTokens, tgtTokens) {
  if (srcTokens.length === 0 || tgtTokens.length === 0) return []
  const align = []
  for (let t = 0; t < tgtTokens.length; t++) {
    const row = srcTokens.map(s => Math.max(tokenSimilarity(s, tgtTokens[t]), EPS))
    const sum = row.reduce((a, b) => a + b, 0)
    if (sum > 0) for (let i = 0; i < row.length; i++) row[i] /= sum
    align.push(row)
  }
  return align
}

function tokenSimilarity(a, b) {
  if (!a || !b) return 0
  if (a === b) return 1
  const setA = new Set(a.toLowerCase())
  const setB = new Set(b.toLowerCase())
  let inter = 0
  for (const c of setA) if (setB.has(c)) inter++
  if (inter === 0) return 0
  return inter / Math.max(setA.size, setB.size, 1)
}