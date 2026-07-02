/**
 * DeepL 翻译客户端（与 W1-3 扩展 backend 一致，把 MiniMax 替换掉）
 *
 * 设计：
 * 1. Free / Pro endpoint：按 key 后缀 `:fx` 自动选
 * 2. 批量 ≤50 段/请求（DeepL 上限 50）
 * 3. 中文友好 lang map：ZH / EN-US / JA
 * 4. 429/456 限流指数退避重试（最多 3 次）
 * 5. 结构化日志，便于追踪
 */

const ENDPOINT_FREE = 'https://api-free.deepl.com/v2/translate'
const ENDPOINT_PRO = 'https://api.deepl.com/v2/translate'

/** 用户友好语言名 → DeepL target_lang 代码 */
const LANG_MAP = {
  '中文': 'ZH',
  'ZH': 'ZH',
  'zh': 'ZH',
  'English': 'EN-US',
  'EN': 'EN-US',
  'en': 'EN-US',
  '日本語': 'JA',
  'JA': 'JA',
  'ja': 'JA',
}

export function pickEndpoint(key) {
  return key.endsWith(':fx') ? ENDPOINT_FREE : ENDPOINT_PRO
}

export function mapLang(tgtLang) {
  return LANG_MAP[tgtLang] || LANG_MAP[tgtLang + ''] || 'ZH'
}

/**
 * 调一次 DeepL，翻译 ≤50 段
 * @param {string[]} batch
 * @param {string} tgtLang  用户友好名（'中文' / 'English' / '日本語'）
 * @param {string} apiKey
 * @param {{ log?: { warn?: Function, info?: Function }, maxRetries?: number, fetch?: typeof fetch }} [opts]
 * @returns {Promise<string[]>} 等于 batch 长度
 */
export async function callDeepL(batch, tgtLang, apiKey, opts = {}) {
  const log = opts.log || console
  const maxRetries = opts.maxRetries ?? 3
  const fetchImpl = opts.fetch || fetch
  const targetLang = mapLang(tgtLang)
  const endpoint = pickEndpoint(apiKey)

  const body = new URLSearchParams()
  for (const t of batch) body.append('text', t)
  body.append('target_lang', targetLang)
  body.append('tag_handling', 'html')
  body.append('ignore_tags', 'code,pre,kbd,samp')

  let lastErr
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(2000, 200 * Math.pow(2, attempt))
      log.warn?.(`[deepl] 重试 ${attempt}/${maxRetries}，等 ${backoff}ms`)
      await new Promise(r => setTimeout(r, backoff))
    }
    try {
      const r = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      })
      if (r.status === 429 || r.status === 456) {
        lastErr = new Error(`DeepL ${r.status} rate-limited`)
        lastErr.code = 'RATE_LIMIT'
        continue
      }
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        const err = new Error(`DeepL ${r.status}: ${text.slice(0, 200)}`)
        err.code = 'DEEPL_' + r.status
        throw err
      }
      const data = await r.json()
      const translations = (data?.translations || []).map(t => t.text)
      // 不足补空字符串
      return batch.map((_, i) => translations[i] ?? '')
    } catch (e) {
      if (e.code === 'RATE_LIMIT') continue
      lastErr = e
      // 网络层错误也重试
      if (e.cause?.code === 'ECONNRESET' || e.cause?.code === 'ETIMEDOUT') continue
      throw e
    }
  }
  throw lastErr || new Error('DeepL failed after retries')
}
