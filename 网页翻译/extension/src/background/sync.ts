/**
 * 后台同步层：把 IndexedDB 里的 unsynced 标注批量上传到 NestJS 标注聚合服务。
 *
 * 设计依据：docs/annotation-feature-tech-plan-V1.md §4.3 + §5
 *
 * 关键决策：
 *  1. **MV3 兼容**：用 chrome.alarms 而不是 setInterval（Service Worker 会休眠）
 *  2. **指数退避**：30s → 1m → 5m → 30m，状态持久化到 chrome.storage.local
 *  3. **批量大小**：listUnsynced({ limit: 50 })
 *  4. **幂等**：后端 INSERT OR IGNORE，前端 markSynced 在 IDB 事务内
 *  5. **可观测**：每个步骤 logger.info
 *  6. **可测试**：deps 注入 fetch / store / alarms / logger
 *  7. **触发源**：
 *     - chrome.alarms.onAlarm（30s 周期）
 *     - chrome.runtime.onMessage({ type: 'XT_FORCE_SYNC' })
 *     - online 事件
 *
 * 模型：claude-sonnet-4-6（MiniMax-M3 路由）
 */

// 静态 import annotation-store —— vite 打包时一起 bundle 到 background bundle，
// 避免 dynamic import 走 vite 的 preload helper（用 document/window，SW 上下文炸）
// vitest 也走静态 import；node 环境 fake-indexeddb 通过 test/setup 注入
// @ts-expect-error - lib/annotation-store.mjs is plain ESM JS, no .d.ts
import * as _annoStore from '../../../lib/annotation-store.mjs'

// ─── Types ──────────────────────────────────────────────
export interface SyncDeps {
  fetch: typeof fetch
  store: {
    listUnsynced: (opts: { limit: number }) => Promise<Array<Record<string, unknown>>>
    markSynced: (ids: string[]) => Promise<number>
  }
  storage: {
    get: <T = unknown>(keys: string | string[] | null) => Promise<Record<string, T>>
    set: (items: Record<string, unknown>) => Promise<void>
    remove: (keys: string | string[]) => Promise<void>
  }
  alarms: {
    create: (name: string, opts: { periodInMinutes: number }) => Promise<void>
    clear: (name: string) => Promise<void>
  }
  logger: {
    info: (msg: string, fields?: Record<string, unknown>) => void
    warn: (msg: string, fields?: Record<string, unknown>) => void
    error: (msg: string, fields?: Record<string, unknown>) => void
  }
  now?: () => number
}

export interface SyncConfig {
  endpoint: string
  periodInMinutes: number
  alarmName: string
  backoffKey: string
  batchLimit: number
  backoffScheduleMs: number[]   // 30s, 1m, 5m, 30m（最后一次复用）
  requestTimeoutMs: number
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  endpoint: 'http://localhost:3001/v1/annotations',
  periodInMinutes: 0.5,         // 30s（MV3 alarms 最小间隔）
  alarmName: 'xt-annotation-sync',
  backoffKey: 'xtAnnoSyncBackoff',
  batchLimit: 50,
  backoffScheduleMs: [
    30 * 1000,
    60 * 1000,
    5 * 60 * 1000,
    30 * 60 * 1000,
  ],
  requestTimeoutMs: 15_000,
}

interface BackoffState {
  nextRetryAt: number        // 0 = 无 backoff
  attempt: number            // 0 = 未失败过
  lastError?: string
  lastFailedAt?: number
}

// ─── 纯函数：退避计算 ─────────────────────────────────────

/** 给定上一次的 attempt 和 nowMs，返回下次允许重试时间戳。attempt 从 0 计。 */
export function computeBackoff(state: BackoffState, schedule: number[], nowMs: number): BackoffState {
  if (state.attempt <= 0) return { ...state, nextRetryAt: 0, attempt: 0 }
  const idx = Math.min(state.attempt - 1, schedule.length - 1)
  const delay = schedule[idx]
  return { ...state, nextRetryAt: nowMs + delay }
}

/** 当成功时清除 backoff 状态（attempts 归零） */
export function clearBackoff(): BackoffState {
  return { nextRetryAt: 0, attempt: 0 }
}

/** 当失败时累加 attempt，返回更新后 state（nextRetryAt 不在此函数算） */
export function bumpBackoff(state: BackoffState, errMsg: string, nowMs: number): BackoffState {
  return {
    attempt: state.attempt + 1,
    nextRetryAt: state.nextRetryAt,  // 由调用方随后 computeBackoff
    lastError: errMsg,
    lastFailedAt: nowMs,
  }
}

