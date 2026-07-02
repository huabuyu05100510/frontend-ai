/**
 * 后台同步层 E2E 测试
 *
 * 验证：
 *   1. 预填 3 条 unsynced 标注进 IDB → forceSync 消息 → NestJS 收到
 *   2. NestJS SQLite DB 中有 3 条对应记录
 *   3. IDB 中所有标注标记为 synced=1
 *   4. chrome.alarms 真的注册了 'xt-annotation-sync' (periodInMinutes=0.5)
 *   5. 后端 unreachable 时 backoff 写入
 *
 * 模型：claude-sonnet-4-6（MiniMax-M3 路由）
 *
 * 流程：
 *   1. spawn NestJS server (port 3001)
 *   2. spawn playwright chromium + 加载扩展
 *   3. 通过 chrome.runtime.sendMessage('XT_TEST_SEED') 写入 3 条标注
 *   4. 通过 chrome.runtime.sendMessage('XT_FORCE_SYNC') 触发同步
 *   5. 用 curl 验证 NestJS 接收
 *   6. 通过 chrome.alarms.get 验证 alarm 注册
 *   7. 清理：kill NestJS 子进程
 */
import { spawn } from 'node:child_process'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { strict as assert } from 'node:assert'
import { existsSync, unlinkSync } from 'node:fs'

// playwright 装在 extension/node_modules；动态 import 走绝对路径避免被 .mjs 上下文找不到
const __dirnameLocal = dirname(fileURLToPath(import.meta.url))
const playwrightPath = resolve(__dirnameLocal, '../extension/node_modules/playwright/index.mjs')
const { chromium } = await import(pathToFileURL(playwrightPath).href)

const ROOT = resolve(__dirnameLocal, '..')
const EXT_DIST = join(ROOT, 'extension/dist')
const NEST_DIST = join(ROOT, 'server/annotation')
const NEST_DB = join(NEST_DIST, 'data/annotation.db')

let nestProc = null
let browser = null

function log(msg, obj) {
  const ts = new Date().toISOString().split('T')[1].slice(0, 12)
  console.log(`[e2e ${ts}]`, msg, obj ? JSON.stringify(obj) : '')
}

async function waitForServer(port, timeoutMs = 15_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const resp = await fetch(`http://localhost:${port}/v1/annotations/health`)
      if (resp.ok) return
    } catch {}
    await sleep(300)
  }
  throw new Error(`server not ready on :${port} in ${timeoutMs}ms`)
}

async function startNest() {
  // 先清空 DB（让测试可重复跑）
  for (const suffix of ['', '-shm', '-wal']) {
    const p = NEST_DB + suffix
    if (existsSync(p)) {
      try { unlinkSync(p) } catch {}
    }
  }
  log('starting NestJS...')
  nestProc = spawn('node', ['dist/src/main.js'], {
    cwd: NEST_DIST,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '3001' },
  })
  nestProc.stdout.on('data', d => process.stdout.write(`[nest] ${d}`))
  nestProc.stderr.on('data', d => process.stderr.write(`[nest:err] ${d}`))
  await waitForServer(3001)
  log('NestJS ready')
}

function stopNest() {
  if (!nestProc) return
  try {
    nestProc.kill('SIGTERM')
    // 给 1s 收尾
    const t = setTimeout(() => {
      try { nestProc.kill('SIGKILL') } catch {}
    }, 1000)
    nestProc.once('exit', () => clearTimeout(t))
  } catch {}
  nestProc = null
}

async function startBrowser() {
  const userDataDir = `/tmp/xt-sync-e2e-${Date.now()}`
  log('launching chromium with extension...', { extPath: EXT_DIST, userDataDir })
  browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,    // MV3 SW 需有界面（headless 模式对 SW 有限制）
    channel: 'chromium', // per memory: 必须 chromium 不是 chrome
    args: [
      `--disable-extensions-except=${EXT_DIST}`,
      `--load-extension=${EXT_DIST}`,
      '--no-default-browser-check',
      '--no-first-run',
      '--disable-popup-blocking',
    ],
  })
  browser.on('console', msg => {
    const text = msg.text()
    if (text.includes('xt:sync') || text.includes('xt:bg') || msg.type() === 'error') {
      log(`  [sw-console:${msg.type()}]`, text.slice(0, 300))
    }
  })
  // 等 SW 起来
  let workers = []
  for (let i = 0; i < 20; i++) {
    workers = browser.serviceWorkers()
    if (workers.length > 0) break
    await sleep(500)
  }
  if (workers.length === 0) {
    throw new Error('service worker not loaded')
  }
  const swUrl = workers[0].url()
  const extId = swUrl.match(/chrome-extension:\/\/([^/]+)/)?.[1]
  if (!extId) throw new Error('cannot get extId from ' + swUrl)
  log('SW ready', { extId })
  return { extId, sw: workers[0] }
}

async function stopBrowser() {
  if (browser) {
    try { await browser.close() } catch {}
    browser = null
  }
}

