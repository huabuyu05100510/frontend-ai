import { translateConcurrent } from './translator'
import { translateConcurrentDeepL, getDefaultKey as getDefaultDeepLKey } from './deepl'
import { cacheKey } from '../shared/types'
import type { ExtensionMessage, TranslationBackend } from '../shared/types'
import './sync'   // 标注同步层：注册 chrome.alarms + message handler + online 事件（side-effect import）

// 翻译后端选择（默认 DeepL，质量更好 + Free 版 100 万字符/月）
const BACKEND_STORAGE = 'xt_backend'
const DEEPL_KEY_STORAGE = 'xt_deepl_key'
const MINIMAX_KEY_STORAGE = 'xt_minimax_key'

const log = (level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}) => {
  try {
    console[level](JSON.stringify({ ts: Date.now(), level, component: 'xt:bg', msg, ...fields }))
  } catch {}
}

// ─── 热重载（dev 模式）──────────────────────────────────────
// 监听 dist/hotreload.txt 变化，自动 chrome.runtime.reload()
// 生产环境 dist 里没有该文件，fetch 失败即停止轮询
let lastSnapshot = ''
async function checkHotReload() {
  try {
    const url = chrome.runtime.getURL('hotreload.txt')
    const resp = await fetch(url)
    if (!resp.ok) return
    const text = await resp.text()
    if (lastSnapshot && text !== lastSnapshot) {
      console.log('[xt:bg] 🔥 检测到代码变化，重载扩展')
      chrome.runtime.reload()
    }
    lastSnapshot = text
  } catch {
    // 生产构建无此文件，忽略
  }
}
setInterval(checkHotReload, 2000)

// ─── 扩展重载后，自动刷新已注入的页面 ──────────────────────
// 否则用户每次改代码还要手动刷新目标 tab 才能看到新 content script
// 只在 reason='update' 触发（chrome.runtime.reload() 走这个分支），
// 避免 install/chrome_update 误伤
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'update') return
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] })
    for (const t of tabs) {
      if (!t.id) continue
      try {
        await chrome.tabs.sendMessage(t.id, { type: 'PING' })
        // 能 ping 通说明本扩展已注入该页 → 刷新让新版 content script 生效
        await chrome.tabs.reload(t.id)
        log('info', 'auto-reload tab', { tabId: t.id, url: t.url })
      } catch {
        // 未注入或 tab 自己挂了 → 跳过
      }
    }
  } catch (e) {
    log('warn', 'onInstalled auto-reload failed', { err: String(e) })
  }
})

// ─── 词级对齐（W1-5）─────────────────────────────────────────
// 本地 LaBSE 服务（可选增强）；不可用时自动降级到位置启发式对齐，
// 确保 hover 高亮 + 标注 UI 在无本地服务时也能工作。
const LABSE_ENDPOINT = 'http://127.0.0.1:8788/align'
const ALIGN_CACHE_PREFIX = 'xt_align::'

/**
 * 将文本切成 token 数组：CJK 逐字，其余按空白分词。
 * 简单、轻量，供启发式对齐使用。
 */
function tokenizeSimple(text: string): string[] {
  const out: string[] = []
  const parts = text.trim().split(/\s+/)
  for (const part of parts) {
    if (!part) continue
    let i = 0
    while (i < part.length) {
      const cp = part.codePointAt(i) ?? 0
      // CJK Unified Ideographs & Extension A
      if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) {
        out.push(part[i])
        i++
      } else {
        // Collect a non-CJK run
        let j = i + 1
        while (j < part.length) {
          const c = part.codePointAt(j) ?? 0
          if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) break
          j++
        }
        out.push(part.slice(i, j))
        i = j
      }
    }
  }
  return out.length > 0 ? out : (text.trim() ? [text.trim()] : [])
}

/**
 * 位置启发式对齐（diagonal alignment）。
 * 当 LaBSE 服务不可用时作为 fallback，保证 [data-xt-tok] spans 能创建，
 * hover 高亮 + 标注 UI 可以正常工作（质量略低于 LaBSE，但远好于无对齐）。
 */
