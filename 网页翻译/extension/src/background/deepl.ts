/**
 * DeepL 翻译后端
 *
 * 模型：Claude (Sonnet 4.5)
 *
 * 与 translator.ts（MiniMax）形态对齐，可由 background.ts 按 backend 设置切换。
 *
 * 优势：
 * - 原生批量（≤50 段/请求），不需要 MiniMax 的 <SEP> 拼接
 * - 翻译质量更好（DeepL 是商业级）
 * - Free 版 100 万字符/月免费
 * - 不需要 prompt 工程
 */
import type { LangCode } from '../shared/types'

export interface TranslateResult {
  segmentId: string
  translation: string
}

const DEEPL_FREE_ENDPOINT = 'https://api-free.deepl.com/v2/translate'
const DEEPL_PRO_ENDPOINT = 'https://api.deepl.com/v2/translate'
const MAX_BATCH = 50 // DeepL 单请求最多 50 段

/** 把内部 LangCode ('zh' / 'en' / 'ja' ...) 映射到 DeepL 大写代码 */
export function toDeepLLang(lang: LangCode): string {
  // DeepL 用大写 ISO 短码：ZH / EN / JA / KO / DE / FR / ES / RU / PT / IT ...
  // 我们的 LangCode 已经是小写 ISO，直接大写即可
  return lang.toUpperCase()
}

/** 根据 key 后缀判断 endpoint（:fx 是 Free 版） */
export function endpointForKey(apiKey: string): string {
  return apiKey.endsWith(':fx') ? DEEPL_FREE_ENDPOINT : DEEPL_PRO_ENDPOINT
}

/** Build-time 注入的默认 key（从 extension/.env.local 的 VITE_DEEPL_KEY） */
const DEFAULT_KEY: string = import.meta.env.VITE_DEEPL_KEY ?? ''

export function getDefaultKey(): string {
  return DEFAULT_KEY
}

/**
 * 翻译一批 segments，按 50 段切批调用 DeepL
 *
 * @param apiKey DeepL Auth Key（含 :fx 后缀为 Free 版）
 * @param retries 每批失败重试次数（指数退避）
 */
export async function* translateConcurrentDeepL(
  segments: Array<{ id: string; text: string; html?: string }>,
  _srcLang: LangCode,
  tgtLang: LangCode,
  apiKey: string,
  _concurrency = 4, // DeepL 单请求批量，不需要客户端并发
  retries = 3,
  _timeoutMs = 30_000,
): AsyncGenerator<TranslateResult> {
  if (segments.length === 0) return
  if (!apiKey) {
    throw new Error('DeepL API key is empty')
  }

  const targetLang = toDeepLLang(tgtLang)
  const endpoint = endpointForKey(apiKey)

  for (let i = 0; i < segments.length; i += MAX_BATCH) {
    const batch = segments.slice(i, i + MAX_BATCH)
    let attempt = 0
    let translations: string[] | null = null
    let lastErr: unknown = null

    while (attempt <= retries && !translations) {
      try {
        translations = await translateBatchDeepL(batch, targetLang, endpoint, apiKey)
      } catch (err) {
        lastErr = err
        attempt++
        const status = (err as Error & { status?: number }).status
        const rateLimited = status === 429 || status === 456
        console.warn(
          `[xt:deepl] 批次 ${i}-${i + batch.length} attempt=${attempt} 失败:`,
          err instanceof Error ? err.message : err,
        )
        if (attempt > retries) break
        // 429/456 → 指数退避；其他错误也退避但更短
        const backoff = rateLimited ? Math.min(8000, 1000 * 2 ** attempt) : 500
        await new Promise(r => setTimeout(r, backoff))
      }
    }

    if (!translations) {
      // 整批放弃，逐段置空让上层进度不卡死
      console.error(
        `[xt:deepl] 批次 ${i}-${i + batch.length} 放弃:`,
        lastErr instanceof Error ? lastErr.message : lastErr,
      )
      for (const seg of batch) {
        yield { segmentId: seg.id, translation: '' }
      }
      continue
    }

    for (let j = 0; j < batch.length; j++) {
      yield { segmentId: batch[j].id, translation: translations[j] ?? '' }
    }
  }
}

/** 单批 DeepL 调用（≤50 段） */
async function translateBatchDeepL(
  batch: Array<{ id: string; text: string; html?: string }>,
  targetLang: string,
  endpoint: string,
  apiKey: string,
): Promise<string[]> {
  // 有 html 字段时优先传 html（DeepL tag_handling=html 会保留结构），
  // 否则传纯文本
  const texts = batch.map(s => s.html ?? s.text)
  const useHtml = batch.some(s => s.html != null)

  const body: Record<string, unknown> = {
    text: texts,
    target_lang: targetLang,
  }

  if (useHtml) {
    body.tag_handling = 'html'
  } else {
    body.split_sentences = '1'
  }

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '')
    const err = new Error(`DeepL API error: ${resp.status} ${errBody}`) as Error & {
      status?: number
      rateLimited?: boolean
    }
    err.status = resp.status
    err.rateLimited = resp.status === 429 || resp.status === 456
    throw err
  }

  const data = (await resp.json()) as {
    translations: Array<{ text: string; detected_source_language: string }>
  }

  return data.translations.map(t => t.text)
}
