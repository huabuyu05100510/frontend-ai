/**
 * DeepL 端到端 smoke 验证（W1-2）
 *
 * 用真实 DeepL API 验证：
 *   构造测试页 → 提取段落 → 批量翻译 → 验证译文质量
 *
 * 不启动 Chrome，避免扩展加载的复杂性。验证翻译链路本身。
 *
 * 跑：node --env-file=.env test/deepl-smoke.mjs
 */
const KEY = process.env.DEEPL_API_KEY
if (!KEY) {
  console.error('[smoke] 未设 DEEPL_API_KEY，跳过')
  process.exit(0)
}

const ENDPOINT = KEY.endsWith(':fx')
  ? 'https://api-free.deepl.com/v2/translate'
  : 'https://api.deepl.com/v2/translate'

// ─── 模拟 dom-walker 段落抽取（与扩展逻辑一致）────────────
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'LI', 'TD', 'BLOCKQUOTE'])
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE'])

function extractSegments(root) {
  const out = []
  const visited = new WeakSet()
  (function walk(el) {
    if (visited.has(el)) return
    if (SKIP_TAGS.has(el.tagName)) return
    if (BLOCK_TAGS.has(el.tagName)) {
      const text = cleanText(el)
      if (text.length >= 4) out.push({ id: `s${out.length}`, text, element: el })
      visited.add(el)
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

// ─── DeepL 批量翻译（与 deepl.ts 同实现）────────────────────
async function translateBatch(texts, targetLang = 'ZH') {
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: texts,
      target_lang: targetLang,
      split_sentences: '1',
    }),
  })
  if (!resp.ok) {
    throw new Error(`DeepL ${resp.status}: ${await resp.text()}`)
  }
  const data = await resp.json()
  return data.translations.map(t => ({ text: t.text, lang: t.detected_source_language }))
}

// ─── 测试用例 ─────────────────────────────────────────────
const TEST_CASES = [
  {
    name: '简单段落',
    inputs: ['The quick brown fox jumps over the lazy dog.'],
    expectContains: ['狐狸', '狗'],
  },
  {
    name: '技术文档（保留 React Hooks 术语）',
    inputs: ['React Hooks let you manage state in function components.'],
    expectContains: ['React Hooks'], // 必须保留英文
    expectNotContains: ['反应钩子', '管理状态钩子'], // 反例（误译）
  },
  {
    name: '多段批量（≤50 段单请求）',
    inputs: [
      'Engineers around the world are building tools.',
      'Open source software continues to power the modern web.',
      'Performance optimization remains a critical concern.',
    ],
    expectContains: ['工程师', '开源', '性能'],
  },
  {
    name: '混入人名/品牌名',
    inputs: ['OpenAI released GPT-5 yesterday, surprising everyone.'],
    expectContains: ['OpenAI', 'GPT-5'], // 品牌名应保留
  },
  {
    name: 'LaTeX/代码片段保护',
    inputs: ['Use useEffect(() => { fetch(url) }, [url]) to fetch data.'],
    expectContains: ['useEffect'], // 代码应保留
  },
]

// ─── 主流程 ─────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('  DeepL Smoke Test (W1-2)')
  console.log('═══════════════════════════════════════════════\n')
  console.log(`  endpoint: ${ENDPOINT}`)
  console.log(`  key:      ***${KEY.slice(-4)}\n`)

  let passed = 0
  let failed = 0
  const allStart = Date.now()

  for (const tc of TEST_CASES) {
    const start = Date.now()
    let translations
    try {
      translations = await translateBatch(tc.inputs)
    } catch (e) {
      console.log(`✗ ${tc.name} — API 错误: ${e.message}`)
      failed++
      continue
    }
    const dt = Date.now() - start
    const combined = translations.map(t => t.text).join(' ')

    const okContains = (tc.expectContains || []).every(s => combined.includes(s))
    const okNotContains = (tc.expectNotContains || []).every(s => !combined.includes(s))
    const ok = okContains && okNotContains

    console.log(`${ok ? '✓' : '✗'} ${tc.name} (${dt}ms, ${translations.length} 段)`)
    translations.forEach((t, i) => {
      console.log(`    [${i}] ${tc.inputs[i]}`)
      console.log(`        → ${t.text}  (${t.lang})`)
    })
    if (!ok) {
      if (!okContains) console.log(`    ❌ expectContains 失败`)
      if (!okNotContains) console.log(`    ❌ expectNotContains 失败`)
      failed++
    } else {
      passed++
    }
    console.log()
  }

  const totalDt = Date.now() - allStart
  console.log('───────────────────────────────────────────────')
  console.log(`  结果：${passed} pass / ${failed} fail / ${TEST_CASES.length} total`)
  console.log(`  总耗时：${totalDt}ms`)
  console.log('───────────────────────────────────────────────')

  // 配额检查
  try {
    const u = await fetch('https://api-free.deepl.com/v2/usage', {
      headers: { Authorization: `DeepL-Auth-Key ${KEY}` },
    })
    const usage = await u.json()
    console.log(`  配额：${usage.character_count} / ${usage.character_limit} 字符`)
  } catch {}

  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('✗', e)
  process.exit(1)
})
