// 模型：claude-sonnet-4-6
// translate-feedback — 翻译标注反馈加载 + 注入
//
// 职责：
//   1) loadAnnotations(taskId)  从 DERIVED_DIR/translate-annotations/<taskId>.jsonl 读取
//      - 容错：损坏行跳过；removed:true 过滤
//   2) extractAltTgt / extractSegmentId  防御式字段提取
//   3) mergeGlossaryWithFeedback  alt_trans → glossary 合并（last-write-wins）
//   4) collectRetargetSegments  seg_rating<3 → segmentId 集合
//   5) summarizeAnnotations  3 种 kind 统计
//
// 日志格式：[translate-feedback ISO] task=... count=... altTrans=... segRatingLow=... alignFix=...

import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from './config.mjs'

function safeReadJsonl(file) {
  if (!fs.existsSync(file)) return []
  let raw
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch (e) {
    console.warn(`[translate-feedback] read failed: ${file}: ${e.message}`)
    return []
  }
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  const out = []
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      if (obj && obj.removed !== true) out.push(obj)
    } catch {
      // 损坏行：跳过
    }
  }
  return out
}

/**
 * 读 taskId 的所有标注（JSONL）
 * @param {string} taskId
 * @returns {Array<Object>}
 */
export function loadAnnotations(taskId) {
  const tid = String(taskId || 'standalone').replace(/[^\w-]/g, '_')
  const file = path.join(CONFIG.DERIVED_DIR, 'translate-annotations', `${tid}.jsonl`)
  return safeReadJsonl(file)
}

/**
 * 提取 altTgt：优先 payload.altTgt，否则 tgtText，否则 payload.text
 * @returns {string|null}
 */
export function extractAltTgt(anno) {
  if (!anno) return null
  const p = anno.payload || {}
  // 顺序：payload.altTgt → tgtText → payload.text（空字符串视为无值）
  const candidates = [p.altTgt, anno.tgtText, p.text]
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim().length > 0) return v
  }
  return null
}

/**
 * 提取 segmentId：优先 srcSegmentId，否则 domPath
 */
export function extractSegmentId(anno) {
  if (!anno) return null
  return anno.srcSegmentId || anno.domPath || null
}

/**
 * 合并 glossary + alt_trans 标注反馈
 * - last-write-wins：同 source 后写覆盖
 * - 空 srcText 或 altTgt 跳过
 * @param {Array<{source:string,target:string}>} glossary
 * @param {Array<Object>} annotations
 * @returns {Array<{source:string,target:string}>}
 */
export function mergeGlossaryWithFeedback(glossary, annotations) {
  const map = new Map()
  for (const g of (glossary || [])) {
    if (g && g.source) map.set(g.source, g.target)
  }
  for (const a of (annotations || [])) {
    if (!a || a.kind !== 'alt_trans') continue
    if (a.removed) continue
    const src = typeof a.srcText === 'string' ? a.srcText.trim() : ''
    if (!src) continue
    const tgt = extractAltTgt(a)
    if (!tgt) continue
    map.set(src, tgt)
  }
  return Array.from(map.entries()).map(([source, target]) => ({ source, target }))
}

/**
 * 收集 seg_rating<3 的段 id
 * @returns {Set<string>}
 */
export function collectRetargetSegments(annotations) {
  const set = new Set()
  for (const a of (annotations || [])) {
    if (!a || a.removed) continue
    if (a.kind !== 'seg_rating') continue
    const r = a.payload?.rating
    if (typeof r === 'number' && r < 3) {
      const id = extractSegmentId(a)
      if (id) set.add(String(id))
    }
  }
  return set
}

/**
 * 统计标注中 3 种 kind 的数量
 * @returns {{altTrans:number, segRatingLow:number, alignFix:number}}
 */
export function summarizeAnnotations(annotations) {
  const summary = { altTrans: 0, segRatingLow: 0, alignFix: 0 }
  for (const a of (annotations || [])) {
    if (!a || a.removed) continue
    if (a.kind === 'alt_trans') summary.altTrans++
    else if (a.kind === 'seg_rating' && typeof a.payload?.rating === 'number' && a.payload.rating < 3) summary.segRatingLow++
    else if (a.kind === 'align_fix') summary.alignFix++
  }
  return summary
}

/**
 * 一站式：根据 taskId 加载所有反馈 + 摘要
 * @param {string} taskId
 * @returns {{annotations: Array, summary: {altTrans:number, segRatingLow:number, alignFix:number}, retargetSegments: Set<string>, feedbackGlossary: Array<{source:string,target:string}>}}
 */
export function loadAllFeedback(taskId) {
  const annotations = loadAnnotations(taskId)
  const summary = summarizeAnnotations(annotations)
  const retargetSegments = collectRetargetSegments(annotations)
  const feedbackGlossary = mergeGlossaryWithFeedback([], annotations)
  console.log(
    `[translate-feedback ${new Date().toISOString()}] task=${taskId} count=${annotations.length} altTrans=${summary.altTrans} segRatingLow=${summary.segRatingLow} alignFix=${summary.alignFix} retarget=${retargetSegments.size}`,
  )
  return { annotations, summary, retargetSegments, feedbackGlossary }
}
