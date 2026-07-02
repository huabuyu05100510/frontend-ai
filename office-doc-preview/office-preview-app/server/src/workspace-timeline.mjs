// Workspace Timeline — 跨会话工作台活动时间线
// 模型：claude-sonnet-4-6
//
// 用途：记录用户在每个工作流上的关键事件（上传/翻译/智检/OCR/语音），供 ⌘K Palette 的
//       "最近活动" 面板消费 + 可观测的"用户活动日志"。
//
// 持久化策略（参考 annotation 实现，简化版）：
//   - 每用户一个 JSONL 文件：`DERIVED_DIR/workspace-timeline/<userId|anonymous>.jsonl`
//   - 每用户 200 条上限（list/append 双重把关）
//   - 单文件超过 maxLines = 10_000 行时整体归档为 `<user>.jsonl.<ts>`，新建空文件继续
//   - malformed line 跳过 + warn，不抛错
//   - 所有公开函数带 ISO 时间戳日志（observability）
//
// API 列表（由 router.mjs 包装）：
//   - listEntries({userId, kind, limit})  → 倒序最新优先
//   - appendEntry({userId, kind, taskId?, summary, meta?})  → 新增条目（带 id+ts）
//   - removeEntry({userId, id})           → 按 id 移除
//   - clearEntries({userId})              → 清空（删文件或覆盖空）

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CONFIG } from './config.mjs'

const VALID_KINDS = new Set(['upload', 'translate', 'qc', 'ocr', 'voice'])

const MAX_ENTRIES_PER_USER = 200
const MAX_LINES_BEFORE_ROTATE = 10_000

const TIMELINE_DIR = () => path.join(CONFIG.DERIVED_DIR, 'workspace-timeline')

/** safe userId — 防路径穿越 */
function safeUserId(userId) {
  if (typeof userId !== 'string') return 'anonymous'
  const cleaned = userId.replace(/[^\w.-]/g, '_').slice(0, 64)
  return cleaned || 'anonymous'
}

function fileOf(userId) {
  return path.join(TIMELINE_DIR(), `${safeUserId(userId)}.jsonl`)
}

function ensureDir() {
  fs.mkdirSync(TIMELINE_DIR(), { recursive: true })
}

/** 读取所有原始行（含 malformed）。不抛错。 */
function readLines(userId) {
  const file = fileOf(userId)
  if (!fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf-8')
  return raw.split('\n').filter(l => l.trim().length > 0)
}

/** 解析 + 跳过坏行（不抛错，记 warn） */
function parseLines(lines, userId) {
  const out = []
  for (const line of lines) {
    try {
      out.push(JSON.parse(line))
    } catch (e) {
      const ts = new Date().toISOString()
      console.warn(`[workspace-timeline ${ts}] skip bad line for user=${userId}: ${e.message}`)
    }
  }
  return out
}

/** 写入整文件（原子：tmp + rename） */
function writeAll(userId, lines) {
  ensureDir()
  const file = fileOf(userId)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '')
  fs.renameSync(tmp, file)
}

/** 单条追加（含 rotation 检查） */
function appendRaw(userId, line) {
  ensureDir()
  const file = fileOf(userId)
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, line + '\n')
    return
  }
  // 检查行数，超过则归档
  const raw = fs.readFileSync(file, 'utf-8')
  const lineCount = raw.split('\n').filter(l => l.trim()).length
  if (lineCount >= MAX_LINES_BEFORE_ROTATE) {
    const ts = Date.now()
    const archived = file.replace(/\.jsonl$/, `.${ts}.jsonl`)
    fs.renameSync(file, archived)
    const tsIso = new Date(ts).toISOString()
    console.log(`[workspace-timeline ${tsIso}] rotated user=${userId} → ${path.basename(archived)} (lines=${lineCount})`)
    fs.writeFileSync(file, line + '\n')
    return
  }
  fs.appendFileSync(file, line + '\n')
}

/** 验证 kind */
function validKind(kind) {
  return typeof kind === 'string' && VALID_KINDS.has(kind)
}

/** ============ 公开 API ============ */

/**
 * 列出用户的条目（倒序最新优先，可按 kind 过滤，可限制条数）
 * @param {{userId?: string, kind?: string, limit?: number}} opts
 * @returns {Array<object>}
 */
