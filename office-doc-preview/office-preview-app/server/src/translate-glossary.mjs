// Translate Glossary — CSV-importable term dictionary
// 模型：claude-sonnet-4-6
//
// 用途：翻译一致性术语表。用户上传一个 CSV，import 后所有翻译流水线（图片 /
//       文档 / 实时）都按这张表做术语对齐；match 在每个 chunk 之前先跑一次
//       applyGlossary 把命中片段替换为受控译法，避免模型漂移。
//
// CSV 格式：
//   - 首行为 header：`source,target,partOfSpeech?,note?`（pos/note 可省略）
//   - UTF-8 BOM (`\uFEFF`) 自动剥离（兼容中文 Excel 导出）
//   - 字段可用双引号包裹，内部可含逗号 / 换行 / 引号（"" 转义）
//
// 持久化策略（参考 workspace-timeline.mjs 同款）：
//   - 每语言对一个 JSONL 文件：`DERIVED_DIR/glossaries/<safeSrc>_<safeTgt>.jsonl`
//   - 每对 200 条上限（保留最新的 200）
//   - 单文件超过 10_000 行时归档为 `<file>.<ts>.jsonl`，新建空文件继续
//   - 所有公开函数带 ISO 时间戳日志（observability）
//
// 匹配规则：
//   - 大小写不敏感（全部 lowercase 比对）
//   - 长词优先（避免短词抢占匹配窗口）
//   - 重叠区间统一按"长词胜出 + 短词跳过该区间"处理
//   - applyGlossary 用右到左替换，避免偏移失效

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CONFIG } from './config.mjs'

const MAX_TERMS_PER_PAIR = 200
const MAX_LINES_BEFORE_ROTATE = 10_000

const GLOSSARIES_DIR = () => path.join(CONFIG.DERIVED_DIR, 'glossaries')

/** 安全语言代码：去掉 / \ 空格等 */
function safeLang(code) {
  if (typeof code !== 'string' || !code) return 'und'
  return code.replace(/[^\w.-]/g, '_').slice(0, 32) || 'und'
}

function pairFilePath(sourceLang, targetLang) {
  const s = safeLang(sourceLang)
  const t = safeLang(targetLang)
  return path.join(GLOSSARIES_DIR(), `${s}_${t}.jsonl`)
}

function ensureDir() {
  fs.mkdirSync(GLOSSARIES_DIR(), { recursive: true })
}

function readRawLines(sourceLang, targetLang) {
  const file = pairFilePath(sourceLang, targetLang)
  if (!fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf-8')
  return raw.split('\n').filter(l => l.trim().length > 0)
}

function parseLines(lines, sourceLang, targetLang) {
  const out = []
  const pair = `${safeLang(sourceLang)}->${safeLang(targetLang)}`
  for (const line of lines) {
    try {
      out.push(JSON.parse(line))
    } catch (e) {
      const ts = new Date().toISOString()
      console.warn(`[translate-glossary ${ts}] skip bad line for ${pair}: ${e.message}`)
    }
  }
  return out
}

function writeAll(sourceLang, targetLang, lines) {
  ensureDir()
  const file = pairFilePath(sourceLang, targetLang)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '')
  fs.renameSync(tmp, file)
}

function appendRaw(sourceLang, targetLang, line) {
  ensureDir()
  const file = pairFilePath(sourceLang, targetLang)
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
    console.log(`[translate-glossary ${tsIso}] rotated ${safeLang(sourceLang)}->${safeLang(targetLang)} → ${path.basename(archived)} (lines=${lineCount})`)
    fs.writeFileSync(file, line + '\n')
    return
  }
  fs.appendFileSync(file, line + '\n')
}

/** ============ CSV 解析器 ============ */

/**
 * 手动 CSV 解析（兼容 BOM / 引号 / 嵌入逗号 / 多行单元格）
 * 足够稳健处理用户上传的术语表，不需要 csv-parse 依赖。
 * @param {Buffer|string} input
 * @returns {Array<{source: string, target: string, pos?: string, note?: string}>}
 */
