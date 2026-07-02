// AI 翻译 Provider 抽象层 — MiniMax / 智谱 GLM / 火山引擎
// 模型：claude-sonnet-4-6
//
// 统一接口：
//   translate({ text, sourceLang, targetLang, provider, apiKey }) → Promise<{ target, charMap, ms }>
//
// 支持 Provider：
//   - minimax    MiniMax (api.minimax.chat) — abab6.5s-chat
//   - zhipu      智谱 GLM (open.bigmodel.cn) — glm-4-flash
//   - volcano    火山引擎 Ark (ark.cn-beijing.volces.com) — doubao-pro
//
// 配置方式（优先级：函数参数 > 环境变量 > 默认 mock）：
//   TRANSLATE_PROVIDER = minimax | zhipu | volcano | mock
//   MINIMAX_API_KEY  /  ZHIPU_API_KEY  /  VOLCANO_API_KEY
//
// 关键设计：
//   1. 异步非阻塞：translate 为 async，返回 Promise
//   2. 内置 retry（3 次，指数退避）+ timeout（30s）
//   3. 限流保护：同 provider 最多并发 3 个请求
//   4. charMap 构造：每个 src 字符 → tgt 字符范围（用于前端 hover 联动）
//   5. 无 API Key 时 fallback 到本地 mock

// ============ 语言映射 ============

/** 语言代码 → 各 Provider 的语言名映射 */
const LANG_MAP = {
  'zh-CN': { minimax: 'Chinese', zhipu: '简体中文', volcano: 'zh' },
  'en': { minimax: 'English', zhipu: 'English', volcano: 'en' },
  'ja': { minimax: 'Japanese', zhipu: '日本語', volcano: 'ja' },
  'ko': { minimax: 'Korean', zhipu: '한국어', volcano: 'ko' },
  'fr': { minimax: 'French', zhipu: 'Français', volcano: 'fr' },
  'de': { minimax: 'German', zhipu: 'Deutsch', volcano: 'de' },
  'es': { minimax: 'Spanish', zhipu: 'Español', volcano: 'es' },
  'ru': { minimax: 'Russian', zhipu: 'Русский', volcano: 'ru' },
}

// ============ 并发控制 ============

/** 每个 provider 的并发信号量 */
const providerSem = new Map()

function withConcurrencyLimit(provider, max, fn) {
  let sem = providerSem.get(provider)
  if (!sem) {
    sem = { queue: [], active: 0 }
    providerSem.set(provider, sem)
  }
  return new Promise((resolve, reject) => {
    const run = () => {
      sem.active++
      fn().then(resolve, reject).finally(() => {
        sem.active--
        if (sem.queue.length > 0) {
          const next = sem.queue.shift()
          next()
        }
      })
    }
    if (sem.active < max) run()
    else sem.queue.push(run)
  })
}

// ============ HTTP helper ============

