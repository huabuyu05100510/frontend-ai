// Translation Memory (TM) — 翻译记忆库
// 模型：claude-sonnet-4-6
//
// 用途：存储 source→target 句对，按 bigram Jaccard 相似度模糊检索复用。
//       与术语表（glossary）的"最长优先 + 位置替换"不同，TM 是"整句模糊匹配 + 排序"。
//
// 持久化策略（复刻 workspace-timeline.mjs 的 JSONL 模式）：
//   - 每个语言对一个 JSONL 文件：`DERIVED_DIR/translation-memory/<src>_<tgt>.jsonl`
//   - 200 条上限（list/append 双重把关）
//   - 单文件超过 maxLines = 10_000 行时整体归档为 `<src>_<tgt>.<ts>.jsonl`，新建空文件继续
//   - 所有公开函数带 ISO 时间戳日志（observability）
//
// 公开 API：
//   - scoreSimilarity(a, b)         → bigram Jaccard [0,1]
//   - addTmEntry({sourceLang,...})  → TmEntry（含 id + ts + tsIso）
//   - lookupTm({sourceLang, query, threshold=0.7, limit=5}) → TmEntry[] 按 score DESC
//   - deleteTmEntry({id, sourceLang, targetLang}) → boolean
//   - listTm({sourceLang, targetLang, limit=200}) → TmEntry[]（倒序）
//   - countTm({sourceLang, targetLang}) → number
//   - clearTm({sourceLang, targetLang}) → boolean（测试隔离用）

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CONFIG } from './config.mjs'

const MAX_ENTRIES_PER_PAIR = 200
const MAX_LINES_BEFORE_ROTATE = 10_000

const TM_DIR = () => path.join(CONFIG.DERIVED_DIR, 'translation-memory')

/** safe lang code — 防路径穿越 */
function safeLang(lang) {
  if (typeof lang !== 'string') return 'unknown'
  const cleaned = lang.replace(/[^\w.-]/g, '_').slice(0, 32)
  return cleaned || 'unknown'
}

function pairFile(sourceLang, targetLang) {
  return path.join(TM_DIR(), `${safeLang(sourceLang)}_${safeLang(targetLang)}.jsonl`)
}

function ensureDir() {
  fs.mkdirSync(TM_DIR(), { recursive: true })
}

/** 字符级 bigram 集合 */
function bigramsOf(s) {
  const set = new Set()
  if (!s || s.length === 0) return set
  if (s.length === 1) {
    set.add(s)
    return set
  }
  for (let i = 0; i < s.length - 1; i++) {
    set.add(s.slice(i, i + 2))
  }
  return set
}

/**
 * bigram Jaccard 相似度
 * @param {string} a
 * @param {string} b
 * @returns {number} [0, 1]
 */
export function scoreSimilarity(a, b) {
  if (!a || !b) return 0
  const sa = String(a)
  const sb = String(b)
  if (!sa || !sb) return 0
  if (sa === sb) return 1

  const ba = bigramsOf(sa)
  const bb = bigramsOf(sb)
  if (ba.size === 0 && bb.size === 0) return 0

  let inter = 0
  for (const g of ba) if (bb.has(g)) inter++
  const union = ba.size + bb.size - inter
  return union === 0 ? 0 : inter / union
}

function readLines(sourceLang, targetLang) {
  const file = pairFile(sourceLang, targetLang)
  if (!fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf-8')
  return raw.split('\n').filter(l => l.trim().length > 0)
}

function parseLines(lines, sourceLang, targetLang) {
  const out = []
  for (const line of lines) {
    try {
      out.push(JSON.parse(line))
    } catch (e) {
      const ts = new Date().toISOString()
      console.warn(`[translate-memory ${ts}] skip bad line for pair=${safeLang(sourceLang)}→${safeLang(targetLang)}: ${e.message}`)
    }
  }
  return out
}

function writeAll(sourceLang, targetLang, lines) {
  ensureDir()
  const file = pairFile(sourceLang, targetLang)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '')
  fs.renameSync(tmp, file)
}

function appendRaw(sourceLang, targetLang, line) {
  ensureDir()
  const file = pairFile(sourceLang, targetLang)
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, line + '\n')
    return
  }
  const raw = fs.readFileSync(file, 'utf-8')
  const lineCount = raw.split('\n').filter(l => l.trim()).length
  if (lineCount >= MAX_LINES_BEFORE_ROTATE) {
    const ts = Date.now()
    const archived = file.replace(/\.jsonl$/, `.${ts}.jsonl`)
    fs.renameSync(file, archived)
    const tsIso = new Date(ts).toISOString()
    console.log(`[translate-memory ${tsIso}] rotated pair=${safeLang(sourceLang)}→${safeLang(targetLang)} → ${path.basename(archived)} (lines=${lineCount})`)
    fs.writeFileSync(file, line + '\n')
    return
  }
  fs.appendFileSync(file, line + '\n')
}

/**
 * 追加一条翻译记忆
 * @param {{sourceLang:string, targetLang:string, source:string, target:string, context?:string}} input
 * @returns {object} 新条目
 */
