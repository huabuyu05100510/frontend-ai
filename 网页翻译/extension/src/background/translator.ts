import type { LangCode } from '../shared/types'

const MINIMAX_API = 'https://api.minimax.chat/v1/text/chatcompletion_v2'
const MODEL = 'MiniMax-Text-01'

// ─── System Prompt ──────────────────────────────────────────
const SYSTEM_PROMPT = `你是专业翻译引擎。严格遵守规则：
1. 只输出译文，不添加任何解释、前缀、注释
2. 保留原文的标点风格和段落结构
3. 专有名词、代码片段、URL、邮箱地址不翻译
4. 多段输入以 <SEP> 分隔，输出同样以 <SEP> 分隔，段数必须一致
5. 保持原文语气（正式/口语）`

// 单段翻译专用 prompt：不提 <SEP>，避免模型偶尔把规则字面输出
const SINGLE_SYSTEM_PROMPT = `你是专业翻译引擎。严格遵守规则：
1. 只输出译文，不添加任何解释、前缀、注释、分隔符
2. 保留原文的标点风格和段落结构
3. 专有名词、代码片段、URL、邮箱地址不翻译
4. 保持原文语气（正式/口语）`

// ─── Prompt 构建 ────────────────────────────────────────────

export function buildPrompt(
  segments: Array<{ id: string; text: string }>,
  tgtLang: LangCode,
  glossary: Map<string, string> | null,
): string {
  const glossaryLine =
    glossary && glossary.size > 0
      ? `\n术语表（必须按此翻译）：${[...glossary.entries()].map(([k, v]) => `${k}→${v}`).join('，')}`
      : ''

  const textBlock =
    segments.length === 1
      ? segments[0].text
      : segments.map(s => s.text).join('\n<SEP>\n')

  return `将以下内容翻译成${tgtLang}${glossaryLine}：\n\n${textBlock}`
}

// ─── SSE 解析 ───────────────────────────────────────────────

/** 从 SSE 行解析出 delta 内容，无内容返回 null */
export function parseSseDelta(line: string): string | null {
  if (!line.trim()) return null
  if (!line.startsWith('data: ')) return null
  const data = line.slice(6).trim()
  if (data === '[DONE]') return null
  try {
    const json = JSON.parse(data)
    const content: string = json?.choices?.[0]?.delta?.content ?? ''
    return content || null
  } catch {
    return null
  }
}

// ─── 多段拆分 ───────────────────────────────────────────────

/**
 * 把 LLM 输出的多段译文按 <SEP> 拆分回对应 segments
 * LLM 少输出时补空字符串，多输出时截断
 */
export function splitTranslations(raw: string, count: number): string[] {
  const parts = raw.split(/<SEP>/i).map(s => s.trim())
  const result: string[] = []
  for (let i = 0; i < count; i++) {
    result.push(parts[i] ?? '')
  }
  return result
}

// ─── MiniMax 流式翻译 ────────────────────────────────────────

export interface TranslateResult {
  segmentId: string
  translation: string
}

/**
 * 翻译一批 segments，流式 yield 每个 segment 的完整译文。
 * 流式 token 在内部积累，完成后一次性返回（保证 SEP 拆分正确性）。
 * 如需逐 token 推送，调用方自行切割。
 */
export async function* translateBatch(
  segments: Array<{ id: string; text: string }>,
  _srcLang: LangCode,
  tgtLang: LangCode,
  apiKey: string,
  glossary: Map<string, string> | null = null,
): AsyncGenerator<TranslateResult> {
  const prompt = buildPrompt(segments, tgtLang, glossary)

  const resp = await fetch(MINIMAX_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
  })

  if (!resp.ok) {
    throw new Error(`MiniMax API error: ${resp.status} ${await resp.text()}`)
  }

  // 读取完整流式输出
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const delta = parseSseDelta(line)
      if (delta) fullText += delta
    }
  }

  // 最后一行
  if (buffer.trim()) {
    const delta = parseSseDelta(buffer)
    if (delta) fullText += delta
  }

  // 拆分多段，逐个 yield
  const translations = splitTranslations(fullText, segments.length)
  for (let i = 0; i < segments.length; i++) {
    yield { segmentId: segments[i].id, translation: translations[i] }
  }
}

// ─── 单段翻译 ───────────────────────────────────────────────

