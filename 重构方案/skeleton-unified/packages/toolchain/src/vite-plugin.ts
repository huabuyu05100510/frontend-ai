/**
 * @skeleton/toolchain - Vite 插件
 *
 * 基于 boneyard-main/packages/boneyard/src/vite.ts 重写，主要改动：
 * 1. 骨骼坐标统一为全百分比（原版 y/h 是绝对像素）
 * 2. aspectRatio 替代 width/height 元数据
 * 3. 支持 debug 模式（注入调试面板）
 * 4. 增量构建用 FNV1a32 哈希（替代 MD5）
 *
 * 工作原理：
 * 1. Vite serve 启动后，延迟 2s（等待页面加载完成）
 * 2. 使用 Playwright 打开无头 Chromium（或 --cdp 复用已有 Chrome）
 * 3. 遍历配置的路由列表，逐路由截图
 * 4. 在页面执行 window.__SKE_SNAPSHOT（注入的捕获函数）
 * 5. 对每个 [data-ske-name] 元素调用 snapshotBones()，获取全百分比骨骼
 * 6. 写入 <name>.bones.json，注册到 registry.ts
 *
 * HMR：
 * - 监听 Vite HMR，文件变化后 debounce 1500ms 重新捕获
 * - 内容哈希比对（fnv1a32），未变化跳过（增量构建）
 *
 * 配置文件（skeleton.config.json）：
 * ```json
 * {
 *   "routes": ["/", "/product/1", "/user/profile"],
 *   "breakpoints": [375, 768, 1280],
 *   "outDir": "src/bones",
 *   "auth": { "cookies": [...] }
 * }
 * ```
 */

import type { Plugin, ViteDevServer } from 'vite'
import { resolve, join } from 'path'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import type { SkeletonData, ResponsiveSkeletonData } from '@skeleton/core'
import { fnv1a32 } from '@skeleton/core'

// ─── 配置类型 ─────────────────────────────────────────────────────────────────

export interface SkeletonViteConfig {
  /**
   * 路由列表，每个路由会被 Playwright 访问并截图。
   * 默认：['/'，从文件系统自动发现其他路由]
   */
  routes?: string[]
  /**
   * 视口断点宽度列表（px）。
   * 每个断点生成一份骨架，存入 breakpoints map。
   * 默认：[375, 768, 1280]
   */
  breakpoints?: number[]
  /** 输出目录（相对于 Vite 根目录）。默认 'src/bones' */
  outDir?: string
  /** 启动延迟（ms），等待 dev server 就绪。默认 2000 */
  startDelay?: number
  /** HMR 防抖延迟（ms）。默认 1500 */
  hmrDebounce?: number
  /** 认证 Cookies（需要登录的页面） */
  auth?: {
    cookies?: Array<{ name: string; value: string; domain: string }>
    headers?: Record<string, string>
  }
  /**
   * CDP 连接 URL（复用已有 Chrome，保留 session/cookie）。
   * 示例：'http://localhost:9222'（用 `chrome --remote-debugging-port=9222` 启动）
   */
  cdpUrl?: string
  /**
   * 是否生成调试 HTML（每个路由生成可视化对比页面）。
   * 默认 false
   */
  debug?: boolean
}

// ─── Playwright 捕获逻辑 ──────────────────────────────────────────────────────

/**
 * 注入到页面的捕获函数（字符串形式，由 page.evaluate 执行）。
 * 利用全百分比坐标实现。
 */
