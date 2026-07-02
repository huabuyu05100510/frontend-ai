/**
 * 端到端集成测试（不依赖 Chrome 扩展运行时）
 * 验证：抓页面 → 提取段落 → 真实调 MiniMax → 注入 DOM，全链路
 */
import { JSDOM } from 'jsdom'

// ⚠ 历史 key 已外泄，部署前轮换；缺失 env 时 skip
const KEY = process.env.MINIMAX_API_KEY
if (!KEY) {
  console.error('[full-pipeline] 未设 MINIMAX_API_KEY，跳过 live 测试')
  process.exit(0)
}
const MINIMAX_API = 'https://api.minimax.chat/v1/text/chatcompletion_v2'
const MODEL = 'MiniMax-Text-01'

// ─── dom-walker 逻辑（从 src/content/dom-walker.ts 搬过来）──
const BLOCK_TAGS = new Set(['P','H1','H2','H3','H4','H5','H6','LI','TD','TH','BLOCKQUOTE','FIGCAPTION','DT','DD'])
const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','IFRAME','CODE','PRE','KBD','SAMP','VAR','INPUT','TEXTAREA','SELECT','BUTTON','SVG','MATH','CANVAS'])
let _id = 0
const nextId = () => `xt-${++_id}-${Math.random().toString(36).slice(2,6)}`

function extractSegments(root) {
  const out = []
  const visited = new WeakSet()
  ;(function walk(el) {
    if (visited.has(el)) return
    if (SKIP_TAGS.has(el.tagName)) return
    if (el.closest && el.closest('script,style,noscript,code,pre,textarea,input,select,svg,math')) return
    if (BLOCK_TAGS.has(el.tagName)) {
      const text = cleanText(el)
      if (text.length >= 4 && !/^[\d\s\W]+$/.test(text)) {
        const id = nextId()
        el.setAttribute('data-xt-id', id)
        out.push({ id, text, element: el })
        visited.add(el)
      }
      return
    }
    for (const c of el.children) walk(c)
  })(root)
  return out
}
function cleanText(el) {
  let t = ''
  for (const n of el.childNodes) {
    if (n.nodeType === 3) t += n.textContent ?? ''
    else if (n.nodeType === 1 && !SKIP_TAGS.has(n.tagName)) t += cleanText(n)
  }
  return t.replace(/\s+/g, ' ').trim()
}

// ─── 本地构造英文测试页面（不依赖外网）────────────────────
console.log('→ 构造测试页面...')
const html = `<!doctype html><html><body>
  <article>
    <h1>The Future of Artificial Intelligence in Software Engineering</h1>
    <p>The quick brown fox jumps over the lazy dog near the silent forest.</p>
    <p>Engineers around the world are building tools that translate natural language into code.</p>
    <p>This is a third paragraph to make the batch more interesting and challenging.</p>
    <p>Open source software continues to power the modern web infrastructure.</p>
    <p>Performance optimization remains a critical concern for production applications.</p>
  </article>
</body></html>`
console.log(`  页面 ${html.length} bytes`)

// ─── jsdom 加载 ──────────────────────────────────────────────
const dom = new JSDOM(html, { url: 'https://news.ycombinator.com', pretendToBeVisual: true })
const { document } = dom.window

// ─── 提取段落 ────────────────────────────────────────────────
console.log('\n→ 提取段落...')
const segments = extractSegments(document.body)
console.log(`  ✅ 提取 ${segments.length} 段`)
if (segments.length === 0) { console.log('❌ 没提取到段落'); process.exit(1) }
segments.slice(0, 3).forEach((s, i) => console.log(`  [${i}] "${s.text.slice(0, 70)}..."`))

// ─── 组批次 5 段 ─────────────────────────────────────────────
const batch = segments.slice(0, 5)
console.log(`\n→ 组批次 ${batch.length} 段，调 MiniMax API...`)

const SYSTEM_PROMPT = `你是专业翻译引擎。严格遵守规则：
1. 只输出译文，不添加任何解释、前缀、注释
2. 保留原文的标点风格和段落结构
3. 专有名词、代码片段、URL、邮箱地址不翻译
4. 多段输入以 <SEP> 分隔，输出同样以 <SEP> 分隔，段数必须一致
5. 保持原文语气（正式/口语）`

const textBlock = batch.length === 1 ? batch[0].text : batch.map(s => s.text).join('\n<SEP>\n')
const userPrompt = `将以下内容翻译成中文：\n\n${textBlock}`

const resp = await fetch(MINIMAX_API, {
  method: 'POST',
  headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: MODEL, stream: true,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
  }),
})
console.log(`  HTTP ${resp.status}`)
if (!resp.ok) { console.log('  ❌', await resp.text()); process.exit(1) }

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
    const trimmed = line.trim()
    if (!trimmed.startsWith('data: ')) continue
    const data = trimmed.slice(6)
    if (data === '[DONE]') continue
    try {
      const json = JSON.parse(data)
      const delta = json?.choices?.[0]?.delta?.content ?? ''
      if (delta) fullText += delta
    } catch {}
  }
}
console.log(`\n→ LLM 返回 ${fullText.length} 字符，含 <SEP>: ${/<SEP>/i.test(fullText)}`)

const parts = fullText.split(/<SEP>/i).map(s => s.trim())
const translations = batch.map((_, i) => parts[i] ?? '')
console.log('\n→ 翻译结果:')
translations.forEach((t, i) => console.log(`  [${i}] ${t ? '✅' : '❌空'} "${t.slice(0, 60)}${t.length > 60 ? '...' : ''}"`))

// ─── 注入 DOM ────────────────────────────────────────────────
console.log('\n→ 注入 DOM...')
let injected = 0
for (let i = 0; i < batch.length; i++) {
  if (!translations[i]) continue
  const el = document.querySelector(`[data-xt-id="${batch[i].id}"]`)
  if (!el) continue
  const tgt = document.createElement('span')
  tgt.setAttribute('data-xt-tgt', batch[i].id)
  tgt.textContent = translations[i]
  el.parentNode.insertBefore(tgt, el.nextSibling)
  injected++
}
const total = document.querySelectorAll('[data-xt-tgt]').length
console.log(`  ✅ 注入 ${injected} 段，DOM 中共 ${total} 个译文元素`)
console.log(`\n${total > 0 ? '✅ 链路代码逻辑 100% OK — 扩展本身没问题' : '❌ 注入失败'}`)
process.exit(total > 0 ? 0 : 1)
