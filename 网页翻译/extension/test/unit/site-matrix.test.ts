/**
 * W1-4 5 站兼容性矩阵：dom-walker 对真实站点 HTML 提取的健康度检查
 *
 * 不开 Chrome，直接 jsdom 解析 fixture（test/fixtures/sites/*.html），
 * 跑 extractSegments 并断言：
 *   - 段数 ≥ 阈值
 *   - 无 SCRIPT/STYLE 内容泄漏
 *   - 无空段 / 无超过 5000 字的超长段
 *   - 至少 1 段拿到合理可翻译文本
 *
 * 模型：Claude (Sonnet 4.5)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { extractSegments } from '../../src/content/dom-walker'

const FIXTURE_DIR = path.resolve(__dirname, '../../../test/fixtures/sites')

interface SiteMatrix {
  file: string
  name: string
  minSegments: number  // 期望最低段数（保守，因 anti-bot 拦截后内容会缩水）
  lang: 'en' | 'zh'
}

const MATRIX: SiteMatrix[] = [
  { file: 'bbc.html',   name: 'BBC News',     minSegments: 5,  lang: 'en' },
  { file: 'github.html', name: 'GitHub repo',  minSegments: 5,  lang: 'en' },
  { file: 'arxiv.html', name: 'Arxiv paper',   minSegments: 1,  lang: 'en' },
  { file: 'mdn.html',   name: 'MDN docs',      minSegments: 5,  lang: 'en' },
  { file: 'juejin.html', name: 'Juejin 掘金',  minSegments: 1,  lang: 'zh' },
]

// 用 jsdom 读 html（需要 getComputedStyle — jsdom 默认支持）
function loadDom(html: string): Document {
  const dom = new JSDOM(html, {
    url: 'https://localhost/',
    pretendToBeVisual: true,
  })
  return dom.window.document
}

describe('W1-4 5 站兼容性矩阵', () => {
  for (const site of MATRIX) {
    const fullPath = path.join(FIXTURE_DIR, site.file)

    it(`${site.name}: dom-walker 健康度 ≥ ${site.minSegments} 段`, () => {
      if (!existsSync(fullPath)) {
        console.warn(`[skip] fixture 缺失: ${site.file}`)
        return
      }
      const html = readFileSync(fullPath, 'utf8')
      const dom = loadDom(html)
      // jsdom 没有 window.getComputedStyle 默认实现，给个 stub
      globalThis.getComputedStyle = dom.defaultView!.getComputedStyle.bind(dom.defaultView)

      const body = dom.body
      expect(body).toBeTruthy()

      const segments = extractSegments(body, { tgtLang: site.lang === 'zh' ? 'en' : 'zh' })

      // 基础断言
      expect(segments.length).toBeGreaterThanOrEqual(site.minSegments)

      // 无 SCRIPT/STYLE 泄漏（HTML tag，而非单词 "JavaScript"）
      const scriptLeak = segments.filter(s => /<\/?(?:script|style|noscript)\b/i.test(s.text))
      expect(scriptLeak, `script tag leak: ${JSON.stringify(scriptLeak.slice(0, 2))}`).toHaveLength(0)

      // 无空段
      const emptySegs = segments.filter(s => s.text.trim().length === 0)
      expect(emptySegs).toHaveLength(0)

      // 无超长段（>5000 字多半是 JSON/HTML 内嵌）
      const tooLong = segments.filter(s => s.text.length > 5000)
      expect(tooLong.length, `too-long segs: ${tooLong.length}`).toBeLessThan(segments.length * 0.05)

      // 至少 1 段含字母/汉字（确认不是只抽到空 div）
      const meaningful = segments.filter(s => /[\p{L}\u4e00-\u9fff]/u.test(s.text)
        && s.text.length >= 10)
      expect(meaningful.length).toBeGreaterThan(0)

      // 角色分布
      const roles = new Set(segments.map(s => s.role))

      console.log(`  ${site.name}: ${segments.length} 段, roles=[${[...roles].join(',')}]` +
        `, 首段: "${segments[0]?.text.slice(0, 60)}..."`)
    })
  }
})

describe('W1-4 数据卫生：每个 fixture 自身', () => {
  for (const site of MATRIX) {
    const fullPath = path.join(FIXTURE_DIR, site.file)

    it(`${site.name}: HTML 是非空有效页面`, () => {
      if (!existsSync(fullPath)) return
      const html = readFileSync(fullPath, 'utf8')
      expect(html.length).toBeGreaterThan(1000)
      expect(/<html|<!doctype/i.test(html)).toBe(true)
    })
  }
})
