/**
 * SimAlign 算法实现（Route A：无监督 embedding 词对齐）
 *
 * 参考：Sousa & Ribeiro, "SimAlign: High Quality Word Alignments Without Parallel Training Data
 *      Using Static and Contextualised Embeddings" (EMNLP 2020 Findings)
 *      https://aclanthology.org/2020.findings-emnlp.147.pdf
 *
 * 输入：相似度矩阵 sim[src_len][tgt_len]（cosine ≥ 0，越大越相似）
 * 输出：对齐对 [{ srcIdx, tgtIdx, score }]
 *
 * 三件套（论文原版）：
 *   1. argmax   — 双向 argmax 并集
 *   2. itermax  — Sinkhorn-style 迭代提取
 *   3. intersect / union 策略
 *
 * 纯函数，零依赖，便于 TDD。
 */

/** 双向 argmax 并集 */
export function argmax(sim) {
  const srcLen = sim.length
  if (srcLen === 0) return []
  const tgtLen = sim[0].length
  const pairs = new Map() // `${i}-${j}` → score

  // forward: 每个 src 行 argmax over tgt
  for (let i = 0; i < srcLen; i++) {
    let bestJ = 0, bestV = sim[i][0]
    for (let j = 1; j < tgtLen; j++) {
      if (sim[i][j] > bestV) { bestV = sim[i][j]; bestJ = j }
    }
    pairs.set(`${i}-${bestJ}`, bestV)
  }
  // reverse: 每个 tgt 列 argmax over src
  for (let j = 0; j < tgtLen; j++) {
    let bestI = 0, bestV = sim[0][j]
    for (let i = 1; i < srcLen; i++) {
      if (sim[i][j] > bestV) { bestV = sim[i][j]; bestI = i }
    }
    pairs.set(`${bestI}-${j}`, Math.max(pairs.get(`${bestI}-${j}`) ?? -Infinity, bestV))
  }

  return [...pairs.entries()].map(([k, score]) => {
    const [srcIdx, tgtIdx] = k.split('-').map(Number)
    return { srcIdx, tgtIdx, score }
  })
}

/**
 * itermax：Sinkhorn-style 迭代
 *
 * 论文算法（伪代码）：
 *   while sim 非空:
 *     双向 argmax → 取高的一侧 → 加入对齐
 *     从 sim 中移除对应行/列
 *
 * 这里用「逐步消解」实现：每轮找全局 max，记录后把该行该列置 -Infinity，
 * 但保留双向 argmax 的 union 特性。
 */
export function itermax(sim) {
  const srcLen = sim.length
  if (srcLen === 0) return []
  const tgtLen = sim[0].length
  // 工作副本
  const work = sim.map(row => row.slice())
  const pairs = []

  const remaining = Math.min(srcLen, tgtLen)
  for (let n = 0; n < remaining; n++) {
    // 双向 argmax
    const rowMax = new Array(srcLen).fill(-Infinity)
    const colMax = new Array(tgtLen).fill(-Infinity)
    const rowArg = new Array(srcLen).fill(-1)
    const colArg = new Array(tgtLen).fill(-1)

    for (let i = 0; i < srcLen; i++) {
      for (let j = 0; j < tgtLen; j++) {
        const v = work[i][j]
        if (v > rowMax[i]) { rowMax[i] = v; rowArg[i] = j }
        if (v > colMax[j]) { colMax[j] = v; colArg[j] = i }
      }
    }

    // 取所有双向 argmax 命中的 (i,j)（即 rowArg[i]==j && colArg[j]==i）
    let best = null
    for (let i = 0; i < srcLen; i++) {
      const j = rowArg[i]
      if (j >= 0 && colArg[j] === i) {
        if (!best || work[i][j] > best.v) best = { i, j, v: work[i][j] }
      }
    }

    if (!best) {
      // 退化为全局 max
      let gv = -Infinity, gi = -1, gj = -1
      for (let i = 0; i < srcLen; i++) {
        for (let j = 0; j < tgtLen; j++) {
          if (work[i][j] > gv) { gv = work[i][j]; gi = i; gj = j }
        }
      }
      if (gi < 0) break
      best = { i: gi, j: gj, v: gv }
    }

    pairs.push({ srcIdx: best.i, tgtIdx: best.j, score: best.v })
    // 置该行该列 -Inf
    for (let j = 0; j < tgtLen; j++) work[best.i][j] = -Infinity
    for (let i = 0; i < srcLen; i++) work[i][best.j] = -Infinity
  }
  return pairs
}