export function parseCsv(input) {
  let text
  if (Buffer.isBuffer(input)) {
    text = input.toString('utf-8')
  } else if (typeof input === 'string') {
    text = input
  } else {
    throw new Error('parseCsv: expected Buffer or string')
  }
  // 剥离 UTF-8 BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)

  const rows = []
  let field = ''
  let row = []
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        // 双引号转义或闭合
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    // not in quotes
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (c === '\n' || c === '\r') {
      // handle CRLF
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      // 跳过完全空行
      if (row.some(x => x !== '')) rows.push(row)
      row = []
      i++
      continue
    }
    field += c
    i++
  }
  // tail
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.some(x => x !== '')) rows.push(row)
  }

  if (rows.length === 0) return []

  // header → field map
  const header = rows[0].map(h => h.trim().toLowerCase())
  const srcIdx = header.indexOf('source')
  const tgtIdx = header.indexOf('target')
  if (srcIdx < 0 || tgtIdx < 0) {
    throw new Error('parseCsv: header must include "source" and "target" columns')
  }
  const posIdx = header.indexOf('pos')
  const posAlias = header.indexOf('partofspeech')
  const posReal = posIdx >= 0 ? posIdx : posAlias
  const noteIdx = header.indexOf('note')

  const out = []
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]
    const source = (cells[srcIdx] || '').trim()
    const target = (cells[tgtIdx] || '').trim()
    if (!source || !target) continue
    const pos = posReal >= 0 ? (cells[posReal] || '').trim() : undefined
    const note = noteIdx >= 0 ? (cells[noteIdx] || '').trim() : undefined
    const row2 = { source, target }
    if (pos) row2.pos = pos
    if (note) row2.note = note
    out.push(row2)
  }
  return out
}

/** ============ 持久化 CRUD ============ */

/**
 * 追加术语
 * @param {{ sourceLang: string, targetLang: string, source: string, target: string, pos?: string, note?: string }} input
 * @returns {{ id: string, sourceLang: string, targetLang: string, source: string, target: string, pos?: string, note?: string, ts: number, tsIso: string }}
 */
export function appendTerm({ sourceLang, targetLang, source, target, pos, note } = {}) {
  if (!sourceLang || !targetLang) throw new Error('sourceLang and targetLang required')
  if (typeof source !== 'string' || !source.trim()) throw new Error('source required')
  if (typeof target !== 'string' || !target.trim()) throw new Error('target required')

  const now = Date.now()
  const id = 'glo_' + now.toString(36) + crypto.randomBytes(3).toString('hex')
  const entry = {
    id,
    sourceLang: safeLang(sourceLang),
    targetLang: safeLang(targetLang),
    source: source.trim(),
    target: target.trim(),
    pos: pos && typeof pos === 'string' ? pos.trim() : undefined,
    note: note && typeof note === 'string' ? note.trim() : undefined,
    ts: now,
    tsIso: new Date(now).toISOString(),
  }
  // strip undefined
  if (entry.pos === undefined) delete entry.pos
  if (entry.note === undefined) delete entry.note

  // 200 条上限：超过时丢弃最早的 (kept.length - 199) 条
  const existing = parseLines(readRawLines(sourceLang, targetLang), sourceLang, targetLang)
  const candidate = [...existing, entry]
  let kept = candidate
  if (kept.length > MAX_TERMS_PER_PAIR) {
    const sorted = [...kept].sort((a, b) => (a.ts || 0) - (b.ts || 0))
    kept = sorted.slice(sorted.length - MAX_TERMS_PER_PAIR)
  }
  writeAll(sourceLang, targetLang, kept.map(e => JSON.stringify(e)))

  const tsIso = new Date(now).toISOString()
  console.log(`[translate-glossary ${tsIso}] append ${entry.sourceLang}->${entry.targetLang} id=${id} "${entry.source}"→"${entry.target}"`)
  return entry
}

/**
 * 列出术语
 * @param {{ sourceLang: string, targetLang: string }} opts
 * @returns {Array<object>} 按 source 长度降序（最长在前，便于 matchTerm）
 */
export function listTerms({ sourceLang, targetLang } = {}) {
  if (!sourceLang || !targetLang) return []
  const parsed = parseLines(readRawLines(sourceLang, targetLang), sourceLang, targetLang)
  parsed.sort((a, b) => (b.source?.length || 0) - (a.source?.length || 0))
  return parsed
}

