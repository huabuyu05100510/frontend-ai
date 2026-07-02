/**
 * 视觉回归 e2e：8 fixture + 截图
 *
 * 策略：
 *  1. 起本地 HTTP server 提供 8 fixture
 *  2. 用 Playwright 启动 Chromium + 加载 dist 扩展
 *  3. 对每个 fixture:
 *     - 打开页面
 *     - 通过 storage.local 预填翻译缓存（避免真实 LLM）
 *     - 触发 TRANSLATE
 *     - 等注入完成
 *     - 截图保存到 test/shots/fixture-*.png
 *  4. 断言：译文元素存在 + className 正确（grid / rtl / 基础）
 *
 * 模型：Claude (Sonnet 4.5)
 */
import { chromium } from 'playwright'
import http from 'node:http'
import path from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIX_DIR = path.resolve(__dirname, 'fixtures')
const SHOTS_DIR = path.resolve(__dirname, '../shots')
const EXT_PATH = path.resolve(__dirname, '../../dist')

// ─── fixtures ──────────────────────────────────────────────
const FIXTURES = [
  { name: 'flex', file: 'fixture-flex.html', lang: 'zh' },
  { name: 'grid', file: 'fixture-grid.html', lang: 'zh' },
  { name: 'table', file: 'fixture-table.html', lang: 'zh' },
  { name: 'list', file: 'fixture-list.html', lang: 'zh' },
  { name: 'rtl', file: 'fixture-rtl.html', lang: 'zh' },
  { name: 'spa', file: 'fixture-spa.html', lang: 'zh' },
  { name: 'dark', file: 'fixture-dark.html', lang: 'zh' },
  { name: 'print', file: 'fixture-print.html', lang: 'zh' },
]

// ─── 起 fixture server ────────────────────────────────────
const PORT = 9999
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/sample.html' : req.url
  // strip query
  filePath = filePath.split('?')[0]
  const fullPath = path.join(FIX_DIR, filePath)
  if (!existsSync(fullPath)) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(readFileSync(fullPath))
})

await new Promise(r => server.listen(PORT, r))
console.log(`[visual] fixture server: http://localhost:${PORT}`)

if (!existsSync(SHOTS_DIR)) mkdirSync(SHOTS_DIR, { recursive: true })

// ─── 启动 Chromium + 扩展 ─────────────────────────────────
const userDataDir = path.resolve(__dirname, '../../.visual-profile-' + Date.now())

const browser = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chrome',
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-popup-blocking',
  ],
})

console.log('[visual] 等待扩展加载（30s）...')
let workers = []
let extId = null
for (let i = 0; i < 30; i++) {
  workers = browser.serviceWorkers()
  if (workers.length > 0) {
    extId = workers[0].url().match(/chrome-extension:\/\/([^/]+)/)?.[1]
    if (extId) break
  }
  await new Promise(r => setTimeout(r, 1000))
  if (i === 14) console.log('  [15s] 仍在等待...')
}
if (!extId) {
  console.error('[visual] ❌ 扩展未加载')
  // 调试：尝试手动打开扩展 popup 看是否有错误
  const pages = browser.pages()
  console.log('  pages:', pages.map(p => p.url()).join(', '))
  await browser.close()
  server.close()
  process.exit(1)
}
console.log('[visual] 扩展 ID:', extId)

// ─── 测试结果聚合 ────────────────────────────────────────
const results = []
let failed = 0

