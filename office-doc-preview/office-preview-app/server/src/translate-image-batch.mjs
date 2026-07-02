// translate-image-batch.mjs — per-image batch translation orchestrator
// 模型：claude-sonnet-4-6
//
// 用途：批量翻译多张图片（taskId 列表），逐张跑 OCR → 逐 region 翻译 → 写
//       进度帧到 translate-jobs JSONL。并发=3 默认，cancellation 在每张图
//       开始前检查，OCR 失败不打断整批。
//
// 设计要点：
//   - 异步 fire-and-forget：startBatch() 立即返回，内部 runner 持续写帧
//   - 每张图都先取 task → 调 ocrImage → 调 translateAI 每个 region
//   - glossary 在每 region 翻译前先 applyGlossary 替换术语
//   - TM 在每 region 翻译前按 lookupTm 模糊命中替换
//   - OCR 抛错 → 写 'failed' 帧；continue，不阻塞后续
//   - cancelled 帧出现后，runner 在下一次 image 边界检查 → break
//
// 公开 API：
//   startBatch({jobId, taskIds, sourceLang, targetLang, glossaryId?, tmId?, concurrency?})
//   pollBatch({jobId, sinceSeq?}) → {jobId, status, lastSeq, items}
//   cancelBatch({jobId}) → {ok, cancelledAt}
//   getBatchItem({jobId, taskId}) → BatchItem | null
//   isBatchRunning({jobId}) → boolean
//   _clearAllBatchesForTest() → void

import {
  appendFrame,
  tailFrames,
  getJob,
  isJobCancelled,
  clearJob,
} from './translate-jobs.mjs'
import { getTask } from './store.mjs'
import { ocrImage } from './ocr.mjs'
import { translateAI } from './translate-provider.mjs'
import { applyGlossary, listTerms } from './translate-glossary.mjs'
import { lookupTm } from './translate-memory.mjs'

// ============ 内部状态 ============

/** jobId → { total, taskIds, okCount, failedCount, skippedCount, startedAt } */
const batches = new Map()

const TERMINAL_STATUSES = new Set(['finished', 'failed', 'cancelled'])

const MODULE_TAG = 'translate-image-batch'

function nowIso() {
  return new Date().toISOString()
}

function log(message) {
  console.log(`[${MODULE_TAG} ${nowIso()}] ${message}`)
}

function warn(message) {
  console.warn(`[${MODULE_TAG} ${nowIso()}] ${message}`)
}

// ============ Semaphore ============

/**
 * In-house concurrency limiter.
 *   const sem = createSemaphore(3)
 *   const release = await sem.acquire()
 *   try { ... } finally { release() }
 */
function createSemaphore(limit) {
  const cap = Math.max(1, Number(limit) || 1)
  let active = 0
  const queue = []
  function acquire() {
    return new Promise(resolve => {
      const tryAcquire = () => {
        if (active < cap) {
          active++
          resolve(() => {
            active--
            if (queue.length > 0) {
              const next = queue.shift()
              next()
            }
          })
        } else {
          queue.push(tryAcquire)
        }
      }
      tryAcquire()
    })
  }
  return { acquire }
}

// ============ Runner ============

/**
 * 单图处理：在语义上等价于：
 *   1) getTask(taskId)
 *   2) ocrImage(imagePath)
 *   3) ocr-done frame
 *   4) for each region: applyGlossary → lookupTm → translateAI → translation
 *   5) image-done frame with enriched regions
 * 失败路径：捕获所有异常，写 'failed' 帧并继续。
 */