/**
 * 翻译单个 segment，流式读取完整译文。
 * 不使用 <SEP>，彻底避免拆分错位。
 * 失败抛错，由调用方决定重试 / 回滚。
 */
export async function translateSingle(
  segment: { id: string; text: string },
  _srcLang: LangCode,
  tgtLang: LangCode,
  apiKey: string,
  glossary: Map<string, string> | null = null,
  signal?: AbortSignal,
): Promise<string> {
  const prompt = buildPrompt([segment], tgtLang, glossary)

  const resp = await fetch(MINIMAX_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      messages: [
        { role: 'system', content: SINGLE_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
    signal,
  })

  if (!resp.ok) {
    const errBody = await resp.text()
    const err = new Error(`MiniMax API error: ${resp.status} ${errBody}`)
    ;(err as Error & { rateLimited?: boolean }).rateLimited =
      resp.status === 429 || /rate|速率|2062/i.test(errBody)
    throw err
  }

  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  // 注意：MiniMax 速率限制时 streaming 返回 200 + 空 data，需在流尾检测
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const delta = parseSseDelta(line)
      if (delta) fullText += delta
    }
  }
  if (buffer.trim()) {
    const delta = parseSseDelta(buffer)
    if (delta) fullText += delta
  }

  // 单段场景：模型偶尔仍会输出 <SEP>（系统 prompt 里有多段规则的暗示）
  // 只取第一个 <SEP> 之前的内容，避免污染
  const first = fullText.split(/<SEP>/i)[0].trim()
  if (!first) {
    // 流式返回空内容 → 多半是速率限制（HTTP 200 但无 token 输出）
    const err = new Error('MiniMax empty stream (likely rate-limited)')
    ;(err as Error & { rateLimited?: boolean }).rateLimited = true
    throw err
  }
  return first
}

// ─── 并发翻译（一段一请求）───────────────────────────────────

export interface ConcurrentOptions {
  concurrency?: number
  retries?: number
  timeoutMs?: number
}

/**
 * 一段一请求 + 并发限流 + 失败重试。
 *
 * 替代 translateBatch 的 <SEP> 批量方案，根除：
 *  - LLM 漏 <SEP> 导致译文错位
 *  - 单段失败拖死整批
 *
 * 失败 retries 次后 yield 空译文（不抛错），让上层进度不卡死。
 * 结果顺序与输入一致（内部按 index 收集）。
 */
export async function* translateConcurrent(
  segments: Array<{ id: string; text: string }>,
  srcLang: LangCode,
  tgtLang: LangCode,
  apiKey: string,
  concurrency = 2,
  retries = 3,
  timeoutMs = 30_000,
  glossary: Map<string, string> | null = null,
): AsyncGenerator<TranslateResult> {
  const results: TranslateResult[] = new Array(segments.length)
  let cursor = 0

  async function worker() {
    while (true) {
      const idx = cursor++
      if (idx >= segments.length) return
      const seg = segments[idx]
      let lastErr: unknown = null

      for (let attempt = 0; attempt <= retries; attempt++) {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), timeoutMs)
        try {
          console.log(
            `[xt:translator] ${seg.id} attempt=${attempt} "${seg.text.slice(0, 40)}..."`,
          )
          const translation = await translateSingle(
            seg, srcLang, tgtLang, apiKey, glossary, ctrl.signal,
          )
          clearTimeout(timer)
          results[idx] = { segmentId: seg.id, translation }
          lastErr = null
          break
        } catch (err) {
          clearTimeout(timer)
          lastErr = err
          const rateLimited = (err as Error & { rateLimited?: boolean }).rateLimited
          console.warn(
            `[xt:translator] ${seg.id} attempt=${attempt} 失败${rateLimited ? '(速率限制)' : ''}:`,
            err instanceof Error ? err.message : err,
          )
          if (rateLimited) {
            // 指数退避：1s, 2s, 4s, 8s
            const backoff = Math.min(8000, 1000 * 2 ** attempt)
            console.log(`[xt:translator] ${seg.id} 退避 ${backoff}ms`)
            await new Promise(r => setTimeout(r, backoff))
          }
        }
      }

      if (lastErr) {
        console.error(`[xt:translator] ${seg.id} 放弃（${retries + 1}次重试耗尽），置空`)
        results[idx] = { segmentId: seg.id, translation: '' }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, segments.length) }, worker))

  // 全部完成后按顺序 yield（顺序一致性优先）
  for (const r of results) {
    yield r!
  }
}