// ─── 关键：通过 chrome.storage.local 注入 mock 翻译缓存 ────
// 不依赖真实 LLM，直接让 background 命中缓存推送 TRANSLATION_CHUNK
async function seedCache(page, sourceTextToTarget) {
  // 通过 content script 注入 storage（content script 有 chrome.storage 访问权）
  // 直接 page.evaluate chrome.storage.local.set 不可行（不在 extension context）
  // 用 popup 路径：先打开 popup，再 chrome.storage.local.set
  const popup = await browser.newPage()
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`)
  await popup.waitForTimeout(800)
  await popup.evaluate(async (entries) => {
    return new Promise(resolve => {
      chrome.storage.local.set(entries, () => resolve(true))
    })
  }, sourceTextToTarget)
  await popup.close()
}

// 简单的 hash（与 src/shared/types.ts cacheKey 兼容）
function cacheKey(text, src, tgt) {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(31, h) + text.charCodeAt(i) | 0
  }
  return `${src}:${tgt}:${(h >>> 0).toString(36)}`
}

// 模拟翻译：把英文段落中文化（演示用，不依赖 LLM）
const MOCK_TRANSLATIONS = {
  // flex
  'Welcome to the Future of Online Shopping': '欢迎来到在线购物的未来',
  'Home': '首页',
  'Products': '商品',
  'Deals': '优惠',
  'Cart': '购物车',
  'Account': '账户',
  'The platform provides fast checkout and reliable delivery worldwide for every customer.': '该平台为每位客户提供快速结账和可靠的全球配送。',
  'Engineers continue to optimize the rendering pipeline for low-latency browsing.': '工程师持续优化渲染管线，以实现低延迟浏览。',
  // grid
  'Featured Product Recommendations': '精选商品推荐',
  'Wireless Headphones': '无线耳机',
  'Noise cancelling over-ear design with forty hours of battery life.': '降噪包耳式设计，续航达四十小时。',
  'Smart Coffee Maker': '智能咖啡机',
  'Brew fresh coffee every morning with a simple voice command from your phone.': '每天早晨用手机语音指令冲泡新鲜咖啡。',
  'Portable Charger': '便携充电宝',
  'Charge your devices anywhere with twenty thousand milliamp hours of capacity.': '两万毫安时容量，随时随地为设备充电。',
  'Fitness Tracker': '健身追踪器',
  'Track your daily activity and sleep patterns with precision sensors and water resistance.': '使用精密传感器和防水设计，记录日常活动和睡眠模式。',
  'Standing Desk': '升降桌',
  'Adjust your workspace height for better posture and increased productivity all day.': '调节工作台高度，改善姿势，全天提高效率。',
  'Mechanical Keyboard': '机械键盘',
  'Tactile switches and customizable backlighting for an exceptional typing experience.': '触感开关和可定制背光，带来卓越的打字体验。',
  // table
  'Quarterly Performance Summary': '季度业绩汇总',
  'Quarter': '季度',
  'Revenue': '收入',
  'Growth': '增长',
  'Notes': '备注',
  'Q1 2024': '2024 Q1',
  '2.4 million': '240万',
  '+12%': '+12%',
  'Strong growth across all product lines.': '所有产品线均强劲增长。',
  'Q2 2024': '2024 Q2',
  '2.9 million': '290万',
  '+18%': '+18%',
  'Mobile sales exceeded desktop for the first time.': '移动端销量首次超过桌面端。',
  'Q3 2024': '2024 Q3',
  '3.3 million': '330万',
  '+14%': '+14%',
  'International expansion contributed meaningfully.': '国际化扩张贡献显著。',
  'Q4 2024': '2024 Q4',
  '4.1 million': '410万',
  '+24%': '+24%',
  'Holiday season set new records in every region.': '购物季在每个地区创下新纪录。',
  // list
  'Travel Checklist for a Weekend Trip': '周末出行清单',
  'Pack comfortable walking shoes and weather appropriate clothing.': '准备舒适的步行鞋和适合天气的衣物。',
  'Bring a portable charger and noise cancelling headphones for the flight.': '携带便携充电宝和降噪耳机登机。',
  'Confirm your hotel reservation and save the address offline.': '确认酒店预订并离线保存地址。',
  'Charge your camera and clear memory cards before departure.': '出发前为相机充电并清空存储卡。',
  'Notify your bank about international travel plans to avoid card blocks.': '通知银行国际出行计划，避免卡片被锁。',
  // rtl (ar)
  'مرحبا بكم في مستقبل الذكاء الاصطناعي': '欢迎来到人工智能的未来',
  'المهندسون حول العالم يبنون أدوات تترجم اللغة الطبيعية إلى شفرة عاملة.': '全球工程师正在构建将自然语言翻译成可用代码的工具。',
  'تستمر البرمجيات مفتوحة المصدر في تشغيل البنية التحتية الحديثة للويب.': '开源软件持续支撑现代网络基础设施。',
  // spa
  'Modern Web Components Application': '现代 Web Components 应用',
  'Inside the Shadow': 'Shadow DOM 内部',
  'This paragraph lives inside a shadow DOM tree.': '这段文字存在于 shadow DOM 树中。',
  'The component encapsulates its own styling and structure.': '组件封装了自身的样式和结构。',
  // dark
  'Engineering Excellence in the Modern Era': '现代工程卓越',
  'High performance web applications depend on thoughtful architecture and careful optimization.': '高性能 web 应用依赖深思熟虑的架构和细致优化。',
  'Type safety and clear interfaces remain essential for teams working at scale across multiple timezones.': '类型安全和清晰的接口对跨时区大规模协作的团队仍至关重要。',
  // print
  'Long Form Article for Reading and Printing': '长篇文章阅读与打印',
  'This document is designed to look clean both on screen and on paper.': '本文档设计为在屏幕和纸张上都清晰易读。',
  'Print styling hides navigation and decorative chrome while preserving the body text.': '打印样式隐藏导航和装饰元素，同时保留正文。',
  'Reading comfort is the primary goal in both formats for our users.': '阅读舒适度是两种格式下我们对用户的首要目标。',
}

// ─── 每个 fixture 跑一次 ─────────────────────────────────
for (const fix of FIXTURES) {
  console.log(`\n[visual] ===== ${fix.name} (${fix.file}) =====`)
  const result = { name: fix.name, file: fix.file, passed: false, errors: [], counts: {} }
  try {
    const page = await browser.newPage()
    page.on('pageerror', err => result.errors.push(`pageerror: ${err.message}`))
    page.on('console', msg => {
      if (msg.type() === 'error') result.errors.push(`console: ${msg.text().slice(0, 200)}`)
    })

    await page.goto(`http://localhost:${PORT}/${fix.file}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)

    // 预填 storage 缓存
    const entries = {}
    for (const [src, tgt] of Object.entries(MOCK_TRANSLATIONS)) {
      entries[cacheKey(src, 'auto', 'zh')] = tgt
    }
    await seedCache(page, entries)

    // 通过 popup 触发翻译
    const popup = await browser.newPage()
    await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`)
    await popup.waitForTimeout(800)
    const transBtn = await popup.$('.primary-btn')
    if (!transBtn) {
      result.errors.push('popup no .primary-btn')
      throw new Error('popup button missing')
    }
    await transBtn.click()
    await popup.close()

    // 等注入
    let tgtCount = 0
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000)
      tgtCount = await page.evaluate(() => document.querySelectorAll('[data-xt-tgt]').length)
      if (i % 3 === 0) console.log(`  [${i + 1}s] tgt=${tgtCount}`)
      if (tgtCount > 0) break
    }
    result.counts.tgt = tgtCount

    // 验证沉浸式 className
    const styleCheck = await page.evaluate(() => {
      const tgts = [...document.querySelectorAll('[data-xt-tgt]')]
      return {
        total: tgts.length,
        hasImmersive: tgts.every(t => t.classList.contains('xt-translation')),
        firstClassName: tgts[0]?.className ?? null,
        // 沉浸式样式应用：computed style 检查
        firstDisplay: tgts[0] ? getComputedStyle(tgts[0]).display : null,
        firstColor: tgts[0] ? getComputedStyle(tgts[0]).color : null,
      }
    })
    result.counts.styleCheck = styleCheck
    console.log(`  [visual] 样式检查:`, styleCheck)

    // 等 1s 让 fadein 动画结束
    await page.waitForTimeout(1500)
    await page.screenshot({
      path: path.join(SHOTS_DIR, `fixture-${fix.name}.png`),
      fullPage: true,
    })
    console.log(`  [visual] 截图: test/shots/fixture-${fix.name}.png`)

    result.passed = tgtCount > 0 && styleCheck.hasImmersive && styleCheck.firstDisplay === 'block'
    await page.close()
  } catch (err) {
    result.errors.push(String(err?.message ?? err))
  }

  if (!result.passed) failed++
  results.push(result)
  console.log(`  [visual] ${fix.name}: ${result.passed ? '✅' : '❌'}`)
}

// ─── 汇总 ────────────────────────────────────────────────
const summary = {
  total: results.length,
  passed: results.filter(r => r.passed).length,
  failed,
  results,
}
writeFileSync(path.join(SHOTS_DIR, 'visual-regression-summary.json'), JSON.stringify(summary, null, 2))
console.log('\n═══════════════════════════════════════════')
console.log('  视觉回归结果:', `${summary.passed}/${summary.total}`)
console.log('═══════════════════════════════════════════')

await browser.close()
server.close()
process.exit(failed > 0 ? 1 : 0)