export function addTmEntry({ sourceLang, targetLang, source, target, context } = {}) {
  if (typeof sourceLang !== 'string' || !sourceLang) throw new Error('sourceLang required')
  if (typeof targetLang !== 'string' || !targetLang) throw new Error('targetLang required')
  if (typeof source !== 'string' || !source.trim()) throw new Error('source required')
  if (typeof target !== 'string' || !target.trim()) throw new Error('target required')

  const now = Date.now()
  const entry = {
    id: 'tm_' + now.toString(36) + crypto.randomBytes(3).toString('hex'),
    sourceLang: safeLang(sourceLang),
    targetLang: safeLang(targetLang),
    source: String(source),
    target: String(target),
    context: context ? String(context).slice(0, 200) : null,
    ts: now,
    tsIso: new Date(now).toISOString(),
  }

  // 200 上限：超过时移除最旧的（保留 199 + 追加 = 200）
  const lines = readLines(sourceLang, targetLang)
  const parsed = parseLines(lines, sourceLang, targetLang)
  if (parsed.length >= MAX_ENTRIES_PER_PAIR) {
    parsed.sort((a, b) => (a.ts || 0) - (b.ts || 0))
    const trimmed = parsed.slice(parsed.length - (MAX_ENTRIES_PER_PAIR - 1))
    const keptLines = trimmed.map(p => JSON.stringify(p))
    writeAll(sourceLang, targetLang, keptLines)
  }
  appendRaw(sourceLang, targetLang, JSON.stringify(entry))

  const tsIso = new Date(now).toISOString()
  console.log(`[translate-memory ${tsIso}] create pair=${safeLang(sourceLang)}→${safeLang(targetLang)} id=${entry.id} score=1.000 sourceLen=${entry.source.length}`)
  return entry
}

/**
 * 模糊检索
 * @param {{sourceLang:string, targetLang:string, query:string, threshold?:number, limit?:number}} opts
 * @returns {Array<object>} 按 score DESC，最多 limit 条
 */
export function lookupTm({ sourceLang, targetLang, query, threshold = 0.7, limit = 5 } = {}) {
  if (typeof sourceLang !== 'string' || !sourceLang) return []
  if (typeof targetLang !== 'string' || !targetLang) return []
  if (typeof query !== 'string' || !query.trim()) return []

  const lines = readLines(sourceLang, targetLang)
  const parsed = parseLines(lines, sourceLang, targetLang)

  const scored = []
  for (const e of parsed) {
    if (!e || typeof e.source !== 'string') continue
    const score = scoreSimilarity(query, e.source)
    if (score >= threshold) {
      scored.push({ ...e, score })
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Tie-break: more recent first
    return (b.ts || 0) - (a.ts || 0)
  })

  const cap = Math.max(1, Math.min(Number(limit) || 5, MAX_ENTRIES_PER_PAIR))
  const out = scored.slice(0, cap)

  const tsIso = new Date().toISOString()
  console.log(`[translate-memory ${tsIso}] lookup pair=${safeLang(sourceLang)}→${safeLang(targetLang)} q="${query.slice(0, 40)}" hits=${out.length} threshold=${threshold}`)
  return out
}

/**
 * 按 id 删除一条
 * @param {{id:string, sourceLang:string, targetLang:string}} opts
 * @returns {boolean}
 */
export function deleteTmEntry({ id, sourceLang, targetLang } = {}) {
  if (typeof id !== 'string' || !id) throw new Error('id required')
  if (typeof sourceLang !== 'string' || !sourceLang) throw new Error('sourceLang required')
  if (typeof targetLang !== 'string' || !targetLang) throw new Error('targetLang required')

  const lines = readLines(sourceLang, targetLang)
  const parsed = parseLines(lines, sourceLang, targetLang)
  const filtered = parsed.filter(e => e && e.id !== id)
  if (filtered.length === parsed.length) return false
  filtered.sort((a, b) => (a.ts || 0) - (b.ts || 0))
  writeAll(sourceLang, targetLang, filtered.map(e => JSON.stringify(e)))

  const tsIso = new Date().toISOString()
  console.log(`[translate-memory ${tsIso}] remove pair=${safeLang(sourceLang)}→${safeLang(targetLang)} id=${id}`)
  return true
}

/**
 * 列出某个语言对的全部条目（倒序最新优先），用于 UI 展示
 * @param {{sourceLang:string, targetLang:string, limit?:number}} opts
 * @returns {Array<object>}
 */
export function listTm({ sourceLang, targetLang, limit = 200 } = {}) {
  if (typeof sourceLang !== 'string' || !sourceLang) return []
  if (typeof targetLang !== 'string' || !targetLang) return []

  const lines = readLines(sourceLang, targetLang)
  const parsed = parseLines(lines, sourceLang, targetLang)

  parsed.sort((a, b) => {
    if (a.ts === b.ts) return 0
    return a.ts < b.ts ? 1 : -1
  })

  const cap = Math.max(1, Math.min(Number(limit) || 200, MAX_ENTRIES_PER_PAIR))
  return parsed.slice(0, cap)
}

/**
 * 统计某语言对的条目数
 * @param {{sourceLang:string, targetLang:string}} opts
 * @returns {number}
 */
export function countTm({ sourceLang, targetLang } = {}) {
  if (typeof sourceLang !== 'string' || !sourceLang) return 0
  if (typeof targetLang !== 'string' || !targetLang) return 0
  const lines = readLines(sourceLang, targetLang)
  const parsed = parseLines(lines, sourceLang, targetLang)
  return parsed.length
}

/**
 * 清空某语言对的所有条目（测试隔离 / 管理面板用）
 * @param {{sourceLang:string, targetLang:string}} opts
 * @returns {boolean}
 */
export function clearTm({ sourceLang, targetLang } = {}) {
  if (typeof sourceLang !== 'string' || !sourceLang) return false
  if (typeof targetLang !== 'string' || !targetLang) return false
  const file = pairFile(sourceLang, targetLang)
  if (fs.existsSync(file)) {
    fs.unlinkSync(file)
    const tsIso = new Date().toISOString()
    console.log(`[translate-memory ${tsIso}] clear pair=${safeLang(sourceLang)}→${safeLang(targetLang)}`)
    return true
  }
  return false
}