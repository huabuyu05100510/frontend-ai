/**
 * Tag Retention Rate Benchmark
 *
 * 对比三种翻译方案的 HTML inline 标签保留率：
 *   A. 占位符方案 (⟦tN⟧)        — 本项目（attrs 不进 LLM）
 *   B. 直接 HTML 方案            — 模拟沉浸式翻译 / 直接让 LLM 保留 HTML
 *   C. DeepL 原生 HTML 处理      — tag_handling=html（业界标杆）
 *
 * 用法：
 *   DEEPL_API_KEY=xxx node server.mjs &   # 先起服务（DeepL 通过环境变量）
 *   node benchmark/tag-retention.mjs       # 默认跑 A/B
 *   node benchmark/tag-retention.mjs --deepl  # 加跑 C
 */

import { encode, decode } from '../lib/placeholder.mjs'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.BENCH_URL || 'http://localhost:8787'
const TGT_LANG = '中文'
const DELAY_MS = 800  // 避免打爆 API 速率限制

// DeepL Free API
const DEEPL_ENDPOINT = 'https://api-free.deepl.com/v2/translate'
const DEEPL_API_KEY = process.env.DEEPL_API_KEY || ''
const RUN_DEEPL = process.argv.includes('--deepl')
const DEEPL_TARGET_LANG = 'ZH'  // DeepL 用 ISO 码

// ─── 测试用例 ──────────────────────────────────────────────────────
// 覆盖真实网页中常见的 inline 标签场景
const CASES = [
  // 基础场景
  { id: 'b-single',    html: 'Buy <b>now</b> for free',                         desc: '单个 <b>' },
  { id: 'em-single',   html: 'This is <em>very important</em> information',      desc: '单个 <em>' },
  { id: 'strong',      html: '<strong>Warning:</strong> this action cannot be undone', desc: '<strong> 在句首' },
  { id: 'code-inline', html: 'Run <code>npm install</code> to get started',       desc: '<code> 内联' },
  { id: 'link-basic',  html: 'Click <a href="/docs">here</a> to read more',       desc: '<a> 链接' },

  // 多标签
  { id: 'multi-tags',  html: 'The <b>quick</b> and <em>lazy</em> approach works', desc: '多个不同标签' },
  { id: 'same-tag',    html: '<em>First</em> do this, then <em>second</em> step', desc: '同类型重复标签' },
  { id: 'link-code',   html: 'See the <a href="/api"><code>API reference</code></a> for details', desc: '<a> 包裹 <code>' },

  // 嵌套
  { id: 'nested',      html: '<b>This is <em>very</em> important</b> note',       desc: '嵌套标签' },
  { id: 'nested-link', html: 'Click <a href="/start"><strong>Get Started</strong></a> button', desc: '<a> 嵌套 <strong>' },

  // 标签跨多词
  { id: 'multi-word',  html: 'The <em>quick brown fox</em> jumps over the dog',   desc: '多词在标签内' },
  { id: 'long-link',   html: 'Read our <a href="/guide">comprehensive getting started guide</a> today', desc: '多词链接' },

  // 技术内容
  { id: 'tech-1',      html: 'The <code>useEffect</code> hook runs after every render', desc: '技术术语' },
  { id: 'tech-2',      html: 'Set <code>NODE_ENV=production</code> before deploying', desc: '代码含等号' },
  { id: 'tech-3',      html: 'Use <kbd>Ctrl+C</kbd> to copy and <kbd>Ctrl+V</kbd> to paste', desc: '<kbd> 快捷键' },

  // 电商/营销
  { id: 'price',       html: 'Was <del>$100</del> now only <strong>$49</strong>',  desc: '<del> 价格' },
  { id: 'cta',         html: 'Get <mark>50% off</mark> today with code <code>SAVE50</code>', desc: '促销内容' },

  // 语义标签
  { id: 'abbr',        html: 'The <abbr title="Application Programming Interface">API</abbr> is ready', desc: '<abbr> 缩写' },
  { id: 'sub-sup',     html: 'Water is H<sub>2</sub>O and E=mc<sup>2</sup>',      desc: '<sub>/<sup>' },

  // 复杂长句
  { id: 'complex-1',   html: 'This <b>powerful</b> feature lets you <a href="/docs">configure</a> everything in <em>real time</em>', desc: '长句多标签' },
  { id: 'complex-2',   html: '<strong>Pro tip:</strong> always <code>git commit</code> before <em>major</em> changes to your <a href="/repo">repository</a>', desc: '4种标签混合' },

  // 边界场景
  { id: 'tag-start',   html: '<em>Note:</em> this feature is experimental',        desc: '标签在最前' },
  { id: 'tag-end',     html: 'This feature is currently <em>experimental</em>',    desc: '标签在最后' },
  { id: 'no-tags',     html: 'This is a plain sentence without any HTML tags',     desc: '无标签基线' },
]

