// 直接跑 translator.ts 的核心逻辑，不依赖 chrome API
// 复制 translator.ts 的关键函数（不能 import .ts，手抄一遍验证逻辑）
const MINIMAX_API = 'https://api.minimax.chat/v1/text/chatcompletion_v2'
const MODEL = 'MiniMax-Text-01'
// ⚠ 历史 key 已外泄，部署前轮换；测试从 env 读，缺失则 skip
const KEY = process.env.MINIMAX_API_KEY
if (!KEY) {
  console.error('[translator-live] 未设 MINIMAX_API_KEY，跳过 live 测试')
  process.exit(0)
}

const SYSTEM_PROMPT = `你是专业翻译引擎。严格遵守规则：
1. 只输出译文，不添加任何解释、前缀、注释
2. 保留原文的标点风格和段落结构
3. 专有名词、代码片段、URL、邮箱地址不翻译
4. 多段输入以 <SEP> 分隔，输出同样以 <SEP> 分隔，段数必须一致
5. 保持原文语气（正式/口语）`

function buildPrompt(segments, tgtLang) {
  const textBlock = segments.length === 1
    ? segments[0].text
    : segments.map(s => s.text).join('\n<SEP>\n')
  return `将以下内容翻译成${tgtLang}：\n\n${textBlock}`
}

function parseSseDelta(line) {
  if (!line.trim()) return null
  if (!line.startsWith('data: ')) return null
  const data = line.slice(6).trim()
  if (data === '[DONE]') return null
  try {
    const json = JSON.parse(data)
    const content = json?.choices?.[0]?.delta?.content ?? ''
    return content || null
  } catch {
    return null
  }
}

function splitTranslations(raw, count) {
  const parts = raw.split(/<SEP>/i).map(s => s.trim())
  const result = []
  for (let i = 0; i < count; i++) result.push(parts[i] ?? '')
  return result
}

// ─── 测试 1：单段翻译 ──────────────────────────────
async function testSingle() {
  console.log('=== 测试1: 单段翻译 ===')
  const segments = [{ id: 's1', text: 'Hello world, this is a test.' }]
  const prompt = buildPrompt(segments, '中文')

  const resp = await fetch(MINIMAX_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, stream: true,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
    }),
  })
  console.log('HTTP', resp.status)
  if (!resp.ok) { console.log(await resp.text()); return }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let fullText = '', buffer = ''
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

  console.log('LLM 原始输出:', JSON.stringify(fullText))
  const translations = splitTranslations(fullText, segments.length)
  console.log('splitTranslations 结果:', translations)

  if (!translations[0]) console.log('❌ 译文为空')
  else console.log('✅ 译文:', translations[0])
}

// ─── 测试 2：多段翻译（最可能暴露 bug）──────────────
async function testMulti() {
  console.log('\n=== 测试2: 多段翻译 ===')
  const segments = [
    { id: 's1', text: 'The quick brown fox jumps over the lazy dog.' },
    { id: 's2', text: 'Artificial intelligence is transforming every industry.' },
    { id: 's3', text: 'Open source software powers the modern web.' },
  ]
  const prompt = buildPrompt(segments, '中文')

  const resp = await fetch(MINIMAX_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, stream: true,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
    }),
  })
  if (!resp.ok) { console.log('HTTP', resp.status, await resp.text()); return }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let fullText = '', buffer = ''
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

  console.log('LLM 原始输出:')
  console.log('  ', JSON.stringify(fullText))
  console.log('  是否含 <SEP>:', /<SEP>/i.test(fullText))

  const translations = splitTranslations(fullText, segments.length)
  console.log('splitTranslations 结果:')
  translations.forEach((t, i) => console.log(`  [${i}]`, t ? `✅ ${t}` : '❌ 空'))
}

await testSingle().catch(e => console.error('测试1失败:', e))
await testMulti().catch(e => console.error('测试2失败:', e))