// ─── 核心：flushBatch ─────────────────────────────────────

export interface FlushResult {
  count: number
  success: number
  failed: boolean
  error?: string
  durationMs: number
}

/**
 * 取一批 unsynced 标注 → POST 到 endpoint → 成功则 markSynced。
 * 失败累加 backoff；空批（count=0）直接返回。
 */
export async function flushBatch(
  deps: SyncDeps,
  cfg: SyncConfig = DEFAULT_SYNC_CONFIG,
): Promise<FlushResult> {
  const t0 = (deps.now ?? Date.now)()
  const { logger } = deps
  const listResult = await safeListUnsynced(deps, cfg.batchLimit)
  if (listResult.length === 0) {
    const durationMs = (deps.now ?? Date.now)() - t0
    logger.info('annotation.sync.empty', { durationMs })
    return { count: 0, success: 0, failed: false, durationMs }
  }

  logger.info('annotation.sync.batch.start', { count: listResult.length })

  const ids = listResult.map(r => String(r.id))
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), cfg.requestTimeoutMs)
    let resp: Response
    try {
      resp = await deps.fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: listResult }),
        signal: ctrl.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (!resp.ok) {
      const errBody = await safeReadText(resp)
      throw new Error(`HTTP ${resp.status}: ${errBody.slice(0, 200)}`)
    }

    // 解析返回的 IngestResponse，决定哪些被后端真正 ingest
    // 后端用 INSERT OR IGNORE，重复 id 不算 accepted；前端无需细查，全量 markSynced
    // （idempotent：就算后端只 insert 了 N 条，前端 IDB 把这一批都置 synced 也没事，因为本地可能没收到网络 ack）
    await safeReadJson(resp).catch(() => null)  // 忽略 parse 失败

    const marked = await deps.store.markSynced(ids)
    const durationMs = (deps.now ?? Date.now)() - t0
    logger.info('annotation.sync.batch', {
      count: listResult.length,
      success: marked,
      durationMs,
    })

    // 成功 → 清 backoff
    await safeStorageSet(deps, { [cfg.backoffKey]: clearBackoff() })

    return { count: listResult.length, success: marked, failed: false, durationMs }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const nowMs = (deps.now ?? Date.now)()
    const prev = await safeStorageGet<BackoffState>(deps, cfg.backoffKey, {
      nextRetryAt: 0, attempt: 0,
    })
    const bumped = bumpBackoff(prev, errMsg, nowMs)
    const withDelay = computeBackoff(bumped, cfg.backoffScheduleMs, nowMs)
    await safeStorageSet(deps, { [cfg.backoffKey]: withDelay })

    const durationMs = (deps.now ?? Date.now)() - t0
    const retryInMs = withDelay.nextRetryAt - nowMs
    logger.warn('annotation.sync.failed', {
      count: listResult.length,
      err: errMsg,
      attempt: withDelay.attempt,
      retryInMs,
      durationMs,
    })

    return { count: listResult.length, success: 0, failed: true, error: errMsg, durationMs }
  }
}

// ─── 注册监听器 ──────────────────────────────────────────

/** 检查当前是否在 backoff 期 */
export async function isInBackoff(deps: SyncDeps, cfg: SyncConfig = DEFAULT_SYNC_CONFIG): Promise<{ inBackoff: boolean; state: BackoffState }> {
  const state = await safeStorageGet<BackoffState>(deps, cfg.backoffKey, {
    nextRetryAt: 0, attempt: 0,
  })
  const now = (deps.now ?? Date.now)()
  return { inBackoff: state.nextRetryAt > now, state }
}

