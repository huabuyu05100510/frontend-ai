/**
 * Ensemble 词对齐投票器（Route A/B/C 加权融合）
 *
 * 输入：N 路对齐结果，每路含 {name, weight, pairs}
 * 输出：每个 tgtIdx 的最佳 srcIdx + 置信度
 *
 * 设计要点：
 *   - 多数投票 + 置信度加权
 *   - 支持「路线分歧检测」（disagreement count）做可观测
 *   - 当只有单路时退化为直接返回（Phase 2 MVP 支持）
 */

/**
 * @typedef {Object} RouteResult
 * @property {string} name      路线名 'A' | 'B' | 'C'
 * @property {number} weight    权重 [0,1]，所有路线权重应归一化
 * @property {Array<{srcIdx:number, tgtIdx:number, score:number}>} pairs
 */

/**
 * @typedef {Object} EnsemblePair
 * @property {number} tgtIdx
 * @property {number} srcIdx
 * @property {number} score       加权后总分 [0,1]
 * @property {number} agreement   几路投票命中此对（1..N）
 * @property {number} disagreement 此 tgt 各路线 src 不一致的程度
 */

/**
 * @param {RouteResult[]} routes
 * @returns {EnsemblePair[]}
 */
export function ensemble(routes) {
  if (!routes || routes.length === 0) return []
  if (routes.length === 1) {
    // MVP 退化：直接返回单路结果
    return routes[0].pairs.map(p => ({
      tgtIdx: p.tgtIdx,
      srcIdx: p.srcIdx,
      score: p.score,
      agreement: 1,
      disagreement: 0,
    }))
  }

  // 归一化权重
  const totalW = routes.reduce((s, r) => s + r.weight, 0)
  const normW = Object.fromEntries(routes.map(r => [r.name, r.weight / totalW]))

  // 每个 tgtIdx 收集所有候选 srcIdx 的加权投票
  // voteMap: tgtIdx → Map<srcIdx, weightedScore + count>
  const voteMap = new Map()
  // 每个 tgtIdx 路线投票分布（用于 disagreement）
  const tgtRoutes = new Map() // tgtIdx → [{name, srcIdx}]

  for (const r of routes) {
    for (const p of r.pairs) {
      if (!voteMap.has(p.tgtIdx)) voteMap.set(p.tgtIdx, new Map())
      if (!tgtRoutes.has(p.tgtIdx)) tgtRoutes.set(p.tgtIdx, [])
      const m = voteMap.get(p.tgtIdx)
      m.set(p.srcIdx, (m.get(p.srcIdx) || 0) + normW[r.name] * Math.max(0, Math.min(1, p.score)))
      tgtRoutes.get(p.tgtIdx).push({ name: r.name, srcIdx: p.srcIdx })
    }
  }

  // 每个 tgtIdx 选 vote 最高 srcIdx
  const result = []
  for (const [tgtIdx, m] of voteMap) {
    let bestSrc = -1, bestV = -Infinity, bestCount = 0
    for (const [srcIdx, v] of m) {
      if (v > bestV) { bestV = v; bestSrc = srcIdx }
    }
    // agreement：几路投票命中此 (tgtIdx, bestSrc)
    const routesForTgt = tgtRoutes.get(tgtIdx)
    bestCount = routesForTgt.filter(r => r.srcIdx === bestSrc).length

    // disagreement：1 - (命中票数 / 总票数)
    const disagreement = 1 - (bestCount / routesForTgt.length)

    result.push({
      tgtIdx,
      srcIdx: bestSrc,
      score: bestV,
      agreement: bestCount,
      disagreement,
    })
  }

  // 按 tgtIdx 排序
  result.sort((a, b) => a.tgtIdx - b.tgtIdx)
  return result
}

/**
 * Lilt §4.3 span-projector 风格的 sanity check（简化）
 * 检查对齐的「连续性」：相邻 tgt 应指向连续或递增的 src（弱单调假设）
 *
 * 返回 { ok, violations: [{tgtIdx, expectedMin, actual}] }
 */
export function monotonicCheck(alignments) {
  const violations = []
  let prevSrc = -1
  for (const a of alignments) {
    if (a.srcIdx < prevSrc) {
      violations.push({ tgtIdx: a.tgtIdx, expectedMin: prevSrc, actual: a.srcIdx })
    }
    prevSrc = Math.max(prevSrc, a.srcIdx)
  }
  return { ok: violations.length === 0, violations }
}

/**
 * F1 评估器
 * @param {Array<{tgtIdx:number, srcIdx:number}>} predicted
 * @param {Array<{tgtIdx:number, srcIdx:number}>} gold   金标准
 * @returns {{precision, recall, f1, tp, fp, fn}}
 */
export function evaluateF1(predicted, gold) {
  const predSet = new Set(predicted.map(p => `${p.tgtIdx}-${p.srcIdx}`))
  const goldSet = new Set(gold.map(p => `${p.tgtIdx}-${p.srcIdx}`))

  let tp = 0
  for (const k of predSet) if (goldSet.has(k)) tp++
  const fp = predSet.size - tp
  const fn = goldSet.size - tp

  const precision = predSet.size === 0 ? 0 : tp / predSet.size
  const recall = goldSet.size === 0 ? 0 : tp / goldSet.size
  const f1 = (precision + recall) === 0 ? 0 : (2 * precision * recall) / (precision + recall)

  return { precision, recall, f1, tp, fp, fn,
    predCount: predSet.size, goldCount: goldSet.size }
}