function heuristicAlign(
  src: string,
  tgt: string,
  segmentId: string,
): { segmentId: string; srcTokens: string[]; tgtTokens: string[]; alignments: { srcIdx: number; tgtIdx: number; score: number }[] } {
  const srcTokens = tokenizeSimple(src)
  const tgtTokens = tokenizeSimple(tgt)
  if (srcTokens.length === 0 || tgtTokens.length === 0) {
    return { segmentId, srcTokens, tgtTokens, alignments: [] }
  }
  const srcLen = srcTokens.length
  const tgtLen = tgtTokens.length
  const alignments: { srcIdx: number; tgtIdx: number; score: number }[] = []
  for (let i = 0; i < srcLen; i++) {
    const j = Math.min(Math.floor(i * tgtLen / srcLen), tgtLen - 1)
    alignments.push({ srcIdx: i, tgtIdx: j, score: 0.5 })
    // 多对一：额外覆盖右邻 token（CJK 目标语言一词对多字）
    if (j + 1 < tgtLen) {
      alignments.push({ srcIdx: i, tgtIdx: j + 1, score: 0.4 })
    }
  }
  return { segmentId, srcTokens, tgtTokens, alignments }
}

async function handleAlignQuery(
  msg: Extract<ExtensionMessage, { type: 'ALIGN_QUERY' }>,
  tabId: number | undefined,
) {
  if (!tabId) return
  const { segmentId, src, tgt } = msg

  // 缓存：按 src+tgt hash（同段重译不重复打模型）
  const cacheKey = ALIGN_CACHE_PREFIX + segmentId
  try {
    const cached = await chrome.storage.local.get(cacheKey)
    if (cached[cacheKey]) {
      chrome.tabs.sendMessage(tabId, {
        type: 'ALIGN_RESPONSE',
        result: { segmentId, ...(cached[cacheKey] as object) },
      })
      log('info', 'align cache hit', { segmentId })
      return
    }
  } catch {}

  const t0 = Date.now()
  try {
    // 3s 超时：LaBSE 服务若不在线快速失败，不阻塞用户体验
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)
    let resp: Response
    try {
      resp = await fetch(LABSE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src, tgt, strategy: 'argmax' }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }
    if (!resp.ok) {
      throw new Error(`align service ${resp.status}: ${await resp.text()}`)
    }
    const data = await resp.json()
    const result = {
      segmentId,
      srcTokens: data.srcTokens,
      tgtTokens: data.tgtTokens,
      alignments: data.alignments,
      took: data.took,
    }
    // 落 cache
    await chrome.storage.local.set({
      [cacheKey]: {
        srcTokens: result.srcTokens,
        tgtTokens: result.tgtTokens,
        alignments: result.alignments,
      },
    })
    log('info', 'align ok', { segmentId, pairs: result.alignments.length, tookMs: Date.now() - t0 })
    chrome.tabs.sendMessage(tabId, { type: 'ALIGN_RESPONSE', result })
  } catch (err) {
    // LaBSE 服务不可用 → 降级到位置启发式对齐，确保 hover + 标注 UI 可用
    log('info', 'align server unavailable, using heuristic fallback', { segmentId, err: String(err) })
    const result = heuristicAlign(src, tgt, segmentId)
    chrome.tabs.sendMessage(tabId, { type: 'ALIGN_RESPONSE', result }).catch(() => {})
  }
}

// ─── 消息处理 ──────────────────────────────────────────────

// ─── 消息处理 ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg: ExtensionMessage, sender, _sendResponse) => {
  if (msg.type === 'TRANSLATE_BATCH') {
    handleTranslateBatch(msg, sender.tab?.id).catch(err => {
      console.error('[xt:bg] 翻译失败', err)
    })
    return false
  }
  if (msg.type === 'ALIGN_QUERY') {
    handleAlignQuery(msg, sender.tab?.id)
    return false
  }
  return false
})

// ─── 快捷键 ────────────────────────────────────────────────
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-translate' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'COMMAND', command })
  }
})