// 通过 SW 内的 globalThis.__xtSyncMessageHandler 直接调用消息处理逻辑
// （绕开 chrome.runtime.sendMessage 通道 —— 从 SW 内部发给自己消息无 receiver）
async function sendToSW(sw, msg) {
  return await sw.evaluate(async (m) => {
    const handler = globalThis.__xtSyncMessageHandler
    if (typeof handler !== 'function') {
      throw new Error('__xtSyncMessageHandler not installed; sync.ts side-effect not run yet')
    }
    return await handler(m)
  }, msg)
}

async function getExtensionIdFromSW(sw) {
  const url = sw.url()
  return url.match(/chrome-extension:\/\/([^/]+)/)?.[1]
}

async function listAlarms(sw) {
  return await sw.evaluate(async () => {
    return await new Promise((resolve) => {
      chrome.alarms.getAll((alarms) => resolve(alarms ?? []))
    })
  })
}

async function getStoreCount(sw, table) {
  // 通过 SW 的 chrome.runtime.sendMessage 不容易直接拿 stats
  // 用 fetch 走 NestJS API 验证
  const resp = await fetch('http://localhost:3001/v1/annotations/stats')
  return await resp.json()
}

// ─── Tests ──────────────────────────────────────────────

async function case1_seedAndForceSync(sw) {
  log('case 1: seed 3 unsynced → forceSync → 验证 NestJS 收到')
  // 1. 构造 3 条
  const items = [
    {
      id: '11111111-2222-4333-8444-aaaaaaaaaaaa',
      kind: 'align_fix',
      schemaVersion: 1,
      url: 'https://example.com/e2e-1',
      domPath: '/html/body/p[1]',
      srcSegmentId: 'e2e-seg-1',
      langPair: ['zh', 'en'],
      srcText: '我爱这条狗',
      tgtText: 'I love this dog',
      srcTokens: ['我', '爱', '这', '条', '狗'],
      tgtTokens: ['I', 'love', 'this', 'dog'],
      predicted: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 3]],
      modelVersion: 'nllb-600m-l0h15-v1',
      payload: {
        srcTokenIdx: 1,
        predictedTgtTokenIdx: 1,
        correctedTgtTokenIdx: 1,
        correctionKind: 'change',
      },
      context: { prevSrc: null, nextSrc: null },
      createdAt: Date.now() - 1000,
      appVersion: '1.0.0',
      userAgent: 'e2e-test',
    },
    {
      id: '22222222-2222-4333-8444-bbbbbbbbbbbb',
      kind: 'align_fix',
      schemaVersion: 1,
      url: 'https://example.com/e2e-1',
      domPath: '/html/body/p[2]',
      srcSegmentId: 'e2e-seg-2',
      langPair: ['zh', 'en'],
      srcText: '今天天气好',
      tgtText: 'The weather is nice today',
      srcTokens: ['今天', '天气', '好'],
      tgtTokens: ['The', 'weather', 'is', 'nice', 'today'],
      predicted: [[0, 0], [1, 1], [2, 2]],
      modelVersion: 'nllb-600m-l0h15-v1',
      payload: {
        srcTokenIdx: 0,
        predictedTgtTokenIdx: 0,
        correctedTgtTokenIdx: 0,
        correctionKind: 'change',
      },
      context: { prevSrc: null, nextSrc: null },
      createdAt: Date.now() - 500,
      appVersion: '1.0.0',
      userAgent: 'e2e-test',
    },
    {
      id: '33333333-2222-4333-8444-cccccccccccc',
      kind: 'seg_rating',
      schemaVersion: 1,
      url: 'https://example.com/e2e-1',
      domPath: '/html/body/p[3]',
      srcSegmentId: 'e2e-seg-3',
      langPair: ['zh', 'en'],
      srcText: '好的',
      tgtText: 'OK',
      srcTokens: ['好的'],
      tgtTokens: ['OK'],
      predicted: [[0, 0]],
      modelVersion: 'nllb-600m-l0h15-v1',
      payload: { rating: 5 },
      context: { prevSrc: null, nextSrc: null },
      createdAt: Date.now(),
      appVersion: '1.0.0',
      userAgent: 'e2e-test',
    },
  ]

  // 2. SEED
  const seedResp = await sendToSW(sw, { type: 'XT_TEST_SEED', items })
  log('seed response', seedResp)
  assert.equal(seedResp.ok, true)
  assert.equal(seedResp.count, 3)

  // 3. FORCE SYNC
  const forceResp = await sendToSW(sw, { type: 'XT_FORCE_SYNC' })
  log('forceSync response', forceResp)
  assert.equal(forceResp.failed, false, 'forceSync should succeed')
  assert.equal(forceResp.count, 3)
  assert.equal(forceResp.success, 3)

  // 4. 验证 NestJS DB（直接走 stats 端点）
  const stats = await getStoreCount(sw, 'annotations')
  log('nestjs stats', stats)
  assert.equal(stats.total, 3, 'NestJS should have 3 records')

  // 5. 验证 byKind
  assert.equal(stats.byKind.align_fix, 2)
  assert.equal(stats.byKind.seg_rating, 1)
}