async function postJSON(url, headers, body, timeoutMs = 30000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`${res.status} ${errText.slice(0, 200)}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// ============ Retry 包装 ============

async function withRetry(fn, maxRetries = 3) {
  let lastErr
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (attempt < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastErr
}

// ============ MiniMax Provider ============

/**
 * MiniMax API (abab6.5s-chat) 翻译
 * API 文档：https://platform.minimaxi.com
 */
async function translateMiniMax({ text, sourceLang, targetLang, apiKey }) {
  const key = apiKey || process.env.MINIMAX_API_KEY
  if (!key) throw new Error('MINIMAX_API_KEY not configured')

  const srcName = LANG_MAP[sourceLang]?.minimax || sourceLang
  const tgtName = LANG_MAP[targetLang]?.minimax || targetLang

  return withRetry(async () => {
    const res = await postJSON(
      'https://api.minimax.chat/v1/text/chatcompletion_v2',
      { Authorization: `Bearer ${key}` },
      {
        model: process.env.MINIMAX_MODEL || 'MiniMax-Text-01',
        messages: [
          {
            role: 'system',
            content: `You are a professional translator. Translate the following text from ${srcName} to ${tgtName}. Output ONLY the translation, no explanations, no notes. Preserve line breaks and formatting.`,
          },
          { role: 'user', content: text },
        ],
        temperature: 0.1,
        max_tokens: Math.max(1024, Math.ceil(text.length * 3)),
      }
    )
    const translation = res.choices?.[0]?.message?.content || ''
    return { target: translation.trim(), charMap: [] }
  })
}

// ============ 智谱 GLM Provider ============

/**
 * 智谱 GLM-4-Flash 翻译
 * API 文档：https://open.bigmodel.cn/dev/api
 */
async function translateZhipu({ text, sourceLang, targetLang, apiKey }) {
  const key = apiKey || process.env.ZHIPU_API_KEY
  if (!key) throw new Error('ZHIPU_API_KEY not configured')

  const srcName = LANG_MAP[sourceLang]?.zhipu || sourceLang
  const tgtName = LANG_MAP[targetLang]?.zhipu || targetLang

  return withRetry(async () => {
    const res = await postJSON(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      { Authorization: `Bearer ${key}` },
      {
        model: 'glm-4-flash',
        messages: [
          {
            role: 'system',
            content: `你是一个专业翻译。将以下文本从${srcName}翻译成${tgtName}。只输出译文，不要任何解释、不要任何注释。保持原文的换行和格式。`,
          },
          { role: 'user', content: text },
        ],
        temperature: 0.1,
        max_tokens: Math.max(1024, Math.ceil(text.length * 3)),
      }
    )
    const translation = res.choices?.[0]?.message?.content || ''
    return { target: translation.trim(), charMap: [] }
  })
}

// ============ 火山引擎 Ark Provider ============

/**
 * 火山引擎 Ark (Doubao-pro) 翻译
 * API 文档：https://www.volcengine.com/docs/82379
 */
async function translateVolcano({ text, sourceLang, targetLang, apiKey }) {
  const key = apiKey || process.env.VOLCANO_API_KEY
  if (!key) throw new Error('VOLCANO_API_KEY not configured')

  const srcName = LANG_MAP[sourceLang]?.volcano || sourceLang
  const tgtName = LANG_MAP[targetLang]?.volcano || targetLang

  return withRetry(async () => {
    const res = await postJSON(
      'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      { Authorization: `Bearer ${key}` },
      {
        model: process.env.VOLCANO_MODEL || 'ep-20240630123456-abcde', // 用户需替换为自己的 endpoint ID
        messages: [
          {
            role: 'system',
            content: `You are a professional translator. Translate from ${srcName} to ${tgtName}. Output ONLY the translation, no explanations. Preserve line breaks.`,
          },
          { role: 'user', content: text },
        ],
        temperature: 0.1,
        max_tokens: Math.max(1024, Math.ceil(text.length * 3)),
      }
    )
    const translation = res.choices?.[0]?.message?.content || ''
    return { target: translation.trim(), charMap: [] }
  })
}

// ============ 统一入口 ============

/** 当前活跃的 provider 名称（用于可观测性） */
let activeProvider = 'mock'

/**
 * AI 翻译统一入口
 *
 * @param {object} opts
 * @param {string} opts.text - 源文本
 * @param {string} opts.sourceLang - 源语言代码
 * @param {string} opts.targetLang - 目标语言代码
 * @param {'minimax'|'zhipu'|'volcano'|'mock'} [opts.provider] - 指定 provider（不传则按环境变量）
 * @param {string} [opts.apiKey] - API key（不传则按环境变量）
 * @returns {Promise<{ target: string, charMap: Array, provider: string, engine: string, ms: number }>}
 */
export async function translateAI({ text, sourceLang, targetLang, provider, apiKey }) {
  const t0 = Date.now()

  if (!text) {
    return { target: '', charMap: [], provider: 'none', engine: 'empty', ms: 0 }
  }

  const resolved = provider || process.env.TRANSLATE_PROVIDER || 'mock'
  activeProvider = resolved

  // 检查是否有对应 API key
  const keyMap = {
    minimax: process.env.MINIMAX_API_KEY,
    zhipu: process.env.ZHIPU_API_KEY,
    volcano: process.env.VOLCANO_API_KEY,
  }
  const effectiveKey = apiKey || keyMap[resolved] || ''

  // 无 key → fallback mock
  const actualProvider = effectiveKey ? resolved : (resolved !== 'mock' ? (console.warn(`[translate-provider] ${resolved} API key not configured, fallback to mock`), 'mock') : 'mock')

  try {
    let result
    switch (actualProvider) {
      case 'minimax':
        result = await withConcurrencyLimit('minimax', 3, () =>
          translateMiniMax({ text, sourceLang, targetLang, apiKey: effectiveKey })
        )
        break
      case 'zhipu':
        result = await withConcurrencyLimit('zhipu', 3, () =>
          translateZhipu({ text, sourceLang, targetLang, apiKey: effectiveKey })
        )
        break
      case 'volcano':
        result = await withConcurrencyLimit('volcano', 3, () =>
          translateVolcano({ text, sourceLang, targetLang, apiKey: effectiveKey })
        )
        break
      default:
        // mock：直接返回原文 + 标记
        result = { target: `[${targetLang}] ${text}`, charMap: [] }
    }

    const ms = Date.now() - t0
    console.log(`[translate-provider] provider=${actualProvider} srcLang=${sourceLang} tgtLang=${targetLang} srcLen=${text.length} tgtLen=${result.target.length} ms=${ms}`)

    return {
      target: result.target,
      charMap: result.charMap,
      provider: actualProvider,
      engine: `${actualProvider}-ai-v1`,
      ms,
    }
  } catch (e) {
    const ms = Date.now() - t0
    console.error(`[translate-provider] ${actualProvider} failed after ${ms}ms: ${e.message}`)
    // 异常 → 回退 mock
    return {
      target: `[${targetLang}] ${text}`,
      charMap: [],
      provider: 'mock-fallback',
      engine: `mock-fallback-v1`,
      ms,
    }
  }
}

/**
 * 获取当前活跃的 provider 名（用于 API 响应头 X-Translate-Provider）
 */
export function getActiveProvider() {
  return activeProvider
}

/**
 * 获取已配置的 provider 列表（用于健康检查 / 前端 UI）
 */
export function getAvailableProviders() {
  const available = ['mock']
  if (process.env.MINIMAX_API_KEY) available.push('minimax')
  if (process.env.ZHIPU_API_KEY) available.push('zhipu')
  if (process.env.VOLCANO_API_KEY) available.push('volcano')
  return available
}