/** grow_diag_final：从种子对齐 grow，参考 IBM Model 4 启发（论文 match 算法） */
export function growDiag(sim, seed) {
  const srcLen = sim.length
  if (srcLen === 0) return seed
  const tgtLen = sim[0].length

  const aligned = new Set(seed.map(p => `${p.srcIdx}-${p.tgtIdx}`))
  const srcTaken = new Set()
  const tgtTaken = new Set()
  for (const p of seed) {
    srcTaken.add(p.srcIdx)
    tgtTaken.add(p.tgtIdx)
  }

  // 8 邻域
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]

  let grew = true
  while (grew) {
    grew = false
    for (const p of [...aligned].map(s => s.split('-').map(Number))) {
      for (const [di, dj] of dirs) {
        const ni = p[0] + di
        const nj = p[1] + dj
        if (ni < 0 || ni >= srcLen || nj < 0 || nj >= tgtLen) continue
        if (aligned.has(`${ni}-${nj}`)) continue
        if (srcTaken.has(ni) && tgtTaken.has(nj)) continue
        // 邻居必须两侧都未对齐 OR 一侧未对齐
        if (!srcTaken.has(ni) || !tgtTaken.has(nj)) {
          if (!srcTaken.has(ni) && !tgtTaken.has(nj)) {
            aligned.add(`${ni}-${nj}`)
            srcTaken.add(ni)
            tgtTaken.add(nj)
            grew = true
          }
        }
      }
    }
  }

  // final：未对齐的 src/tgt 单独 argmax
  for (let i = 0; i < srcLen; i++) {
    if (srcTaken.has(i)) continue
    let bestJ = -1, bestV = -Infinity
    for (let j = 0; j < tgtLen; j++) {
      if (tgtTaken.has(j)) continue
      if (sim[i][j] > bestV) { bestV = sim[i][j]; bestJ = j }
    }
    if (bestJ >= 0) {
      aligned.add(`${i}-${bestJ}`)
      srcTaken.add(i)
      tgtTaken.add(bestJ)
    }
  }

  return [...aligned].map(s => {
    const [srcIdx, tgtIdx] = s.split('-').map(Number)
    return { srcIdx, tgtIdx, score: sim[srcIdx][tgtIdx] }
  })
}

/**
 * 完整 SimAlign
 * @param {number[][]} sim  [src_len][tgt_len] cosine 相似度
 * @param {Object} opts
 * @param {'argmax'|'intersect'|'union'|'grow_diag'} opts.strategy  默认 'argmax'（zh-en 多对一最稳）
 *
 * 实测（benchmark/strategy-compare.mjs，8 cases LaBSE）：
 *   argmax     F1=0.841 P=0.781 R=0.920  ← 默认（双向并集，自然多对一）
 *   union      F1=0.829 P=0.755 R=0.940
 *   intersect  F1=0.655 P=0.803 R=0.571  ← 一对一限制，丢多对一
 *   grow_diag  F1=0.629 P=0.726 R=0.571  ← 论文默认但 zh-en 不友好
 */
export function simAlign(sim, opts = {}) {
  const strategy = opts.strategy ?? 'argmax'
  const a = argmax(sim)
  const b = itermax(sim)

  if (strategy === 'union') {
    const map = new Map()
    for (const p of [...a, ...b]) {
      const k = `${p.srcIdx}-${p.tgtIdx}`
      if (!map.has(k) || map.get(k).score < p.score) map.set(k, p)
    }
    return [...map.values()]
  }
  if (strategy === 'argmax') {
    // 双向 argmax 并集（去重保留高分）— zh-en 多对一最稳
    const map = new Map()
    for (const p of a) {
      const k = `${p.srcIdx}-${p.tgtIdx}`
      if (!map.has(k) || map.get(k).score < p.score) map.set(k, p)
    }
    return [...map.values()]
  }
  if (strategy === 'intersect') {
    const setB = new Set(b.map(p => `${p.srcIdx}-${p.tgtIdx}`))
    return a.filter(p => setB.has(`${p.srcIdx}-${p.tgtIdx}`))
  }
  // grow_diag：从 intersect 种子 grow
  const seed = (() => {
    const setB = new Set(b.map(p => `${p.srcIdx}-${p.tgtIdx}`))
    return a.filter(p => setB.has(`${p.srcIdx}-${p.tgtIdx}`))
  })()
  return growDiag(sim, seed)
}

/** 工具：两个向量的 cosine 相似度 */
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / Math.sqrt(na * nb)
}

/** 工具：从 token embeddings 构相似度矩阵 */
export function buildSimMatrix(srcEmb, tgtEmb) {
  return srcEmb.map(s => tgtEmb.map(t => cosine(s, t)))
}