const SNAPSHOT_SCRIPT = `
(function() {
  function toPercent(v, base) { return base > 0 ? Math.round(v / base * 10000) / 100 : 0 }
  function parseR(style, rect) {
    const tl = parseFloat(style.borderTopLeftRadius) || 0
    const tr = parseFloat(style.borderTopRightRadius) || 0
    const br2 = parseFloat(style.borderBottomRightRadius) || 0
    const bl = parseFloat(style.borderBottomLeftRadius) || 0
    if (!tl && !tr && !br2 && !bl) return undefined
    const max = Math.max(tl, tr, br2, bl)
    if (max > 9998) return Math.abs(rect.width - rect.height) < 4 ? '50%' : 9999
    if (tl === tr && tr === br2 && br2 === bl) return tl
    return tl + 'px ' + tr + 'px ' + br2 + 'px ' + bl + 'px'
  }
  const ATOMIC = new Set(['img','svg','video','audio','canvas','input','button','textarea','select','pre','code','i','iframe'])
  const SEMANTIC_LEAF = new Set(['p','h1','h2','h3','h4','h5','h6','li','td','th','label','a'])

  window.__SKE_SNAPSHOT = function(el, name) {
    const rootRect = el.getBoundingClientRect()
    const rw = rootRect.width, rh = rootRect.height
    const bones = []

    function walk(node) {
      const s = getComputedStyle(node)
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return
      const tag = node.tagName.toLowerCase()
      const children = [...node.children].filter(c => {
        const cs = getComputedStyle(c)
        return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'
      })
      const isLeaf = children.length === 0 || ATOMIC.has(tag) || SEMANTIC_LEAF.has(tag)
      const bg = s.backgroundColor
      const hasBg = bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
      const hasBgImg = s.backgroundImage !== 'none'
      const bw = parseFloat(s.borderTopWidth) || 0
      const hasBorder = bw > 0 && s.borderTopColor !== 'rgba(0, 0, 0, 0)'
      const hasBr = (parseFloat(s.borderTopLeftRadius) || 0) > 0
      const hasSurface = hasBg || hasBgImg || (hasBorder && hasBr)
      const rect = node.getBoundingClientRect()
      if (rect.width < 4 || rect.height < 4) return

      const x = toPercent(rect.left - rootRect.left, rw)
      const y = toPercent(rect.top - rootRect.top, rh)
      const w = toPercent(rect.width, rw)
      const h = toPercent(rect.height, rh)
      const r = parseR(s, rect)

      // 固定宽度判定
      const shrink = s.flexShrink
      const isFixed = shrink === '0' || (rect.width < rw * 0.4)

      if (isLeaf) {
        const bone = [x, y, w, h]
        if (r !== undefined) bone.push(r); else bone.push(undefined)
        if (!isFixed) {
          while (bone.length > 4 && bone[bone.length-1] === undefined) bone.pop()
        } else {
          while (bone.length < 6) bone.push(undefined)
          bone.push(w)  // minW
          bone.push(w)  // maxW
        }
        // 紧凑：末尾 undefined 截断
        let end = bone.length - 1
        while (end >= 4 && bone[end] === undefined) end--
        bones.push(bone.slice(0, end + 1))
        return
      }
      if (hasSurface) {
        const bone = [x, y, w, h]
        const r2 = parseR(s, rect)
        if (r2 !== undefined) bone.push(r2); else bone.push(undefined)
        bone.push(true)  // c = container
        let end = bone.length - 1
        while (end >= 4 && bone[end] === undefined) end--
        bones.push(bone.slice(0, end + 1))
      }
      for (const child of children) walk(child)
    }

    for (const child of el.children) walk(child)
    return {
      name,
      aspectRatio: rh > 0 ? Math.round(rw / rh * 1000) / 1000 : 1,
      capturedWidth: Math.round(rw),
      bones,
      version: 2,
      capturedAt: Date.now(),
      platform: 'web'
    }
  }
})()
`

// ─── Playwright 捕获一个路由 ──────────────────────────────────────────────────

interface CaptureResult {
  name: string
  data: ResponsiveSkeletonData
  hash: string
}

async function captureRoute(
  baseUrl: string,
  route: string,
  breakpoints: number[],
  config: SkeletonViteConfig,
): Promise<CaptureResult[]> {
  let playwright: typeof import('playwright')
  try {
    playwright = await import('playwright')
  } catch {
    console.warn('[skeleton] playwright not installed. Run: pnpm add -D playwright')
    return []
  }

  const results: CaptureResult[] = []

  let browser: import('playwright').Browser
  if (config.cdpUrl) {
    browser = await playwright.chromium.connectOverCDP(config.cdpUrl)
  } else {
    browser = await playwright.chromium.launch()
  }

  try {
    const context = await browser.newContext()

    // 设置认证 Cookies
    if (config.auth?.cookies) {
      await context.addCookies(config.auth.cookies)
    }

    const page = await context.newPage()
    if (config.auth?.headers) {
      await page.setExtraHTTPHeaders(config.auth.headers)
    }

    // 注入捕获脚本
    await page.addInitScript({ content: SNAPSHOT_SCRIPT })

    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp, height: 900 })
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(500) // 等待动画完成

      // 发现所有 [data-ske-name] 元素
      const elements = await page.$$('[data-ske-name]')

      for (const el of elements) {
        const name = await el.getAttribute('data-ske-name')
        if (!name) continue

        // 调用注入的捕获函数
        const captured = await page.evaluate(
          ({ el, name }) => (globalThis as any).__SKE_SNAPSHOT(el, name),
          { el, name },
        ) as SkeletonData | null

        if (!captured) continue

        // 查找或创建 responsive 结构
        let existing = results.find(r => r.name === name)
        if (!existing) {
          existing = {
            name,
            data: { breakpoints: {} },
            hash: '',
          }
          results.push(existing)
        }

        existing.data.breakpoints[bp] = captured
      }
    }

    // 计算哈希（用于增量构建）
    for (const r of results) {
      r.hash = fnv1a32(JSON.stringify(r.data))
    }

    await context.close()
  } finally {
    if (!config.cdpUrl) await browser.close()
  }

  return results
}