/** 完整启动：注册 alarms + 监听器。返回卸载函数（测试用） */
export async function installSync(deps: SyncDeps, cfg: SyncConfig = DEFAULT_SYNC_CONFIG): Promise<() => void> {
  const { logger } = deps

  // 注册 alarm（periodInMinutes 必须 ≥ 0.5 = 30s）
  try {
    await deps.alarms.create(cfg.alarmName, { periodInMinutes: cfg.periodInMinutes })
    logger.info('annotation.sync.alarm.created', {
      name: cfg.alarmName,
      periodInMinutes: cfg.periodInMinutes,
    })
  } catch (e) {
    logger.warn('annotation.sync.alarm.create_failed', { err: String(e) })
  }

  // 注册 alarm listener
  const alarmListener = (alarm: { name: string }) => {
    if (alarm.name !== cfg.alarmName) return
    onAlarmTick(deps, cfg).catch(err => {
      deps.logger.error('annotation.sync.tick_unhandled', { err: String(err) })
    })
  }
  // chrome.alarms 在 node 测试里没有 addListener，这里用 optional duck-type
  const alarmsApi = (deps as unknown as { _onAlarm?: (cb: typeof alarmListener) => void })._onAlarm
  if (typeof alarmsApi === 'function') {
    alarmsApi(alarmListener)
  }

  // 注册 message listener
  const messageListener = (msg: unknown) => {
    if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'XT_FORCE_SYNC') {
      forceFlush(deps, cfg, 'message').catch(err => {
        deps.logger.error('annotation.sync.force_unhandled', { err: String(err) })
      })
    }
  }
  const messageApi = (deps as unknown as { _onMessage?: (cb: typeof messageListener) => void })._onMessage
  if (typeof messageApi === 'function') {
    messageApi(messageListener)
  }

  // online 事件
  const onlineListener = () => {
    forceFlush(deps, cfg, 'online').catch(err => {
      deps.logger.error('annotation.sync.online_unhandled', { err: String(err) })
    })
  }
  const onlineApi = (deps as unknown as { _onOnline?: (cb: typeof onlineListener) => void })._onOnline
  if (typeof onlineApi === 'function') {
    onlineApi(onlineListener)
  }

  // 卸载
  return () => {
    // chrome.alarms.clear 不会触发 listener，但 alarm 仍存
    deps.alarms.clear(cfg.alarmName).catch(() => {})
  }
}

/** Alarm 触发的单轮执行：先检查 backoff → flushBatch */
export async function onAlarmTick(
  deps: SyncDeps,
  cfg: SyncConfig = DEFAULT_SYNC_CONFIG,
): Promise<FlushResult | { skipped: true; reason: string }> {
  const { inBackoff, state } = await isInBackoff(deps, cfg)
  if (inBackoff) {
    const remainingMs = state.nextRetryAt - (deps.now ?? Date.now)()
    deps.logger.info('annotation.sync.skipped', { reason: 'backoff', remainingMs })
    return { skipped: true, reason: 'backoff' }
  }
  return flushBatch(deps, cfg)
}

/** 主动 force 触发：无视 backoff（用户点 FAB 📊 强制同步） */
export async function forceFlush(
  deps: SyncDeps,
  cfg: SyncConfig = DEFAULT_SYNC_CONFIG,
  trigger: 'message' | 'online' | 'manual' = 'manual',
): Promise<FlushResult> {
  // 主动同步时，先清 backoff（用户已主动确认要重试）
  await safeStorageSet(deps, { [cfg.backoffKey]: clearBackoff() })
  deps.logger.info('annotation.sync.force', { trigger })
  return flushBatch(deps, cfg)
}

// ─── 内部 helpers（容错） ──────────────────────────────────

async function safeListUnsynced(deps: SyncDeps, limit: number) {
  try {
    return await deps.store.listUnsynced({ limit })
  } catch (e) {
    deps.logger.error('annotation.sync.list_failed', { err: String(e) })
    return []
  }
}

async function safeReadText(resp: Response): Promise<string> {
  try { return await resp.text() } catch { return '' }
}

async function safeReadJson(resp: Response): Promise<unknown> {
  try { return await resp.json() } catch { return null }
}

async function safeStorageGet<T>(deps: SyncDeps, key: string, fallback: T): Promise<T> {
  try {
    const r = await deps.storage.get<T>([key])
    const v = r[key]
    return (v === undefined || v === null) ? fallback : (v as T)
  } catch {
    return fallback
  }
}

async function safeStorageSet(deps: SyncDeps, items: Record<string, unknown>): Promise<void> {
  try { await deps.storage.set(items) } catch (e) {
    deps.logger.warn('annotation.sync.storage_set_failed', { err: String(e) })
  }
}

// ─── 默认 factory：从 chrome globals 构造 deps ────────────
// 仅在 background（ESM service worker）调用。store 用静态 import（vite 打包进 bundle）
// vitest 不会调用此函数（test 用 makeTestDeps）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _storeImpl: any = _annoStore
function loadStore(): SyncDeps['store'] {
  return _storeImpl as SyncDeps['store']
}

