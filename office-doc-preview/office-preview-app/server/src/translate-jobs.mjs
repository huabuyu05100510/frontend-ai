// Translate Jobs — per-job JSONL frame log
// 模型：claude-sonnet-4-6
//
// 用途：记录翻译任务的进度帧（started / page-done / ocr-done / image-done /
//       finished / failed / cancelled / paused / resumed），供前端长轮询或
//       WebSocket 增量消费 + 事后回放排障。
//
// 持久化策略（参考 workspace-timeline.mjs 同款）：
//   - 每 job 一个 JSONL 文件：`DERIVED_DIR/translate-jobs/<safeJobId>.jsonl`
//   - 每 job 200 帧上限（保留最新的 200）
//   - 单文件超过 10_000 行时整体归档为 `<file>.jsonl.<ts>`，新建空文件继续
//   - 任务 ID 防路径穿越：`replace(/[^\w-]/g, '_')`
//   - 写入是"追加 + 必要时整文件重写"两套路径；appendRaw 是热路径
//   - 所有公开函数带 ISO 时间戳日志（observability）
//
// 公开 API：
//   - appendFrame({ jobId, kind, payload })        → 写入一帧（含分配 seq）
//   - tailFrames({ jobId, sinceSeq = 0 })          → 增量拉取
//   - getJob({ jobId })                            → 任务摘要（status = last frame kind）
//   - isJobCancelled({ jobId })                    → 快速判断
//   - clearJob({ jobId })                          → 测试隔离用

import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from './config.mjs'

const VALID_KINDS = new Set([
  'started',
  'page-done',
  'ocr-done',
  'image-done',
  'finished',
  'failed',
  'cancelled',
  'paused',
  'resumed',
])

const MAX_FRAMES_PER_JOB = 200
const MAX_LINES_BEFORE_ROTATE = 10_000

const JOBS_DIR = () => path.join(CONFIG.DERIVED_DIR, 'translate-jobs')

/** 安全 jobId — 防路径穿越 + 强制可作为文件名 */
function safeJobId(jobId) {
  if (typeof jobId !== 'string' || !jobId) return 'job_unknown'
  const cleaned = jobId.replace(/[^\w-]/g, '_').slice(0, 128)
  return cleaned || 'job_unknown'
}

function jobFilePath(jobId) {
  return path.join(JOBS_DIR(), `${safeJobId(jobId)}.jsonl`)
}

function jobFileNameForTest(jobId) {
  return `${safeJobId(jobId)}.jsonl`
}

function ensureDir() {
  fs.mkdirSync(JOBS_DIR(), { recursive: true })
}

function readRawLines(jobId) {
  const file = jobFilePath(jobId)
  if (!fs.existsSync(file)) return []
  const raw = fs.readFileSync(file, 'utf-8')
  return raw.split('\n').filter(l => l.trim().length > 0)
}

function parseLines(lines, jobId) {
  const out = []
  for (const line of lines) {
    try {
      out.push(JSON.parse(line))
    } catch (e) {
      const ts = new Date().toISOString()
      console.warn(`[translate-jobs ${ts}] skip bad line for jobId=${safeJobId(jobId)}: ${e.message}`)
    }
  }
  return out
}

/** 写入整文件（原子：tmp + rename） */
function writeAll(jobId, lines) {
  ensureDir()
  const file = jobFilePath(jobId)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '')
  fs.renameSync(tmp, file)
}

/** 单条追加（含 rotation 检查） */
function appendRaw(jobId, line) {
  ensureDir()
  const file = jobFilePath(jobId)
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
    console.log(`[translate-jobs ${tsIso}] rotated jobId=${safeJobId(jobId)} → ${path.basename(archived)} (lines=${lineCount})`)
    fs.writeFileSync(file, line + '\n')
    return
  }
  fs.appendFileSync(file, line + '\n')
}

function validKind(kind) {
  return typeof kind === 'string' && VALID_KINDS.has(kind)
}

/** ============ 公开 API ============ */

/**
 * 追加一帧
 * @param {{ jobId: string, kind: string, payload?: object }} input
 * @returns {{ seq: number, ts: number, tsIso: string, kind: string, jobId: string, payload: object }}
 */