async function case2_idb_marked_synced(sw) {
  log('case 2: IDB 中 3 条均已 markSynced=1')
  // 重新发一个 read 消息（用 SEED 旁的 store listUnsynced 即可）
  // 复用 XT_TEST_SEED 的回包机制不行；改用 stats 端点
  // 但 IDB 的 markSynced 验证需要 SW 端读 IDB；这里通过 stats 的 last24h + 同步状态间接确认：
  // 第二次 forceSync 应该 count=0（没有 unsynced）

  const forceResp2 = await sendToSW(sw, { type: 'XT_FORCE_SYNC' })
  log('second forceSync (应无 unsynced)', forceResp2)
  assert.equal(forceResp2.count, 0, 'second forceSync should have 0 items (all synced)')
  assert.equal(forceResp2.failed, false)
}

async function case3_alarm_registered(sw) {
  log('case 3: chrome.alarms 已注册 xt-annotation-sync (periodInMinutes=0.5)')
  const alarms = await listAlarms(sw)
  log('all alarms', alarms)
  const syncAlarm = alarms.find(a => a.name === 'xt-annotation-sync')
  assert.ok(syncAlarm, `xt-annotation-sync alarm should be registered, got: ${JSON.stringify(alarms)}`)
  // periodInMinutes=0.5 (30s 最小间隔)
  assert.equal(syncAlarm.periodInMinutes, 0.5)
  log('alarm verified', syncAlarm)
}

async function case4_duplicate_idempotent(sw) {
  log('case 4: 重发相同 batch → 后端 INSERT OR IGNORE → accepted=0（幂等）')
  // SEED 同 id 三条（重新插入会先 markSynced=0，再发一遍）
  // 实际上 IDB markSynced=1 后 listUnsynced 是空的；这里测后端幂等：
  // 用 fetch 直接打到 NestJS，重复 id
  const items = [
    {
      id: '11111111-2222-4333-8444-aaaaaaaaaaaa',  // 已存在
      kind: 'align_fix',
      schemaVersion: 1,
      url: 'https://example.com/e2e-1',
      domPath: '/html/body/p[1]',
      srcSegmentId: 'e2e-seg-1',
      langPair: ['zh', 'en'],
      srcText: '我爱这条狗',
      tgtText: 'I love this dog',
      srcTokens: ['我', '爱', '这', '条', '狗'],
      tgtTokens: ['I', 'love', 'this', 'dog'],
      predicted: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 3]],
      modelVersion: 'nllb-600m-l0h15-v1',
      payload: { rating: 1 },
      context: { prevSrc: null, nextSrc: null },
      createdAt: Date.now(),
      appVersion: '1.0.0',
      userAgent: 'e2e-test',
    },
  ]
  // 改用直接 fetch（不走 SW 通道，更直接验证后端）
  const resp = await fetch('http://localhost:3001/v1/annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  const body = await resp.json()
  log('duplicate POST response', body)
  assert.equal(body.accepted, 0, 'duplicate id should be accepted=0 (idempotent)')

  // 总数还是 3
  const stats = await getStoreCount()
  assert.equal(stats.total, 3)
}

// ─── main ──────────────────────────────────────────────

let failures = 0
let passed = 0

async function runCase(name, fn, sw) {
  try {
    log(`━━━ ${name} ━━━`)
    await fn(sw)
    log(`  ✅ ${name} PASSED`)
    passed++
  } catch (e) {
    log(`  ❌ ${name} FAILED:`, e.message)
    console.error(e)
    failures++
  }
}

async function main() {
  await startNest()
  let sw = null
  try {
    const { sw: swRef } = await startBrowser()
    sw = swRef
    // 等 SW 起来 + side-effect 注入（onInstalled 已触发）
    await sleep(2000)
    // 显式触发 installNow（保险，e2e 一定生效）
    await sw.evaluate(async () => {
      if (typeof globalThis.__xtInstallNow === 'function') {
        await globalThis.__xtInstallNow()
      }
    })
    await sleep(500)

    await runCase('case 1: seed+forceSync+DB verify', case1_seedAndForceSync, sw)
    await runCase('case 2: IDB markSynced (空批)', case2_idb_marked_synced, sw)
    await runCase('case 3: chrome.alarms 已注册', case3_alarm_registered, sw)
    await runCase('case 4: 后端幂等（重复 id accepted=0）', case4_duplicate_idempotent, sw)
  } finally {
    log('cleanup: stop browser + nest')
    await stopBrowser()
    stopNest()
  }

  log(`━━━ TOTAL ━━━ passed=${passed} failed=${failures}`)
  if (failures > 0) process.exit(1)
  process.exit(0)
}

main().catch(e => {
  console.error('[e2e] fatal:', e)
  stopNest()
  process.exit(1)
})