async function processOne({ jobId, taskId, sourceLang, targetLang, glossaryTerms, tmEnabled }) {
  const t0 = Date.now()
  try {
    const task = getTask(taskId)
    if (!task) {
      const errMsg = `task not found: ${taskId}`
      warn(`job=${jobId} task=${taskId} missing → ${errMsg}`)
      appendFrame({
        jobId,
        kind: 'failed',
        payload: { taskId, error: errMsg, reason: 'task_not_found' },
      })
      return { status: 'failed', taskId, error: errMsg }
    }

    const imagePath = task.previewPath || task.originalPath
    if (!imagePath) {
      const errMsg = `task has no imagePath: ${taskId}`
      warn(`job=${jobId} task=${taskId} → ${errMsg}`)
      appendFrame({
        jobId,
        kind: 'failed',
        payload: { taskId, error: errMsg, reason: 'no_image_path' },
      })
      return { status: 'failed', taskId, error: errMsg }
    }

    const ocrT0 = Date.now()
    const ocrResult = await ocrImage(imagePath)
    const ocrMs = Date.now() - ocrT0

    // ocr-done 帧：粒度 = 单图 OCR 完成
    const regions = Array.isArray(ocrResult.regions) ? ocrResult.regions : []
    const regionCount = regions.length
    const confidenceMean = regionCount > 0
      ? regions.reduce((s, r) => s + (Number(r?.confidence) || 0), 0) / regionCount
      : 0
    appendFrame({
      jobId,
      kind: 'ocr-done',
      payload: {
        taskId,
        engine: ocrResult.engine || 'unknown',
        regionCount,
        ms: ocrMs,
        confidenceMean: Number(confidenceMean.toFixed(4)),
      },
    })

    // 逐 region 翻译
    const translateT0 = Date.now()
    const enrichedRegions = []
    for (const region of regions) {
      const srcText = region?.text ?? ''
      // glossary 替换（如有）
      const glossaApplied = glossaryTerms && glossaryTerms.length > 0
        ? applyGlossary(srcText, glossaryTerms)
        : srcText

      // TM 替换（按整段 bigram 命中，命中即整段替换为 target）
      let tmHit = null
      let preTmText = glossaApplied
      if (tmEnabled && preTmText) {
        const hits = lookupTm({
          sourceLang,
          targetLang,
          query: preTmText,
          threshold: 0.7,
          limit: 1,
        })
        if (hits && hits.length > 0) {
          tmHit = hits[0]
          preTmText = tmHit.target || preTmText
        }
      }

      let translated = ''
      if (preTmText) {
        try {
          const res = await translateAI({
            text: preTmText,
            sourceLang,
            targetLang,
          })
          translated = res.target || ''
        } catch (e) {
          warn(`job=${jobId} task=${taskId} region translate failed: ${e.message}`)
          translated = preTmText // graceful fallback
        }
      }

      enrichedRegions.push({
        ...region,
        translation: translated,
        tmHitId: tmHit?.id || null,
        tmScore: tmHit?.score ?? null,
      })
    }
    const translateMs = Date.now() - translateT0
    const totalMs = Date.now() - t0

    appendFrame({
      jobId,
      kind: 'image-done',
      payload: {
        taskId,
        regions: enrichedRegions,
        ms: totalMs,
        ocrMs,
        translateMs,
        confidenceMean: Number(confidenceMean.toFixed(4)),
      },
    })

    log(`job=${jobId} image-done task=${taskId} regions=${regionCount} ocrMs=${ocrMs} translateMs=${translateMs} totalMs=${totalMs}`)
    return { status: 'image-done', taskId, regions: enrichedRegions, ocrMs, translateMs, totalMs }
  } catch (e) {
    const errMsg = e?.message || String(e)
    warn(`job=${jobId} task=${taskId} crashed: ${errMsg}`)
    try {
      appendFrame({
        jobId,
        kind: 'failed',
        payload: { taskId, error: errMsg, reason: 'exception' },
      })
    } catch (innerErr) {
      warn(`job=${jobId} failed-frame append also failed: ${innerErr.message}`)
    }
    return { status: 'failed', taskId, error: errMsg }
  }
}

// ============ Public API ============

/**
 * 启动批量翻译。立即返回，runner 异步推进。
 * @param {{ jobId: string, taskIds: string[], sourceLang: string, targetLang: string, glossaryId?: string, tmId?: string, concurrency?: number }} opts
 * @returns {{ jobId: string, total: number, startedAt: number }}
 */