// ─── 工具函数 ──────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

/** 统计 HTML 中的开/闭标签数 */
function countTags(html) {
  const opens  = (html.match(/<[a-z][a-z0-9-]*(?:\s[^>]*)?\s*>/gi)  || []).length
  const closes = (html.match(/<\/[a-z][a-z0-9-]*>/gi)                || []).length
  return { opens, closes, total: opens + closes }
}

/** 计算标签保留率 & 平衡性 */
function measureRetention(inputHtml, outputHtml) {
  const input  = countTags(inputHtml)
  const output = countTags(outputHtml)
  if (input.total === 0) return { rate: null, retained: 0, expected: 0, balanced: true }
  return {
    rate:     output.total / input.total,
    retained: output.total,
    expected: input.total,
    balanced: output.opens === output.closes,
  }
}

/** 检查是否有中文字符（验证翻译确实发生了）*/
function hasChineseChars(text) {
  return /[\u4e00-\u9fff]/.test(text)
}

// ─── 方案 A：占位符方案 ─────────────────────────────────────────────
async function runPlaceholder(html) {
  const t0 = Date.now()

  // 1. encode
  const { text: encodedText, tags } = encode(html)

  // 2. 调 translate-aligned（LLM 看到的是 ⟦tN:tag⟧ 格式）
  const res = await fetch(`${BASE_URL}/api/translate-aligned`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ srcHtml: encodedText, tgtLang: TGT_LANG }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { tgtText } = await res.json()

  // 3. decode
  const outputHtml = decode(tgtText, tags)

  return {
    outputHtml,
    encodedInput:  encodedText,
    rawLLMOutput:  tgtText,
    latencyMs:     Date.now() - t0,
  }
}