// ─── 写入骨架文件 ──────────────────────────────────────────────────────────────

function writeBonesFile(
  outDir: string,
  result: CaptureResult,
  existingHash?: string,
): boolean {
  if (existingHash && existingHash === result.hash) {
    return false // 未变化，跳过
  }

  const filePath = join(outDir, `${result.name}.bones.json`)
  const content = JSON.stringify({ ...result.data, _hash: result.hash }, null, 2)
  writeFileSync(filePath, content, 'utf-8')
  return true
}

function loadExistingHash(outDir: string, name: string): string | undefined {
  const filePath = join(outDir, `${name}.bones.json`)
  if (!existsSync(filePath)) return undefined
  try {
    const content = JSON.parse(readFileSync(filePath, 'utf-8'))
    return content._hash
  } catch {
    return undefined
  }
}

function writeRegistry(outDir: string, names: string[]): void {
  const imports = names.map(n => `import ${n.replace(/-./g, m => m[1].toUpperCase())}Bones from './${n}.bones.json'`).join('\n')
  const exports = `export const bones = {\n${names.map(n => `  '${n}': ${n.replace(/-./g, m => m[1].toUpperCase())}Bones,`).join('\n')}\n}`
  writeFileSync(join(outDir, 'registry.ts'), `${imports}\n\n${exports}\n`, 'utf-8')
}

// ─── Vite 插件主体 ────────────────────────────────────────────────────────────

/**
 * Vite 骨架屏生成插件。
 *
 * @example
 * // vite.config.ts
 * import { skeletonPlugin } from '@skeleton/toolchain/vite'
 * export default defineConfig({
 *   plugins: [
 *     skeletonPlugin({
 *       routes: ['/', '/product', '/user'],
 *       breakpoints: [375, 768, 1280],
 *       outDir: 'src/bones',
 *     })
 *   ]
 * })
 */
export function skeletonPlugin(config: SkeletonViteConfig = {}): Plugin {
  const {
    routes = ['/'],
    breakpoints = [375, 768, 1280],
    outDir = 'src/bones',
    startDelay = 2000,
    hmrDebounce = 1500,
    debug: _debug = false,
  } = config

  let server: ViteDevServer
  let outDirAbs: string
  let hmrTimer: ReturnType<typeof setTimeout> | null = null
  let knownNames = new Set<string>()

  async function runCapture() {
    const baseUrl = `http://localhost:${server.config.server.port ?? 5173}`
    console.log('[skeleton] 开始捕获骨架...', { routes, breakpoints })

    if (!existsSync(outDirAbs)) {
      mkdirSync(outDirAbs, { recursive: true })
    }

    for (const route of routes) {
      const results = await captureRoute(baseUrl, route, breakpoints, config)

      for (const result of results) {
        const existingHash = loadExistingHash(outDirAbs, result.name)
        const written = writeBonesFile(outDirAbs, result, existingHash)
        knownNames.add(result.name)
        if (written) {
          console.log(`[skeleton] ✓ ${result.name} (${Object.keys(result.data.breakpoints).join('/')}px)`)
        } else {
          console.log(`[skeleton] - ${result.name} (unchanged)`)
        }
      }
    }

    writeRegistry(outDirAbs, [...knownNames])
    console.log(`[skeleton] 注册表已更新 (${knownNames.size} 个骨架)`)
  }

  return {
    name: 'skeleton-unified',
    apply: 'serve',

    configureServer(s) {
      server = s
      outDirAbs = resolve(s.config.root, outDir)

      // 延迟启动（等待 dev server 完全就绪）
      const timer = setTimeout(runCapture, startDelay)

      // HMR：文件变化后重新捕获
      s.watcher.on('change', () => {
        if (hmrTimer) clearTimeout(hmrTimer)
        hmrTimer = setTimeout(runCapture, hmrDebounce)
      })

      s.httpServer?.once('close', () => clearTimeout(timer))
    },
  }
}