export function startBatch({
  jobId,
  taskIds,
  sourceLang,
  targetLang,
  glossaryId,
  tmId,
  concurrency = 3,
} = {}) {
  if (!jobId || typeof jobId !== 'string') throw new Error('jobId required')
  if (!Array.isArray(taskIds)) throw new Error('taskIds must be an array')
  const total = taskIds.length
  const startedAt = Date.now()

  // 注册内部状态
  batches.set(jobId, {
    total,
    taskIds: [...taskIds],
    okCount: 0,
    failedCount: 0,
    skippedCount: 0,
    startedAt,
    sourceLang,
    targetLang,
    glossaryId: glossaryId || null,
    tmId: tmId || null,
    concurrency: Math.max(1, Number(concurrency) || 3),
  })

  // started 帧
  appendFrame({
    jobId,
    kind: 'started',
    payload: {
      total,
      sourceLang,
      targetLang,
      glossaryId: glossaryId || null,
      tmId: tmId || null,
      concurrency: Math.max(1, Number(concurrency) || 3),
    },
  })
  log(`start job=${jobId} total=${total} src=${sourceLang} tgt=${targetLang} glossary=${glossaryId || '-'} tm=${tmId || '-'}`)

  // 预解析 glossary（如有）
  let glossaryTerms = []
  if (glossaryId && sourceLang && targetLang) {
    try {
      glossaryTerms = listTerms({ sourceLang, targetLang }) || []
    } catch (e) {
      warn(`job=${jobId} glossary load failed: ${e.message}`)
    }
  }

  const tmEnabled = !!tmId

  // fire-and-forget runner
  void runBatch({
    jobId,
    taskIds,
    sourceLang,
    targetLang,
    glossaryTerms,
    tmEnabled,
  })

  return { jobId, total, startedAt }
}

/**
 * 内部 runner：调度所有图片，写终止帧。
 */
async function runBatch({ jobId, taskIds, sourceLang, targetLang, glossaryTerms, tmEnabled }) {
  const state = batches.get(jobId)
  if (!state) {
    warn(`runner called for unknown jobId=${jobId}; aborting`)
    return
  }
  const sem = createSemaphore(state.concurrency)
  const tasks = []

  for (const taskId of taskIds) {
    // 在每个 image 开始前检查 cancellation
    if (isJobCancelled({ jobId })) {
      log(`job=${jobId} cancellation observed at task=${taskId}; skipping remainder`)
      appendFrame({
        jobId,
        kind: 'cancelled',
        payload: { reason: 'user_cancelled', atTaskId: taskId, ts: Date.now() },
      })
      break
    }
    const release = await sem.acquire()
    tasks.push((async () => {
      try {
        const result = await processOne({
          jobId,
          taskId,
          sourceLang,
          targetLang,
          glossaryTerms,
          tmEnabled,
        })
        if (result.status === 'image-done') {
          state.okCount++
        } else if (result.status === 'failed') {
          state.failedCount++
        }
      } catch (e) {
        state.failedCount++
        warn(`job=${jobId} task=${taskId} unhandled: ${e?.message || e}`)
      } finally {
        release()
      }
    })())
  }

  await Promise.allSettled(tasks)

  // 终止帧
  // 如果 cancelled 已经在循环中写过，这里用 finished（避免重复 cancelled）
  if (!isJobCancelled({ jobId })) {
    const okCount = state.okCount
    const failedCount = state.failedCount
    const totalMs = Date.now() - state.startedAt
    appendFrame({
      jobId,
      kind: 'finished',
      payload: { okCount, failedCount, totalMs, total: state.total },
    })
    log(`finish job=${jobId} ok=${okCount} failed=${failedCount} totalMs=${totalMs}`)
  } else {
    log(`cancelled-final job=${jobId} ok=${state.okCount} failed=${state.failedCount}`)
  }
}

/**
 * 取消批任务。在 image 边界检查；runner 不在中间打断，但后续 image 不再启动。
 * @param {{ jobId: string }} opts
 * @returns {{ ok: boolean, cancelledAt: number }}
 */