export function appendFrame({ jobId, kind, payload } = {}) {
  if (!validKind(kind)) throw new Error(`invalid kind: ${kind}`)
  const safeId = safeJobId(jobId)
  if (!jobId) throw new Error('jobId required')

  // 先读出现有帧，确定下一个 seq
  const existing = parseLines(readRawLines(jobId), jobId)
  const nextSeq = existing.length === 0 ? 1 : (existing[existing.length - 1].seq || existing.length) + 1

  const now = Date.now()
  const frame = {
    seq: nextSeq,
    ts: now,
    tsIso: new Date(now).toISOString(),
    jobId: safeId,
    kind,
    payload: payload && typeof payload === 'object' ? payload : {},
  }

  // 200 帧上限：超过时丢弃最早的 N - 199 条
  const candidate = [...existing, frame]
  let kept = candidate
  if (kept.length > MAX_FRAMES_PER_JOB) {
    const sorted = [...kept].sort((a, b) => (a.seq || 0) - (b.seq || 0))
    kept = sorted.slice(sorted.length - MAX_FRAMES_PER_JOB)
  }

  // 直接写整文件（保持 seq 单调 + 行数封顶）
  writeAll(jobId, kept.map(f => JSON.stringify(f)))

  const tsIso = new Date(now).toISOString()
  console.log(`[translate-jobs ${tsIso}] append jobId=${safeId} seq=${frame.seq} kind=${kind}`)
  return frame
}

/**
 * 增量拉取指定 jobId 的帧（升序）
 * @param {{ jobId: string, sinceSeq?: number }} opts
 * @returns {Array<object>}
 */
export function tailFrames({ jobId, sinceSeq = 0 } = {}) {
  if (!jobId) return []
  const parsed = parseLines(readRawLines(jobId), jobId)
  const cutoff = Number(sinceSeq) || 0
  const out = parsed.filter(f => f && (f.seq || 0) > cutoff)
  out.sort((a, b) => (a.seq || 0) - (b.seq || 0))
  return out
}

/**
 * 获取任务摘要
 * @param {{ jobId: string }} opts
 * @returns {{ jobId: string, createdAt: number, lastSeq: number, frameCount: number, status: string } | null}
 */
export function getJob({ jobId } = {}) {
  if (!jobId) return null
  const parsed = parseLines(readRawLines(jobId), jobId)
  if (parsed.length === 0) return null
  const sorted = [...parsed].sort((a, b) => (a.seq || 0) - (b.seq || 0))
  const last = sorted[sorted.length - 1]
  return {
    jobId: safeJobId(jobId),
    createdAt: sorted[0].ts || 0,
    lastSeq: last.seq || 0,
    frameCount: sorted.length,
    status: last.kind,
  }
}

/**
 * 是否已取消
 * @param {{ jobId: string }} opts
 * @returns {boolean}
 */
export function isJobCancelled({ jobId } = {}) {
  if (!jobId) return false
  const parsed = parseLines(readRawLines(jobId), jobId)
  return parsed.some(f => f && f.kind === 'cancelled')
}

/**
 * 清空某 job 全部帧（测试隔离）
 * @param {{ jobId: string }} opts
 * @returns {boolean}
 */
export function clearJob({ jobId } = {}) {
  if (!jobId) return false
  const file = jobFilePath(jobId)
  if (fs.existsSync(file)) {
    fs.unlinkSync(file)
    const tsIso = new Date().toISOString()
    console.log(`[translate-jobs ${tsIso}] clear jobId=${safeJobId(jobId)}`)
    return true
  }
  return true
}

/** ============ 测试 helper ============ */

/**
 * 测试用：绕过业务校验，按指定 seq 写入原始 JSONL 行（旋转策略仍生效）
 * 用于播种大规模数据触发 rotation 测试。性能优化：若调用方提供 seq 则不重新解析整文件。
 */
export function _appendFrameForTest(input) {
  const jobId = input.jobId
  const seq = typeof input.seq === 'number'
    ? input.seq
    : parseLines(readRawLines(jobId), jobId).length + 1
  const ts = input.ts ?? Date.now()
  const frame = {
    seq,
    ts,
    tsIso: new Date(ts).toISOString(),
    jobId: safeJobId(jobId),
    kind: input.kind || 'page-done',
    payload: input.payload ?? {},
  }
  appendRaw(jobId, JSON.stringify(frame))
  return frame
}

/** 测试用：暴露内部安全化文件名生成逻辑 */
export function _jobFileNameForTest(jobId) {
  return jobFileNameForTest(jobId)
}