export function listEntries({ userId = 'anonymous', kind, limit = 50 } = {}) {
  const lines = readLines(userId)
  const parsed = parseLines(lines, userId)
  let filtered = parsed
  if (kind) {
    if (!validKind(kind)) return []
    filtered = filtered.filter(e => e && e.kind === kind)
  }
  // 倒序：ts 数字大的优先；同 ts 退到稳定排序（按原始顺序反向）
  filtered.sort((a, b) => {
    if (a.ts === b.ts) return 0
    return a.ts < b.ts ? 1 : -1
  })
  const cap = Math.max(1, Math.min(Number(limit) || 50, MAX_ENTRIES_PER_USER))
  return filtered.slice(0, cap)
}

/**
 * 追加一条
 * @param {{userId?: string, kind: string, taskId?: string, summary: string, meta?: object}} input
 * @returns {object} 新条目（含 id + ts）
 */
export function appendEntry({ userId = 'anonymous', kind, taskId, summary, meta } = {}) {
  if (!validKind(kind)) throw new Error(`invalid kind: ${kind}`)
  if (typeof summary !== 'string' || !summary.trim()) throw new Error('summary required')
  if (summary.length > 500) throw new Error('summary too long (>500)')

  const now = Date.now()
  const entry = {
    id: 'tl_' + now.toString(36) + crypto.randomBytes(3).toString('hex'),
    kind,
    taskId: taskId || null,
    summary: summary.trim(),
    ts: now,
    tsIso: new Date(now).toISOString(),
    meta: meta && typeof meta === 'object' ? meta : null,
  }

  // 用户级 200 条上限：超过时移除最旧的（保留 200 - 1 = 199，再追加 = 200）
  const lines = readLines(userId)
  const parsed = parseLines(lines, userId)
  if (parsed.length >= MAX_ENTRIES_PER_USER) {
    // 排序后取 max-1 条保留（即丢弃最早的 N - (max-1) = 1 条）
    parsed.sort((a, b) => (a.ts || 0) - (b.ts || 0))
    const trimmed = parsed.slice(parsed.length - (MAX_ENTRIES_PER_USER - 1))
    const keptLines = trimmed.map(p => JSON.stringify(p))
    writeAll(userId, keptLines)
  }
  appendRaw(userId, JSON.stringify(entry))

  const tsIso = new Date(now).toISOString()
  console.log(`[workspace-timeline ${tsIso}] append user=${safeUserId(userId)} kind=${kind} id=${entry.id} summary="${entry.summary}"`)
  return entry
}

/**
 * 按 id 移除
 * @param {{userId?: string, id: string}} opts
 * @returns {boolean} true 表示命中并删除
 */
export function removeEntry({ userId = 'anonymous', id } = {}) {
  if (typeof id !== 'string' || !id) throw new Error('id required')
  const lines = readLines(userId)
  const parsed = parseLines(lines, userId)
  const filtered = parsed.filter(e => e && e.id !== id)
  if (filtered.length === parsed.length) return false
  // 保留原始顺序稳定（按 ts 升序），用过滤后的 parsed 直接写
  filtered.sort((a, b) => a.ts - b.ts)
  writeAll(userId, filtered.map(e => JSON.stringify(e)))
  const tsIso = new Date().toISOString()
  console.log(`[workspace-timeline ${tsIso}] remove user=${safeUserId(userId)} id=${id}`)
  return true
}

/**
 * 清空该用户全部条目
 * @param {{userId?: string}} opts
 * @returns {{ok: boolean, cleared: number}}
 */
export function clearEntries({ userId = 'anonymous' } = {}) {
  const lines = readLines(userId)
  const cleared = lines.length
  const file = fileOf(userId)
  if (fs.existsSync(file)) fs.unlinkSync(file)
  const tsIso = new Date().toISOString()
  console.log(`[workspace-timeline ${tsIso}] clear user=${safeUserId(userId)} cleared=${cleared}`)
  return { ok: true, cleared }
}

/** ============ 测试 helper ============ */
/**
 * 测试用：绕过业务校验，仅追加一条原始 JSONL 行（旋转策略仍生效）
 * @param {object} input
 */
export function _appendEntryForTest(input) {
  const userId = input.userId || 'anonymous'
  const ts = input.ts ?? Date.now()
  const entry = {
    id: 'tl_' + ts.toString(36) + crypto.randomBytes(2).toString('hex'),
    kind: input.kind || 'upload',
    taskId: input.taskId || null,
    summary: input.summary || 'test',
    ts,
    tsIso: new Date(ts).toISOString(),
    meta: input.meta ?? null,
  }
  appendRaw(userId, JSON.stringify(entry))
  return entry
}