/**
 * 按 id 删除
 * @param {{ id: string, sourceLang: string, targetLang: string }} opts
 * @returns {boolean}
 */
export function deleteTerm({ id, sourceLang, targetLang } = {}) {
  if (!id) return false
  if (!sourceLang || !targetLang) return false
  const existing = parseLines(readRawLines(sourceLang, targetLang), sourceLang, targetLang)
  const kept = existing.filter(e => e && e.id !== id)
  if (kept.length === existing.length) return false
  writeAll(sourceLang, targetLang, kept.map(e => JSON.stringify(e)))
  const tsIso = new Date().toISOString()
  console.log(`[translate-glossary ${tsIso}] delete ${safeLang(sourceLang)}->${safeLang(targetLang)} id=${id}`)
  return true
}

/**
 * 统计条数
 * @param {{ sourceLang: string, targetLang: string }} opts
 * @returns {number}
 */
export function countTerms({ sourceLang, targetLang } = {}) {
  if (!sourceLang || !targetLang) return 0
  return parseLines(readRawLines(sourceLang, targetLang), sourceLang, targetLang).length
}

/**
 * 清空某语言对全部术语
 * @param {{ sourceLang: string, targetLang: string }} opts
 * @returns {boolean}
 */
export function clearGlossary({ sourceLang, targetLang } = {}) {
  if (!sourceLang || !targetLang) return false
  const file = pairFilePath(sourceLang, targetLang)
  if (fs.existsSync(file)) fs.unlinkSync(file)
  const tsIso = new Date().toISOString()
  console.log(`[translate-glossary ${tsIso}] clear ${safeLang(sourceLang)}->${safeLang(targetLang)}`)
  return true
}

/** ============ 匹配引擎 ============ */

/**
 * 在 text 中找出所有术语命中（最长优先 + 大小写不敏感 + 重叠去短）
 * @param {string} text
 * @param {Array<{source: string, target: string}>} terms
 * @returns {Array<{term: object, translation: string, start: number, end: number}>}
 */
export function matchTerm(text, terms) {
  if (typeof text !== 'string' || !Array.isArray(terms) || terms.length === 0) return []
  const lowerText = text.toLowerCase()
  // 收集所有候选命中
  const candidates = []
  for (const t of terms) {
    if (!t || typeof t.source !== 'string' || !t.source) continue
    const needle = t.source.toLowerCase()
    let idx = 0
    while (true) {
      const found = lowerText.indexOf(needle, idx)
      if (found < 0) break
      candidates.push({
        term: t,
        translation: t.target,
        start: found,
        end: found + needle.length,
        length: needle.length,
      })
      idx = found + needle.length
    }
  }
  if (candidates.length === 0) return []
  // 重叠区间：长词胜出
  candidates.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start
    return b.end - a.end // 长词优先
  })
  const result = []
  let occupiedEnd = -1
  for (const c of candidates) {
    if (c.start >= occupiedEnd) {
      // 不重叠
      result.push(c)
      occupiedEnd = c.end
    } else {
      // 重叠：只在结果里没有更早的覆盖它时才保留
      const last = result[result.length - 1]
      if (last && c.start >= last.start && c.end <= last.end) {
        // 完全被前一个覆盖 — 跳过
        continue
      }
      // 部分重叠：仅当更长才替换（保守）
      if (last && c.end > last.end) {
        result[result.length - 1] = c
        occupiedEnd = c.end
      }
    }
  }
  return result
}

/**
 * 把命中片段替换为译法（右到左替换，保留原文其它字符）
 * @param {string} text
 * @param {Array<{source: string, target: string}>} terms
 * @returns {string}
 */
export function applyGlossary(text, terms) {
  if (typeof text !== 'string' || !Array.isArray(terms) || terms.length === 0) return text
  const hits = matchTerm(text, terms)
  if (hits.length === 0) return text
  // 右到左替换，避免索引失效
  let out = text
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]
    out = out.slice(0, h.start) + h.translation + out.slice(h.end)
  }
  return out
}
