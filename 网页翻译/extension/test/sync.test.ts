/**
 * 后台同步层 sync.ts 单元测试
 *
 * 模型：claude-sonnet-4-6（MiniMax-M3 路由）
 *
 * 测试目标：
 *  1. flushBatch 成功路径：listUnsynced → POST → markSynced → 清 backoff
 *  2. flushBatch 失败路径：fetch 500 → 写 backoff
 *  3. backoff skip：onAlarmTick 在退避期内跳过
 *  4. backoff 恢复：now 推进到 nextRetryAt 之后 → 恢复 flush
 *  5. forceFlush：清 backoff 立即同步
 *  6. forceSync 消息处理：installSync 注册的 message handler
 *  7. online 事件处理：installSync 注册的 online handler
 *  8. 空批（count=0）不调 fetch
 *  9. computeBackoff / bumpBackoff / clearBackoff 纯函数正确性
 * 10. installSync 注册 alarm.create
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import {
  flushBatch,
  onAlarmTick,
  forceFlush,
  installSync,
  isInBackoff,
  computeBackoff,
  bumpBackoff,
  clearBackoff,
  DEFAULT_SYNC_CONFIG,
  type SyncDeps,
} from '../src/background/sync'
import { listUnsynced, markSynced, put, _reset, clear } from '../../lib/annotation-store.mjs'

// ─── helpers ──────────────────────────────────────────
let _counter = 0
function uid() {
  _counter += 1
  return '00000000-0000-4000-8000-' + String(_counter).padStart(12, '0')
}

function makeAnno() {
  return {
    id: uid(),
    kind: 'align_fix',
    schemaVersion: 1,
    url: 'https://example.com/' + _counter,
    domPath: '/html/body/p[1]',
    srcSegmentId: 'seg-' + _counter,
    langPair: ['zh', 'en'] as [string, string],
    srcText: '我爱你',
    tgtText: 'I love you',
    srcTokens: ['我', '爱', '你'],
    tgtTokens: ['I', 'love', 'you'],
    predicted: [[0, 0], [1, 1], [2, 2]],
    modelVersion: 'nllb-600m-l0h15-v1',
    payload: {
      srcTokenIdx: 1,
      predictedTgtTokenIdx: 1,
      correctedTgtTokenIdx: 1,
      correctionKind: 'change',
    },
    context: { prevSrc: null, nextSrc: null },
    createdAt: Date.now(),
    appVersion: '1.0.0',
    userAgent: 'vitest',
  }
}

interface FetchCall {
  url: string
  init: RequestInit
}

function makeDeps(over: Partial<SyncDeps> = {}): SyncDeps & { fetchCalls: FetchCall[]; log: { info: any[]; warn: any[]; error: any[] } } {
  const fetchCalls: FetchCall[] = []
  const log = { info: [] as any[], warn: [] as any[], error: [] as any[] }
  const storageStore: Record<string, unknown> = {}
  const alarmsCreated: Array<{ name: string; opts: { periodInMinutes: number } }> = []

  const deps: SyncDeps = {
    fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init: init ?? {} })
      return new Response(JSON.stringify({ accepted: 1, rejected: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as Response
    }),
    store: {
      listUnsynced: listUnsynced as SyncDeps['store']['listUnsynced'],
      markSynced: markSynced as SyncDeps['store']['markSynced'],
    },
    storage: {
      get: vi.fn(async (keys: string | string[] | null) => {
        const arr = Array.isArray(keys) ? keys : (keys ? [keys] : Object.keys(storageStore))
        const out: Record<string, unknown> = {}
        for (const k of arr) if (k in storageStore) out[k] = storageStore[k]
        return out
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(storageStore, items)
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys]
        for (const k of arr) delete storageStore[k]
      }),
    },
    alarms: {
      create: vi.fn(async (name: string, opts: { periodInMinutes: number }) => {
        alarmsCreated.push({ name, opts })
      }),
      clear: vi.fn(async () => {}),
    },
    logger: {
      info: (msg, fields) => log.info.push({ msg, ...(fields ?? {}) }),
      warn: (msg, fields) => log.warn.push({ msg, ...(fields ?? {}) }),
      error: (msg, fields) => log.error.push({ msg, ...(fields ?? {}) }),
    },
    ...over,
  }
  return Object.assign(deps, { fetchCalls, log, alarmsCreated, storageStore })
}

beforeEach(async () => {
  _reset()
  await clear()
})

// ─── 1. flushBatch 成功路径 ────────────────────────────────
describe('flushBatch', () => {
  it('成功路径：POST → markSynced → 清 backoff', async () => {
    // 预填 3 条 unsynced
    await put(makeAnno())
    await put(makeAnno())
    await put(makeAnno())

    const deps = makeDeps()
    const cfg = DEFAULT_SYNC_CONFIG
    const result = await flushBatch(deps, cfg)

    expect(result.count).toBe(3)
    expect(result.success).toBe(3)
    expect(result.failed).toBe(false)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)

    // fetch 被调一次，POST 端点对
    expect(deps.fetchCalls).toHaveLength(1)
    expect(deps.fetchCalls[0].url).toBe(cfg.endpoint)
    expect(deps.fetchCalls[0].init.method).toBe('POST')
    const body = JSON.parse(String(deps.fetchCalls[0].init.body))
    expect(body.items).toHaveLength(3)

    // IDB 中 3 条都 markSynced
    const unsynced = await listUnsynced({ limit: 10 })
    expect(unsynced).toHaveLength(0)

    // backoff 已清
    const bk = deps.storageStore[cfg.backoffKey] as { nextRetryAt: number; attempt: number }
    expect(bk.attempt).toBe(0)
    expect(bk.nextRetryAt).toBe(0)

    // logger.info 至少 2 条：start + batch
    expect(deps.log.info.find(e => e.msg === 'annotation.sync.batch.start')).toBeTruthy()
    expect(deps.log.info.find(e => e.msg === 'annotation.sync.batch')).toBeTruthy()
  })

  // ─── 2. 失败路径 ──────────────────────────────────────
  it('失败路径：fetch 500 → 写 backoff（attempt=1, nextRetryAt = now + 30s）', async () => {
    await put(makeAnno())
    const deps = makeDeps({
      fetch: vi.fn(async () =>
        new Response('internal error', { status: 500 }),
      ) as unknown as typeof fetch,
    })
    const cfg = DEFAULT_SYNC_CONFIG
    const result = await flushBatch(deps, cfg)

    expect(result.count).toBe(1)
    expect(result.failed).toBe(true)
    expect(result.error).toContain('500')

    // backoff 写入了
    const bk = deps.storageStore[cfg.backoffKey] as { nextRetryAt: number; attempt: number; lastError: string }
    expect(bk.attempt).toBe(1)
    expect(bk.lastError).toContain('500')
    // 30s 退避
    const expectedNext = Date.now() + 30_000
    expect(bk.nextRetryAt).toBeGreaterThanOrEqual(expectedNext - 1000)
    expect(bk.nextRetryAt).toBeLessThanOrEqual(expectedNext + 1000)

    // logger.warn 包含 annotation.sync.failed
    const failedLog = deps.log.warn.find(e => e.msg === 'annotation.sync.failed')
    expect(failedLog).toBeTruthy()
    expect(failedLog.attempt).toBe(1)
    expect(failedLog.retryInMs).toBeGreaterThanOrEqual(29_000)

    // markSynced 没被调
    const unsynced = await listUnsynced({ limit: 10 })
    expect(unsynced).toHaveLength(1)
  })

  // ─── 3. backoff skip ─────────────────────────────────
  it('onAlarmTick 在 backoff 期内跳过 flush', async () => {
    // 模拟已有 backoff
    const deps = makeDeps()
    deps.storageStore[DEFAULT_SYNC_CONFIG.backoffKey] = {
      nextRetryAt: Date.now() + 60_000,
      attempt: 1,
    }
    const result = await onAlarmTick(deps, DEFAULT_SYNC_CONFIG)
    expect(result).toEqual({ skipped: true, reason: 'backoff' })
    // fetch 没被调
    expect(deps.fetchCalls).toHaveLength(0)
    // logger 记录 skipped
    const sk = deps.log.info.find(e => e.msg === 'annotation.sync.skipped')
    expect(sk).toBeTruthy()
    expect(sk.reason).toBe('backoff')
  })

  // ─── 4. backoff 恢复 ────────────────────────────────
  it('backoff 过期后 onAlarmTick 恢复 flush', async () => {
    await put(makeAnno())
    // 模拟 backoff 已过期
    const deps = makeDeps()
    deps.storageStore[DEFAULT_SYNC_CONFIG.backoffKey] = {
      nextRetryAt: Date.now() - 1_000,  // 1s 前
      attempt: 2,
    }
    const result = await onAlarmTick(deps, DEFAULT_SYNC_CONFIG)
    expect('count' in result).toBe(true)
    expect((result as { count: number }).count).toBe(1)
    expect(deps.fetchCalls).toHaveLength(1)
  })

  // ─── 5. forceFlush 绕过 backoff ─────────────────────
  it('forceFlush：清 backoff 立即同步', async () => {
    await put(makeAnno())
    const deps = makeDeps()
    // 模拟有 backoff
    deps.storageStore[DEFAULT_SYNC_CONFIG.backoffKey] = {
      nextRetryAt: Date.now() + 60_000,
      attempt: 3,
    }
    const result = await forceFlush(deps, DEFAULT_SYNC_CONFIG, 'manual')
    expect(result.failed).toBe(false)
    expect(result.count).toBe(1)
    // backoff 被清
    const bk = deps.storageStore[DEFAULT_SYNC_CONFIG.backoffKey] as { attempt: number }
    expect(bk.attempt).toBe(0)
    // force log
    const forceLog = deps.log.info.find(e => e.msg === 'annotation.sync.force')
    expect(forceLog).toBeTruthy()
    expect(forceLog.trigger).toBe('manual')
  })

  // ─── 6. message handler ──────────────────────────────
  it('installSync 注册的 message handler 收到 XT_FORCE_SYNC → 触发 flush', async () => {
    await put(makeAnno())
    let messageHandler: ((msg: unknown) => void) | null = null
    const deps = makeDeps() as SyncDeps
    // 注入 _onMessage 钩子
    ;(deps as unknown as { _onMessage: (cb: (msg: unknown) => void) => void })._onMessage = (cb) => {
      messageHandler = cb
    }

    await installSync(deps, DEFAULT_SYNC_CONFIG)
    expect(messageHandler).not.toBeNull()

    // 触发
    await messageHandler!({ type: 'XT_FORCE_SYNC' })
    // 等 forceFlush 完成（installSync 内的 promise）
    await new Promise(r => setTimeout(r, 50))

    // fetch 被调
    expect(deps.fetchCalls.length).toBeGreaterThanOrEqual(1)
    const forceLog = deps.log.info.find(e => e.msg === 'annotation.sync.force')
    expect(forceLog).toBeTruthy()
    expect(forceLog.trigger).toBe('message')
  })

  it('message handler 忽略非 XT_FORCE_SYNC 消息', async () => {
    let messageHandler: ((msg: unknown) => void) | null = null
    const deps = makeDeps() as SyncDeps
    ;(deps as unknown as { _onMessage: (cb: (msg: unknown) => void) => void })._onMessage = (cb) => {
      messageHandler = cb
    }
    await installSync(deps, DEFAULT_SYNC_CONFIG)
    await messageHandler!({ type: 'TRANSLATE_BATCH' })
    await new Promise(r => setTimeout(r, 50))
    expect(deps.fetchCalls).toHaveLength(0)
  })

  // ─── 7. online handler ────────────────────────────────
  it('installSync 注册的 online handler 触发 forceFlush', async () => {
    await put(makeAnno())
    let onlineHandler: (() => void) | null = null
    const deps = makeDeps() as SyncDeps
    ;(deps as unknown as { _onOnline: (cb: () => void) => void })._onOnline = (cb) => {
      onlineHandler = cb
    }
    await installSync(deps, DEFAULT_SYNC_CONFIG)
    expect(onlineHandler).not.toBeNull()

    onlineHandler!()
    await new Promise(r => setTimeout(r, 50))

    expect(deps.fetchCalls.length).toBeGreaterThanOrEqual(1)
    const forceLog = deps.log.info.find(e => e.msg === 'annotation.sync.force')
    expect(forceLog.trigger).toBe('online')
  })

  // ─── 8. 空批 ─────────────────────────────────────────
  it('空批（unsynced=0）不调 fetch', async () => {
    const deps = makeDeps()
    const result = await flushBatch(deps, DEFAULT_SYNC_CONFIG)
    expect(result.count).toBe(0)
    expect(result.failed).toBe(false)
    expect(deps.fetchCalls).toHaveLength(0)
    // logger empty
    const empty = deps.log.info.find(e => e.msg === 'annotation.sync.empty')
    expect(empty).toBeTruthy()
  })

  // ─── 9. installSync 注册 alarm ───────────────────────
  it('installSync 调用 alarms.create(periodInMinutes=0.5)', async () => {
    let alarmHandler: ((alarm: { name: string }) => void) | null = null
    const deps = makeDeps() as SyncDeps
    ;(deps as unknown as { _onAlarm: (cb: (alarm: { name: string }) => void) => void })._onAlarm = (cb) => {
      alarmHandler = cb
    }
    await installSync(deps, DEFAULT_SYNC_CONFIG)
    expect(deps.alarmsCreated).toHaveLength(1)
    expect(deps.alarmsCreated[0].name).toBe('xt-annotation-sync')
    expect(deps.alarmsCreated[0].opts.periodInMinutes).toBe(0.5)
    // log
    const created = deps.log.info.find(e => e.msg === 'annotation.sync.alarm.created')
    expect(created).toBeTruthy()

    // 模拟 alarm 触发
    await put(makeAnno())
    await alarmHandler!({ name: 'xt-annotation-sync' })
    await new Promise(r => setTimeout(r, 50))
    expect(deps.fetchCalls.length).toBeGreaterThanOrEqual(1)
  })

  // ─── 10. computeBackoff / bumpBackoff / clearBackoff ─────
  describe('纯函数退避计算', () => {
    it('computeBackoff: attempt=0 → nextRetryAt=0', () => {
      const s = { nextRetryAt: 0, attempt: 0 }
      const r = computeBackoff(s, [1000, 2000, 3000], 5000)
      expect(r.nextRetryAt).toBe(0)
    })
    it('computeBackoff: attempt=1 → 30s', () => {
      const s = { nextRetryAt: 0, attempt: 1 }
      const r = computeBackoff(s, [30000, 60000, 300000, 1800000], 1000)
      expect(r.nextRetryAt).toBe(31000)
    })
    it('computeBackoff: attempt=2 → 1m', () => {
      const s = { nextRetryAt: 0, attempt: 2 }
      const r = computeBackoff(s, [30000, 60000, 300000, 1800000], 1000)
      expect(r.nextRetryAt).toBe(61000)
    })
    it('computeBackoff: attempt=10 → 上限 30m', () => {
      const s = { nextRetryAt: 0, attempt: 10 }
      const r = computeBackoff(s, [30000, 60000, 300000, 1800000], 1000)
      expect(r.nextRetryAt).toBe(1000 + 1800000)
    })
    it('bumpBackoff: 累加 attempt + 记 lastError', () => {
      const prev = { nextRetryAt: 0, attempt: 1 }
      const r = bumpBackoff(prev, 'HTTP 500', 1234)
      expect(r.attempt).toBe(2)
      expect(r.lastError).toBe('HTTP 500')
      expect(r.lastFailedAt).toBe(1234)
    })
    it('clearBackoff: 全部归零', () => {
      const c = clearBackoff()
      expect(c).toEqual({ nextRetryAt: 0, attempt: 0 })
    })
  })

  // ─── 11. isInBackoff ───────────────────────────────
  it('isInBackoff: nextRetryAt 已过 → inBackoff=false', async () => {
    const deps = makeDeps()
    deps.storageStore[DEFAULT_SYNC_CONFIG.backoffKey] = {
      nextRetryAt: Date.now() - 1000,
      attempt: 1,
    }
    const r = await isInBackoff(deps, DEFAULT_SYNC_CONFIG)
    expect(r.inBackoff).toBe(false)
  })
  it('isInBackoff: nextRetryAt 未到 → inBackoff=true', async () => {
    const deps = makeDeps()
    deps.storageStore[DEFAULT_SYNC_CONFIG.backoffKey] = {
      nextRetryAt: Date.now() + 60_000,
      attempt: 1,
    }
    const r = await isInBackoff(deps, DEFAULT_SYNC_CONFIG)
    expect(r.inBackoff).toBe(true)
  })

  // ─── 12. fetch 网络异常（非 HTTP error）────────────
  it('fetch 抛错（断网）→ 写 backoff + 捕获', async () => {
    await put(makeAnno())
    const deps = makeDeps({
      fetch: vi.fn(async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch,
    })
    const result = await flushBatch(deps, DEFAULT_SYNC_CONFIG)
    expect(result.failed).toBe(true)
    expect(result.error).toContain('Failed to fetch')
    const bk = deps.storageStore[DEFAULT_SYNC_CONFIG.backoffKey] as { attempt: number }
    expect(bk.attempt).toBe(1)
  })
})