// ─── 方案 B：直接 HTML 方案 ─────────────────────────────────────────
// 模拟"直接让 LLM 翻译 HTML，靠 prompt 要求保留标签"（沉浸式翻译的基础路径）
async function runDirectHTML(html) {
  const t0 = Date.now()

  const res = await fetch(`${BASE_URL}/api/translate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ segments: [html], tgtLang: TGT_LANG }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { translations } = await res.json()

  return {
    outputHtml: translations[0] ?? '',
    latencyMs:  Date.now() - t0,
  }
}

// ─── 方案 C：DeepL 原生 HTML 处理 ──────────────────────────────────
// DeepL 用 tag_handling=html，服务端自己做标签掩码 + 神经对齐
// 直接调 https://api-free.deepl.com/v2/translate，不经 server.mjs
// ⚠️ DeepL 2025-11 起弃用 form-body auth_key，必须用 Authorization header
async function runDeepL(html) {
  if (!DEEPL_API_KEY) throw new Error('DEEPL_API_KEY 未设置')
  const t0 = Date.now()

  const body = new URLSearchParams({
    text:            html,
    target_lang:     DEEPL_TARGET_LANG,
    tag_handling:    'html',
    preserve_formatting: '1',
  })

  const res = await fetch(DEEPL_ENDPOINT, {
    method:  'POST',
    headers: {
      'Authorization':  `DeepL-Auth-Key ${DEEPL_API_KEY}`,
      'Content-Type':   'application/x-www-form-urlencoded',
    },
    body:    body.toString(),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`DeepL HTTP ${res.status}: ${errText.slice(0, 120)}`)
  }
  const data = await res.json()
  const outputHtml = data?.translations?.[0]?.text ?? ''

  return {
    outputHtml,
    latencyMs: Date.now() - t0,
  }
}

// ─── 主流程 ────────────────────────────────────────────────────────
async function run() {
  console.log('═══════════════════════════════════════════════════════')
  console.log('  Tag Retention Rate Benchmark')
  console.log(`  Server: ${BASE_URL}  |  Target: ${TGT_LANG}  |  Cases: ${CASES.length}`)
  if (RUN_DEEPL) {
    console.log(`  DeepL: ${DEEPL_ENDPOINT}  (key: ${DEEPL_API_KEY.slice(0, 8)}...${DEEPL_API_KEY.slice(-4)})`)
  } else {
    console.log('  DeepL: 未启用（用 --deepl 启用）')
  }
  console.log('═══════════════════════════════════════════════════════\n')

  const results = []
  let phTotal = 0, phTagsExpected = 0, phTagsRetained = 0
  let dtTotal = 0, dtTagsExpected = 0, dtTagsRetained = 0
  let dlTotal = 0, dlTagsExpected = 0, dlTagsRetained = 0
  let casesWithTags = 0

  for (const c of CASES) {
    process.stdout.write(`[${String(results.length + 1).padStart(2)}/${CASES.length}] ${c.desc.padEnd(20)} `)

    let phResult, dtResult, dlResult, error

    try {
      // 先跑占位符方案
      phResult = await runPlaceholder(c.html)
      await sleep(DELAY_MS)

      // 再跑直接 HTML 方案
      dtResult = await runDirectHTML(c.html)
      await sleep(DELAY_MS)

      // 可选：DeepL
      if (RUN_DEEPL) {
        dlResult = await runDeepL(c.html)
        await sleep(DELAY_MS)
      }

    } catch (e) {
      error = e.message
      console.log(`  ❌ ${e.message}`)
      results.push({ ...c, error })
      continue
    }

    const phMetric = measureRetention(c.html, phResult.outputHtml)
    const dtMetric = measureRetention(c.html, dtResult.outputHtml)
    const dlMetric = dlResult ? measureRetention(c.html, dlResult.outputHtml) : null

    const hasTags = phMetric.expected > 0
    if (hasTags) {
      casesWithTags++
      phTagsExpected += phMetric.expected
      phTagsRetained += phMetric.retained
      dtTagsExpected += dtMetric.expected
      dtTagsRetained += dtMetric.retained
      if (dlMetric) {
        dlTagsExpected += dlMetric.expected
        dlTagsRetained += dlMetric.retained
      }
    }

    // 控制台行输出
    const phRate = phMetric.rate === null ? '  -- ' : `${(phMetric.rate * 100).toFixed(0).padStart(4)}%`
    const dtRate = dtMetric.rate === null ? '  -- ' : `${(dtMetric.rate * 100).toFixed(0).padStart(4)}%`
    const dlRate = !dlMetric ? '' : (dlMetric.rate === null ? '  -- ' : `${(dlMetric.rate * 100).toFixed(0).padStart(4)}%`)
    const dlPart = RUN_DEEPL ? `  DeepL: ${dlRate}` : ''
    console.log(`PH: ${phRate}  Direct: ${dtRate}${dlPart}`)

    results.push({
      ...c,
      placeholder: {
        outputHtml:   phResult.outputHtml,
        encodedInput: phResult.encodedInput,
        rawLLMOutput: phResult.rawLLMOutput,
        latencyMs:    phResult.latencyMs,
        ...phMetric,
        translated:   hasChineseChars(phResult.outputHtml),
      },
      direct: {
        outputHtml:  dtResult.outputHtml,
        latencyMs:   dtResult.latencyMs,
        ...dtMetric,
        translated:  hasChineseChars(dtResult.outputHtml),
      },
      ...(dlResult ? {
        deepl: {
          outputHtml: dlResult.outputHtml,
          latencyMs:  dlResult.latencyMs,
          ...dlMetric,
          translated: hasChineseChars(dlResult.outputHtml),
        },
      } : {}),
    })
  }

  // ─── 汇总报告 ───────────────────────────────────────────────────
  const phOverall = phTagsExpected > 0 ? phTagsRetained / phTagsExpected : 0
  const dtOverall = dtTagsExpected > 0 ? dtTagsRetained / dtTagsExpected : 0
  const dlOverall = dlTagsExpected > 0 ? dlTagsRetained / dlTagsExpected : 0
  const improvement = phOverall - dtOverall
  const vsDeepl     = phOverall - dlOverall

  console.log('\n═══════════════════════════════════════════════════════')
  console.log('  汇总结果')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`  测试用例总数:       ${CASES.length}  (含标签的: ${casesWithTags})`)
  console.log(`  占位符方案保留率:   ${(phOverall * 100).toFixed(1)}%  (${phTagsRetained}/${phTagsExpected} 标签)`)
  console.log(`  直接HTML方案保留率: ${(dtOverall * 100).toFixed(1)}%  (${dtTagsRetained}/${dtTagsExpected} 标签)`)
  if (RUN_DEEPL) {
    console.log(`  DeepL HTML 保留率:  ${(dlOverall * 100).toFixed(1)}%  (${dlTagsRetained}/${dlTagsExpected} 标签)`)
    console.log(`  vs DeepL:           ${vsDeepl >= 0 ? '+' : ''}${(vsDeepl * 100).toFixed(1)} 个百分点`)
  }
  console.log(`  vs 直接HTML:        ${improvement >= 0 ? '+' : ''}${(improvement * 100).toFixed(1)} 个百分点`)
  console.log('───────────────────────────────────────────────────────')

  // 逐 case 详情
  console.log('\n  Case 详情（含标签的用例）:')
  for (const r of results) {
    if (!r.placeholder || r.placeholder.expected === 0) continue
    const ph = r.placeholder, dt = r.direct, dl = r.deepl
    const diff = ph.rate - dt.rate
    const flag = diff > 0 ? '↑' : diff < 0 ? '↓' : '='
    const dlStr = dl ? `  DL:${(dl.rate*100).toFixed(0).padStart(3)}%` : ''
    console.log(`  ${flag} [${r.id.padEnd(12)}] PH:${(ph.rate*100).toFixed(0).padStart(3)}%  DT:${(dt.rate*100).toFixed(0).padStart(3)}%${dlStr}  diff:${diff >= 0 ? '+' : ''}${(diff*100).toFixed(0)}%  balanced:${ph.balanced ? '✓' : '✗'}`)
    if (!ph.translated) console.log(`    ⚠️  占位符输出无中文字符，可能未翻译`)
  }

  // 延迟对比
  const phLat = results.filter(r => r.placeholder).map(r => r.placeholder.latencyMs)
  const dtLat = results.filter(r => r.direct).map(r => r.direct.latencyMs)
  const dlLat = results.filter(r => r.deepl).map(r => r.deepl.latencyMs)
  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0
  console.log(`\n  平均延迟:  PH ${avg(phLat)}ms  |  Direct ${avg(dtLat)}ms${dlLat.length ? `  |  DeepL ${avg(dlLat)}ms` : ''}`)

  // 标签不平衡的 case
  const unbalanced = results.filter(r => r.placeholder && !r.placeholder.balanced)
  if (unbalanced.length) {
    console.log(`\n  ⚠️  标签不平衡 (${unbalanced.length} 个):`)
    for (const r of unbalanced) console.log(`     ${r.id}: ${r.placeholder.outputHtml}`)
  }

  // 保存详细 JSON 结果
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outPath = path.join(__dirname, 'results', `tag-retention-${ts}.json`)
  await mkdir(path.join(__dirname, 'results'), { recursive: true })
  await writeFile(outPath, JSON.stringify({
    meta: {
      ts, url: BASE_URL, tgtLang: TGT_LANG, cases: CASES.length,
      deeplEnabled: RUN_DEEPL,
      deeplEndpoint: RUN_DEEPL ? DEEPL_ENDPOINT : null,
      model: { placeholder: 'MiniMax (aligned)', direct: 'MiniMax', deepl: 'DeepL Free' },
    },
    summary: {
      placeholder: { rate: phOverall, retained: phTagsRetained, expected: phTagsExpected, avgLatencyMs: avg(phLat) },
      direct:      { rate: dtOverall, retained: dtTagsRetained, expected: dtTagsExpected, avgLatencyMs: avg(dtLat) },
      ...(RUN_DEEPL ? {
        deepl:       { rate: dlOverall, retained: dlTagsRetained, expected: dlTagsExpected, avgLatencyMs: avg(dlLat) },
      } : {}),
      improvement,
      vsDeepl: RUN_DEEPL ? vsDeepl : null,
    },
    cases: results,
  }, null, 2))
  console.log(`\n  详细结果已保存 → ${outPath}`)
  console.log('═══════════════════════════════════════════════════════\n')
}

run().catch(e => {
  console.error('Benchmark 失败:', e.message)
  console.error('请确认 server.mjs 已启动：node server.mjs')
  process.exit(1)
})
