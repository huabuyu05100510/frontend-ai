/**
 * Route C: MarianMT cross-attention 词对齐
 *
 * 核心思路：MarianMT decoder 最后一层 cross-attention 矩阵 [tgt_len, src_len]
 * 就是「生成每个 tgt token 时模型看哪个 src token」——天然对齐信号。
 *
 * 与 Route A (LaBSE embedding cosine) 区别：
 *   Route A sim = 语义空间距离（弱信号）
 *   Route C sim = NMT 模型自己的对齐决策（强信号，对标百度）
 *
 * 算法层复用 lib/labse-simalign.mjs 的 simAlign（argmax 双向并集）
 *
 * 输入：crossAttn[tgt_len][src_len]（已多头平均、最后一层）
 *       来自 spike/phase3/export_crossattn.py
 */

import { simAlign, argmax } from './labse-simalign.mjs'

/**
 * attention 专用对齐：单向 argmax + 阈值
 *
 * 为什么不复用 simAlign 的双向 argmax 并集：
 * - embedding cosine 是对称弱信号，需要双向确认
 * - cross-attn 已 softmax（每行和=1），本身就是「tgt 对 src 的硬决策」
 * - 双向并集在长句会过度生成（Case 1 产 16 对，金标准 10）
 *
 * 算法：
 *   1. forward: 每个 tgt 行 argmax over src（decoder 真实对齐决策）
 *   2. threshold: 仅保留 attn > threshold 的对（默认 0.3）
 *   3. （可选）reverse 兜底：未命中的 src 用列 argmax 补，仍要过阈值
 *
 * 实测阈值：avg max attn = 0.873，0.3 能滤掉 <unk>/pad/虚对
 */
export function attnAlign(crossAttn, { threshold = 0.3, reverse = true } = {}) {
  const tgtLen = crossAttn.length
  if (tgtLen === 0) return []
  const srcLen = crossAttn[0].length
  const pairs = new Map()

  // forward: 每 tgt 行 argmax
  for (let t = 0; t < tgtLen; t++) {
    let bestS = 0, bestV = crossAttn[t][0]
    for (let s = 1; s < srcLen; s++) {
      if (crossAttn[t][s] > bestV) { bestV = crossAttn[t][s]; bestS = s }
    }
    if (bestV >= threshold) pairs.set(`${bestS}-${t}`, bestV)
  }

  // reverse 兜底：未对齐的 src 用列 argmax
  if (reverse) {
    const takenSrc = new Set([...pairs.keys()].map(k => Number(k.split('-')[0])))
    for (let s = 0; s < srcLen; s++) {
      if (takenSrc.has(s)) continue
      let bestT = -1, bestV = -Infinity
      for (let t = 0; t < tgtLen; t++) {
        if (crossAttn[t][s] > bestV) { bestV = crossAttn[t][s]; bestT = t }
      }
      if (bestT >= 0 && bestV >= threshold) {
        const k = `${s}-${bestT}`
        if (!pairs.has(k) || pairs.get(k) < bestV) pairs.set(k, bestV)
      }
    }
  }

  return [...pairs.entries()].map(([k, score]) => {
    const [srcIdx, tgtIdx] = k.split('-').map(Number)
    return { srcIdx, tgtIdx, score }
  })
}

/**
 * MarianMT 特殊 token id（pad/eos/语言 token）
 * opus-mt-en-zh 的特殊 token：
 *   <pad>=65000, </s>=0（eos）, <s>=65000（bos 不用）, 语言代码 token=58687（zh）
 * 但更稳的做法：用 token 文本判断（含 "_" 前缀 / 全大写英语代码 / 特殊符号）
 */
export function isSpecialToken(tokenText) {
  if (!tokenText) return true
  const t = tokenText.trim()
  if (!t) return true
  // Marian 特殊：sentencepiece BPE 续接符是 ▁（U+2581）
  // </s> <pad> 等
  if (t === '</s>' || t === '<pad>' || t === '<s>' || t === '<unk>' || t === '<mask>') return true
  // MarianMT 语言代码（>>cmn<<）
  if (/^>>[a-z]+<<$/i.test(t)) return true
  // NLLB 语言代码（eng_Latn / zho_Hans）
  if (/^[a-z]{3}_[A-Z][a-z]{3}$/.test(t)) return true
  return false
}

/**
 * 从 crossAttn 矩阵去掉特殊 token 行/列
 * @param {number[][]} crossAttn  [tgt_len][src_len]
 * @param {string[]} tgtTokens
 * @param {string[]} srcTokens
 * @returns {{ trimmed: number[][], tgtIdxMap: number[], srcIdxMap: number[] }}
 *   trimmed 是去特殊 token 后的矩阵
 *   tgtIdxMap[i] = 原 tgt token 索引（trimmed 第 i 行对应的原始 idx）
 */
export function trimSpecialTokens(crossAttn, tgtTokens, srcTokens) {
  const tgtIdxMap = []
  const srcIdxMap = []
  for (let i = 0; i < tgtTokens.length; i++) {
    if (!isSpecialToken(tgtTokens[i])) tgtIdxMap.push(i)
  }
  for (let j = 0; j < srcTokens.length; j++) {
    if (!isSpecialToken(srcTokens[j])) srcIdxMap.push(j)
  }

  const trimmed = tgtIdxMap.map(i => srcIdxMap.map(j => crossAttn[i][j]))
  return { trimmed, tgtIdxMap, srcIdxMap }
}

/**
 * Route C 完整对齐
 * @param {Object} fixture  来自 export_crossattn.py 的单 case
 * @returns {Array<{srcIdx, tgtIdx, score}>}  索引基于「去掉特殊 token 后」
 */
export function alignWithCrossAttn(fixture, opts = {}) {
  const { crossAttn, tgtTokens, srcTokens } = fixture
  const { trimmed, tgtIdxMap, srcIdxMap } = trimSpecialTokens(crossAttn, tgtTokens, srcTokens)

  // attention 专用对齐：单向 argmax + 阈值（crossAttn 已 softmax）
  const threshold = opts.threshold ?? 0.3
  const pairs = attnAlign(trimmed, { threshold, reverse: false })

  // 金标准是基于「去掉特殊 token 后」的索引，与 LaBSE fixture 一致
  return pairs
}

/**
 * 工具：把对齐结果 remap 到原始 token 索引（含特殊 token）
 * 用于 UI 渲染时找到原文 token 位置
 */
export function remapToOriginal(pairs, tgtIdxMap, srcIdxMap) {
  return pairs.map(p => ({
    srcIdx: srcIdxMap[p.srcIdx],
    tgtIdx: tgtIdxMap[p.tgtIdx],
    score: p.score,
  }))
}