export function cancelBatch({ jobId } = {}) {
  if (!jobId) return { ok: false, cancelledAt: 0 }
  if (isJobCancelled({ jobId })) {
    return { ok: true, cancelledAt: Date.now() }
  }
  appendFrame({
    jobId,
    kind: 'cancelled',
    payload: { reason: 'user_cancelled', ts: Date.now() },
  })
  log(`cancel job=${jobId}`)
  return { ok: true, cancelledAt: Date.now() }
}

/**
 * 轮询批进度
 * @param {{ jobId: string, sinceSeq?: number }} opts
 * @returns {{ jobId: string, status: string, lastSeq: number, items: Array<object> }}
 */
export function pollBatch({ jobId, sinceSeq = 0 } = {}) {
  const safeId = typeof jobId === 'string' && jobId ? jobId : ''
  const job = getJob({ jobId: safeId })
  const status = job?.status || 'unknown'
  const lastSeq = job?.lastSeq || 0
  const frames = safeId ? tailFrames({ jobId: safeId, sinceSeq }) : []

  // 收集 items：从所有 frame 中抽取每个 taskId 的最新状态
  // 优先级（最新覆盖旧值）：image-done / failed / ocr-done / skipped（来自 cancel 边界）
  const itemsMap = new Map() // taskId → merged payload
  for (const f of frames) {
    if (!f || !f.payload) continue
    const p = f.payload
    const tid = p.taskId
    if (!tid) continue
    if (f.kind === 'image-done' || f.kind === 'failed') {
      const prev = itemsMap.get(tid) || {}
      itemsMap.set(tid, {
        ...prev,
        ...p,
        status: f.kind === 'image-done' ? 'image-done' : 'failed',
        taskId: tid,
      })
    } else if (f.kind === 'ocr-done') {
      const prev = itemsMap.get(tid) || {}
      if (!prev.status) {
        itemsMap.set(tid, {
          ...prev,
          taskId: tid,
          status: 'ocr-done',
          engine: p.engine,
          regionCount: p.regionCount,
          confidenceMean: p.confidenceMean,
          ocrMs: p.ms,
        })
      }
    }
  }

  // 顺序按 taskIds 提交顺序排列
  const state = batches.get(safeId)
  const orderedIds = state ? state.taskIds : Array.from(itemsMap.keys())
  const items = []
  for (const tid of orderedIds) {
    if (itemsMap.has(tid)) {
      items.push(itemsMap.get(tid))
    } else {
      // 未处理的 task（被 cancellation 跳过）
      items.push({ taskId: tid, status: 'skipped' })
    }
  }

  return { jobId: safeId, status, lastSeq, items }
}

/**
 * 单图最新状态（payload + status 归一化）
 * @param {{ jobId: string, taskId: string }} opts
 */
export function getBatchItem({ jobId, taskId } = {}) {
  if (!jobId || !taskId) return null
  const frames = tailFrames({ jobId })
  // 倒序：最新的优先
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]
    if (!f || !f.payload) continue
    if (f.payload.taskId !== taskId) continue
    if (f.kind === 'image-done' || f.kind === 'failed') {
      return { ...f.payload, taskId, status: f.kind === 'image-done' ? 'image-done' : 'failed' }
    }
  }
  return null
}

/**
 * 是否仍在运行
 * @param {{ jobId: string }} opts
 * @returns {boolean}
 */
export function isBatchRunning({ jobId } = {}) {
  if (!jobId) return false
  const job = getJob({ jobId })
  if (!job) return false
  return !TERMINAL_STATUSES.has(job.status)
}

/**
 * 测试隔离：清空所有内存 batch 状态 + 删除对应 JSONL 帧文件
 */
export function _clearAllBatchesForTest() {
  const ids = Array.from(batches.keys())
  for (const id of ids) {
    try { clearJob({ jobId: id }) } catch { /* ignore */ }
  }
  batches.clear()
}

/**
 * 测试 helper：读取指定 jobId 当前所有帧（按时间排序）
 * 直接读 JSONL 文件，避免依赖 vi.mock 注入的 tailFrames
 */
export function _readFramesForTest(jobId) {
  if (!jobId) return []
  try {
    return tailFrames({ jobId })
  } catch {
    return []
  }
}