// AI 翻译 Provider — MiniMax / 智谱 GLM / 火山引擎
// 模型：claude-sonnet-4-6
import { CONFIG } from './config.mjs'

const LANG_NAMES = {
  minimax: { 'zh-CN': 'Chinese', en: 'English', ja: 'Japanese', ko: 'Korean', fr: 'French', de: 'German', es: 'Spanish', ru: 'Russian' },
  zhipu: { 'zh-CN': '简体中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', de: 'Deutsch', es: 'Español', ru: 'Русский' },
  volcano: { 'zh-CN': 'zh', en: 'en', ja: 'ja', ko: 'ko', fr: 'fr', de: 'de', es: 'es', ru: 'ru' },
}

const PROVIDER_CFG = {
  minimax: { url: 'https://api.minimaxi.chat/v1/text/chatcompletion_v2', model: 'abab6.5s-chat', envKey: 'MINIMAX_API_KEY', concurrency: 3 },
  zhipu: { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash', envKey: 'ZHIPU_API_KEY', concurrency: 3 },
  volcano: { url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', model: process.env.VOLCANO_MODEL || 'doubao-pro', envKey: 'VOLCANO_API_KEY', concurrency: 3 },
}

// 并发控制
const semaphores = new Map()
function acquireSlot(provider, max) {
  let s = semaphores.get(provider)
  if (!s) { s = { queue: [], active: 0 }; semaphores.set(provider, s) }
  return new Promise(resolve => {
    if (s.active < max) { s.active++; resolve() }
    else s.queue.push(() => { s.active++; resolve() })
  })
}
function releaseSlot(provider) {
  const s = semaphores.get(provider)
  if (!s) return
  s.active--
  const next = s.queue.shift()
  if (next) next()
}

async function postJSON(url, headers, body, timeoutMs = 30000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!r.ok) {
      const e = await r.text().catch(() => '')
      throw new Error(`${r.status} ${e.slice(0, 200)}`)
    }
    return await r.json()
  } finally { clearTimeout(t) }
}

async function withRetry(fn, retries = 3) {
  let lastErr
  for (let i = 0; i < retries; i++) {
    try { return await fn() } catch (e) {
      lastErr = e
      if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * 2 ** i))
    }
  }
  throw lastErr
}

async function callProvider(provider, text, sourceLang, targetLang, apiKey) {
  const cfg = PROVIDER_CFG[provider]
  const srcName = LANG_NAMES[provider]?.[sourceLang] || sourceLang
  const tgtName = LANG_NAMES[provider]?.[targetLang] || targetLang

  return withRetry(async () => {
    const systemPrompt = provider === 'zhipu'
      ? `你是专业翻译。将以下文本从${srcName}翻译成${tgtName}。只输出译文，不要解释。保持换行。`
      : `You are a professional translator. Translate from ${srcName} to ${tgtName}. Output ONLY the translation, no explanations. Preserve line breaks.`

    const res = await postJSON(cfg.url, { Authorization: `Bearer ${apiKey}` }, {
      model: cfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
      max_tokens: Math.max(1024, Math.ceil(text.length * 3)),
    })
    return (res.choices?.[0]?.message?.content || '').trim()
  })
}

export async function translateAI({ text, sourceLang, targetLang, provider, apiKey }) {
  const t0 = Date.now()
  if (!text) return { target: '', engine: 'empty', ms: 0 }

  const resolved = provider || CONFIG.TRANSLATE_PROVIDER || 'mock'
  const key = apiKey || process.env[PROVIDER_CFG[resolved]?.envKey || ''] || ''
  const effective = key ? resolved : 'mock'

  if (effective === 'mock' || !PROVIDER_CFG[effective]) {
    const mockMap = { en: `[en] ${text}`, ja: `[ja] ${text}`, ko: `[ko] ${text}`, fr: `[fr] ${text}`, de: `[de] ${text}`, es: `[es] ${text}`, ru: `[ru] ${text}` }
    return { target: mockMap[targetLang] || `[${targetLang}] ${text}`, engine: 'mock-v1', ms: Date.now() - t0 }
  }

  try {
    await acquireSlot(effective, PROVIDER_CFG[effective].concurrency)
    const target = await callProvider(effective, text, sourceLang, targetLang, key)
    const ms = Date.now() - t0
    console.log(`[translate] ${effective} ${sourceLang}→${targetLang} chars=${text.length}→${target.length} ${ms}ms`)
    return { target, engine: `${effective}-v1`, ms }
  } catch (e) {
    const ms = Date.now() - t0
    console.error(`[translate] ${effective} failed: ${e.message} (${ms}ms), fallback mock`)
    return { target: `[${targetLang}] ${text}`, engine: 'mock-fallback-v1', ms }
  } finally { releaseSlot(effective) }
}

export function getAvailableProviders() {
  const list = ['mock']
  if (process.env.MINIMAX_API_KEY) list.push('minimax')
  if (process.env.ZHIPU_API_KEY) list.push('zhipu')
  if (process.env.VOLCANO_API_KEY) list.push('volcano')
  return list
}