// ─── 翻译批次处理 ─────────────────────────────────────────
async function handleTranslateBatch(
  msg: Extract<ExtensionMessage, { type: 'TRANSLATE_BATCH' }>,
  tabId: number | undefined,
) {
  if (!tabId) return

  const { segments, srcLang, tgtLang } = msg
  console.log(`[xt:bg] 翻译 ${segments.length} 段 ${srcLang}→${tgtLang}`)

  const backend = await getBackend()
  const apiKey = await getApiKey(backend)
  if (!apiKey) {
    console.error(`[xt:bg] 未配置 ${backend} API key`)
    notifyError(tabId, `未配置 ${backend} API key`)
    return
  }

  // ── 缓存优先 ──────────────────────────────────────────
  const uncached: typeof segments = []
  const cached = new Map<string, string>()

  const cache = await chrome.storage.local.get(
    segments.map(s => cacheKey(s.text, srcLang, tgtLang)),
  )

  for (const seg of segments) {
    const key = cacheKey(seg.text, srcLang, tgtLang)
    if (cache[key]) {
      cached.set(seg.id, cache[key] as string)
    } else {
      uncached.push(seg)
    }
  }

  // 命中缓存的立即推送
  for (const [segmentId, translation] of cached) {
    console.log(`[xt:bg] 缓存命中 ${segmentId}`)
    chrome.tabs.sendMessage(tabId, {
      type: 'TRANSLATION_CHUNK',
      chunk: { segmentId, delta: '', done: true, full: translation },
    })
  }

  if (uncached.length === 0) return

  // ── 调用翻译 API（按 backend 分发）──────────────────
  try {
    const toCache: Record<string, string> = {}
    let done = 0

    const iterator = backend === 'deepl'
      ? translateConcurrentDeepL(uncached, srcLang, tgtLang, apiKey, 4, 3)
      : translateConcurrent(uncached, srcLang, tgtLang, apiKey, 4, 1)

    for await (const result of iterator) {
      const { segmentId, translation } = result
      done++
      console.log(
        `[xt:bg] [${backend}] 翻译完成 ${done}/${uncached.length} ${segmentId}: "${translation.slice(0, 30)}..."`,
      )

      const seg = uncached.find(s => s.id === segmentId)
      if (seg && translation) {
        toCache[cacheKey(seg.text, srcLang, tgtLang)] = translation
      }

      chrome.tabs.sendMessage(tabId, {
        type: 'TRANSLATION_CHUNK',
        chunk: { segmentId, delta: '', done: true, full: translation },
      })
    }

    if (Object.keys(toCache).length > 0) {
      await chrome.storage.local.set(toCache)
    }
    console.log(`[xt:bg] [${backend}] 批次完成 ${done}/${uncached.length} 段`)
  } catch (err) {
    console.error(`[xt:bg] ${backend} API 调用失败`, err)
    notifyError(tabId, `${backend} API 调用失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function notifyError(tabId: number, message: string) {
  chrome.tabs.sendMessage(tabId, { type: 'TRANSLATION_ERROR', message }).catch(() => {})
}

async function getBackend(): Promise<TranslationBackend> {
  const result = await chrome.storage.local.get(BACKEND_STORAGE)
  const backend = (result[BACKEND_STORAGE] as TranslationBackend) ?? 'deepl'
  log('info', 'backend selected', { backend })
  return backend
}

async function getApiKey(backend: TranslationBackend): Promise<string | null> {
  const storageKey = backend === 'deepl' ? DEEPL_KEY_STORAGE : MINIMAX_KEY_STORAGE
  const result = await chrome.storage.local.get(storageKey)
  const stored = result[storageKey] as string | undefined

  // DeepL 有 build-time 注入的默认 key（VITE_DEEPL_KEY），方便首次使用不强制配置
  if (backend === 'deepl') {
    const key = stored ?? getDefaultDeepLKey()
    if (key) {
      log('info', 'deepl api key loaded', {
        masked: '***' + key.slice(-4),
        source: stored ? 'storage' : 'build-env',
      })
    }
    return key || null
  }

  // MiniMax 必须用户自己输入（旧 hardcoded key 已废弃，避免泄漏）
  if (stored) {
    log('info', 'minimax api key loaded', { masked: '***' + stored.slice(-4), source: 'storage' })
  }
  return stored ?? null
}