export function makeChromeDeps(): SyncDeps {
  const logger = {
    info: (msg: string, fields: Record<string, unknown> = {}) =>
      console.info(JSON.stringify({ ts: Date.now(), level: 'info', component: 'xt:sync', msg, ...fields })),
    warn: (msg: string, fields: Record<string, unknown> = {}) =>
      console.warn(JSON.stringify({ ts: Date.now(), level: 'warn', component: 'xt:sync', msg, ...fields })),
    error: (msg: string, fields: Record<string, unknown> = {}) =>
      console.error(JSON.stringify({ ts: Date.now(), level: 'error', component: 'xt:sync', msg, ...fields })),
  }
  // chrome.* API 是 host object，必须 .bind 保留 this
  const localStorage = chrome.storage.local
  return {
    fetch: fetch.bind(globalThis),
    store: loadStore(),
    storage: {
      get: localStorage.get.bind(localStorage) as SyncDeps['storage']['get'],
      set: localStorage.set.bind(localStorage) as SyncDeps['storage']['set'],
      remove: localStorage.remove.bind(localStorage) as SyncDeps['storage']['remove'],
    },
    alarms: {
      // chrome.alarms.create 的回调签名多态，ts-check 时按本接口收紧
      create: ((name: string, opts: { periodInMinutes: number }) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Promise<void>((resolve) => (chrome.alarms.create as any)(name, opts, () => resolve()))) as SyncDeps['alarms']['create'],
      clear: ((name: string) =>
        new Promise<void>((resolve) => chrome.alarms.clear(name, () => resolve()))) as SyncDeps['alarms']['clear'],
    },
    logger,
  }
}

// ─── 启动副作用：background 加载即触发 ────────────────────
// 仅在 chrome 全局存在时执行（vitest / e2e helper 跳过）
if (typeof chrome !== 'undefined' && chrome?.runtime?.onInstalled) {
  // 提取消息处理函数（便于 e2e 测试和复用）
  async function handleMessage(msg: unknown, _sender?: unknown): Promise<unknown> {
    if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'XT_FORCE_SYNC') {
      const deps = makeChromeDeps()
      return await forceFlush(deps, DEFAULT_SYNC_CONFIG, 'message')
    }
    // e2e/test-only: 写入一批假标注
    if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'XT_TEST_SEED') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { put: storePut } = _storeImpl as any
      const items = (msg as { items?: unknown[] }).items ?? []
      for (const it of items) {
        await storePut(it)
      }
      return { ok: true, count: items.length }
    }
    return undefined
  }

  // e2e-only: 安装整个 sync 流程（独立于 onInstalled 事件触发）
  async function __xtInstallNow() {
    try {
      const deps = makeChromeDeps()
      await installSync(deps, DEFAULT_SYNC_CONFIG)
    } catch (e) {
      console.error('[xt:sync] __xtInstallNow failed', e, e instanceof Error ? e.stack : '<no stack>')
    }
  }

  // 暴露给 e2e 测试用（不在生产代码里使用）
  ;(globalThis as unknown as { __xtSyncMessageHandler?: typeof handleMessage }).__xtSyncMessageHandler = handleMessage
  ;(globalThis as unknown as { __xtInstallNow?: () => Promise<void> }).__xtInstallNow = __xtInstallNow

  chrome.runtime.onInstalled.addListener(() => {
    __xtInstallNow()
  })

  // 在线事件
  if (typeof self !== 'undefined' && typeof (self as { addEventListener?: unknown }).addEventListener === 'function') {
    self.addEventListener('online', () => {
      const deps = makeChromeDeps()
      forceFlush(deps, DEFAULT_SYNC_CONFIG, 'online').catch(() => {})
    })
  }

  // 消息路由
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handleMessage(msg, _sender)
      .then(r => {
        sendResponse(r)
        // e2e debug: 打印到 console
        console.log('[xt:sync] handleMessage result', r)
      })
      .catch(e => {
        console.error('[xt:sync] handleMessage error', e)
        sendResponse({ failed: true, error: String(e), stack: e instanceof Error ? e.stack : undefined })
      })
    // 匹配我们关心的消息类型才 keep channel
    if (msg && typeof msg === 'object') {
      const t = (msg as { type?: string }).type
      if (t === 'XT_FORCE_SYNC' || t === 'XT_TEST_SEED') return true
    }
    return false
  })
}
