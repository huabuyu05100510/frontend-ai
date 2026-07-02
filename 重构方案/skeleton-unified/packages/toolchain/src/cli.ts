#!/usr/bin/env node
/**
 * @skeleton/toolchain - CLI 工具
 *
 * 功能：
 * - skeleton capture：Playwright 自动捕获骨架
 * - skeleton preview：本地预览骨架渲染效果
 * - skeleton debug：在当前页面叠加骨架对比
 * - skeleton native：启动本地服务器，等待 RN 端发送骨架数据
 *
 * 使用：
 * ```
 * pnpm skeleton capture --url http://localhost:5173 --routes '/' '/product'
 * pnpm skeleton capture --config skeleton.config.json
 * pnpm skeleton native --out src/bones
 * pnpm skeleton preview --bones src/bones/product-card.bones.json
 * ```
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, join, dirname, relative } from 'path'
import { createServer } from 'http'
import { execSync } from 'child_process'

// ─── CLI 参数解析 ─────────────────────────────────────────────────────────────

interface CliArgs {
  command: string
  url?: string
  routes: string[]
  breakpoints: number[]
  out: string
  config?: string
  cdp?: string
  watch: boolean
  port: number
  debug: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: argv[2] ?? 'capture',
    routes: ['/'],
    breakpoints: [375, 768, 1280],
    out: 'src/bones',
    watch: false,
    port: 7777,
    debug: false,
  }

  for (let i = 3; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--url') args.url = argv[++i]
    else if (arg === '--routes') {
      args.routes = []
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args.routes.push(argv[++i])
      }
    }
    else if (arg === '--breakpoints') {
      args.breakpoints = []
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args.breakpoints.push(parseInt(argv[++i]))
      }
    }
    else if (arg === '--out') args.out = argv[++i]
    else if (arg === '--config') args.config = argv[++i]
    else if (arg === '--cdp') args.cdp = argv[++i]
    else if (arg === '--watch') args.watch = true
    else if (arg === '--port') args.port = parseInt(argv[++i])
    else if (arg === '--debug') args.debug = true
  }

  // 读取配置文件
  if (args.config && existsSync(args.config)) {
    const cfg = JSON.parse(readFileSync(args.config, 'utf-8'))
    if (cfg.url) args.url = cfg.url
    if (cfg.routes) args.routes = cfg.routes
    if (cfg.breakpoints) args.breakpoints = cfg.breakpoints
    if (cfg.outDir) args.out = cfg.outDir
    if (cfg.cdpUrl) args.cdp = cfg.cdpUrl
  }

  return args
}

// ─── 自动发现 Dev Server ──────────────────────────────────────────────────────

async function discoverDevServer(): Promise<string | null> {
  const candidates = [3000, 5173, 4321, 3001, 8080, 8000, 10086]
  for (const port of candidates) {
    try {
      const { default: http } = await import('http')
      const url = `http://localhost:${port}`
      await new Promise<void>((resolve, reject) => {
        const req = http.get(url, res => {
          if (res.statusCode && res.statusCode < 500) resolve()
          else reject(new Error(`${res.statusCode}`))
        })
        req.on('error', reject)
        req.setTimeout(1000, () => reject(new Error('timeout')))
      })
      return url
    } catch {
      continue
    }
  }
  return null
}

// ─── capture 命令 ──────────────────────────────────────────────────────────────

async function commandCapture(args: CliArgs): Promise<void> {
  let url = args.url
  if (!url) {
    console.log('[skeleton] 自动发现 dev server...')
    url = await discoverDevServer() ?? undefined
    if (!url) {
      console.error('[skeleton] 未找到 dev server。请用 --url 指定，或先启动开发服务器')
      process.exit(1)
    }
    console.log(`[skeleton] 找到 dev server: ${url}`)
  }

  let playwright: typeof import('playwright')
  try {
    playwright = await import('playwright')
  } catch {
    console.error('[skeleton] playwright 未安装。运行: pnpm add -D playwright && npx playwright install chromium')
    process.exit(1)
  }

  const outDir = resolve(process.cwd(), args.out)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  console.log(`[skeleton] 捕获骨架: ${url}`)
  console.log(`[skeleton] 路由: ${args.routes.join(', ')}`)
  console.log(`[skeleton] 断点: ${args.breakpoints.join(', ')}px`)

  // 注入脚本（从 vite-plugin 复用）
  const snapshotScript = `
(function() {
  function toPercent(v, base) { return base > 0 ? Math.round(v / base * 10000) / 100 : 0 }
  function parseR(s, rect) {
    const tl = parseFloat(s.borderTopLeftRadius)||0, tr=parseFloat(s.borderTopRightRadius)||0
    const br=parseFloat(s.borderBottomRightRadius)||0, bl=parseFloat(s.borderBottomLeftRadius)||0
    if(!tl&&!tr&&!br&&!bl) return undefined
    const max=Math.max(tl,tr,br,bl)
    if(max>9998) return Math.abs(rect.width-rect.height)<4?'50%':9999
    if(tl===tr&&tr===br&&br===bl) return tl
    return tl+'px '+tr+'px '+br+'px '+bl+'px'
  }
  const ATOMIC=new Set(['img','svg','video','audio','canvas','input','button','textarea','select','pre'])
  const LEAF=new Set(['p','h1','h2','h3','h4','h5','h6','li','td','th'])
  window.__SKE_SNAPSHOT=function(el,name){
    const rr=el.getBoundingClientRect(), rw=rr.width, rh=rr.height, bones=[]
    function walk(n){
      const s=getComputedStyle(n)
      if(s.display==='none'||s.visibility==='hidden'||s.opacity==='0') return
      const tag=n.tagName.toLowerCase()
      const ch=[...n.children].filter(c=>{const cs=getComputedStyle(c);return cs.display!=='none'&&cs.visibility!=='hidden'&&cs.opacity!=='0'})
      const leaf=ch.length===0||ATOMIC.has(tag)||LEAF.has(tag)
      const rect=n.getBoundingClientRect()
      if(rect.width<4||rect.height<4) return
      const x=toPercent(rect.left-rr.left,rw), y=toPercent(rect.top-rr.top,rh)
      const w=toPercent(rect.width,rw), h=toPercent(rect.height,rh)
      const r=parseR(s,rect)
      const fixed=s.flexShrink==='0'||rect.width<rw*0.4
      if(leaf){
        const b=[x,y,w,h]
        if(r!==undefined)b.push(r)
        if(fixed){while(b.length<6)b.push(undefined);b.push(w,w)}
        let e=b.length-1;while(e>=4&&b[e]===undefined)e--;bones.push(b.slice(0,e+1))
        return
      }
      const bg=s.backgroundColor,hasBg=bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent'
      const bw=parseFloat(s.borderTopWidth)||0,hasBorder=bw>0&&s.borderTopColor!=='rgba(0, 0, 0, 0)'
      const hasBr=(parseFloat(s.borderTopLeftRadius)||0)>0
      if(hasBg||s.backgroundImage!=='none'||(hasBorder&&hasBr)){
        const b=[x,y,w,h];if(r!==undefined)b.push(r);b.push(true)
        let e=b.length-1;while(e>=4&&b[e]===undefined)e--;bones.push(b.slice(0,e+1))
      }
      for(const c of ch)walk(c)
    }
    for(const c of el.children)walk(c)
    return{name,aspectRatio:rh>0?Math.round(rw/rh*1000)/1000:1,capturedWidth:Math.round(rw),bones,version:2,capturedAt:Date.now(),platform:'web'}
  }
})()
`

  let browser: import('playwright').Browser
  if (args.cdp) {
    browser = await playwright.chromium.connectOverCDP(args.cdp)
  } else {
    browser = await playwright.chromium.launch()
  }

  const allNames: string[] = []

  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.addInitScript({ content: snapshotScript })

    for (const route of args.routes) {
      console.log(`\n[skeleton] → ${route}`)
      for (const bp of args.breakpoints) {
        await page.setViewportSize({ width: bp, height: 900 })
        await page.goto(`${url}${route}`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(300)

        const elements = await page.$$('[data-ske-name]')

        for (const el of elements) {
          const name = await el.getAttribute('data-ske-name')
          if (!name) continue

          const captured = await page.evaluate(
            ({ el, name }) => (globalThis as any).__SKE_SNAPSHOT(el, name),
            { el, name },
          )

          if (!captured) continue

          // 组装 responsive 结构
          const responsivePath = join(outDir, `${name}.bones.json`)
          let existing: Record<string, unknown> = {}
          if (existsSync(responsivePath)) {
            try { existing = JSON.parse(readFileSync(responsivePath, 'utf-8')) } catch {}
          }

          const bps = (existing.breakpoints as Record<string, unknown>) ?? {}
          bps[bp] = captured
          existing.breakpoints = bps

          writeFileSync(responsivePath, JSON.stringify(existing, null, 2), 'utf-8')
          console.log(`  ✓ ${name} @ ${bp}px`)
          if (!allNames.includes(name)) allNames.push(name)
        }
      }
    }

    await context.close()
  } finally {
    if (!args.cdp) await browser.close()
  }

  // 写注册表
  if (allNames.length > 0) {
    const imports = allNames.map(n => `import ${toCamel(n)}Bones from './${n}.bones.json'`).join('\n')
    const map = allNames.map(n => `  '${n}': ${toCamel(n)}Bones`).join(',\n')
    writeFileSync(join(outDir, 'registry.ts'), `${imports}\n\nexport const skeletonRegistry = {\n${map}\n}\n`, 'utf-8')
    console.log(`\n[skeleton] 完成！共生成 ${allNames.length} 个骨架`)
    console.log(`[skeleton] 注册表: ${join(outDir, 'registry.ts')}`)
  }
}

// ─── native 命令（接收 RN 骨架数据）─────────────────────────────────────────

async function commandNative(args: CliArgs): Promise<void> {
  const outDir = resolve(process.cwd(), args.out)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  console.log(`[skeleton-native] 监听 RN 骨架数据... port=${args.port}`)
  console.log(`[skeleton-native] 在 RN 组件中添加 onCapture 回调后运行 app`)

  let lastReceiveTime = Date.now()
  const pending = new Map<string, unknown>()

  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }
    if (req.url === '/ping') { res.writeHead(200); res.end('ok'); return }
    if (req.method === 'POST' && req.url === '/bones') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        try {
          const data = JSON.parse(body)
          const name     = data.name as string
          const filePath = (data.filePath as string | undefined)?.trim() || ''

          // 立即写入 .bones.json
          const bonesPath = join(outDir, `${name}.bones.json`)
          const bonesData = { ...data }
          delete bonesData.filePath
          writeFileSync(bonesPath, JSON.stringify(bonesData, null, 2), 'utf-8')
          console.log(`[skeleton-native] 已保存骨架: ${bonesPath}`)

          // 注入到组件文件
          let injected = false
          let message  = '骨架已保存'
          if (filePath) {
            const result = injectIntoComponent({
              projectRoot: process.cwd(),
              filePath,
              name,
              outDir,
            })
            injected = result.ok
            message  = result.message
            console.log(`[skeleton-native] ${result.message}`)

            // 尝试在 VS Code 打开文件
            if (result.ok) {
              try {
                execSync(`code "${resolve(process.cwd(), filePath)}"`, { stdio: 'ignore' })
              } catch {
                // VS Code 未在 PATH 中，忽略
              }
            }
          }

          // 仍写入 pending 供 --watch 模式使用
          pending.set(name, data)
          lastReceiveTime = Date.now()

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, injected, message }))
        } catch {
          res.writeHead(400)
          res.end(JSON.stringify({ ok: false, message: 'invalid json' }))
        }
      })
      return
    }
    res.writeHead(404); res.end()
  })

  server.listen(args.port, () => {
    console.log(`[skeleton-native] 服务器已启动: http://localhost:${args.port}`)
  })

  // 等待 2s 无新数据后写文件
  const checkInterval = setInterval(() => {
    if (pending.size > 0 && Date.now() - lastReceiveTime > 2000) {
      for (const [name, data] of pending) {
        const filePath = join(outDir, `${name}.bones.json`)
        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
        console.log(`[skeleton-native] 保存: ${filePath}`)
      }
      pending.clear()
      if (!args.watch) {
        clearInterval(checkInterval)
        server.close()
        console.log('[skeleton-native] 完成！')
      }
    }
  }, 500)
}

// ─── 代码注入 ─────────────────────────────────────────────────────────────────

interface InjectResult {
  ok: boolean
  message: string
}

/**
 * 将 Skeleton import 和 JSX 包裹注入到组件文件。
 *
 * 支持 4 种 return 写法：
 *  A) return (\n  <Foo>   → 在首个 < 前后插入 <Skeleton>
 *  B) return <Foo />      → 改为 return (<Skeleton...><Foo /></Skeleton>)
 *  C) 已含 <Skeleton      → 幂等跳过
 *  D) 无法识别            → 仅注入 import，插入注释提示
 */
export function injectIntoComponent(opts: {
  projectRoot: string
  filePath: string
  name: string
  outDir: string
}): InjectResult {
  const { projectRoot, filePath, name, outDir } = opts
  const absPath = resolve(projectRoot, filePath)

  if (!existsSync(absPath)) {
    return { ok: false, message: `文件不存在: ${absPath}` }
  }

  const camelName = toCamel(name) + 'Bones'

  // 计算 bones 相对路径
  const fileAbsDir = dirname(absPath)
  const bonesAbs   = resolve(projectRoot, outDir, `${name}.bones.json`)
  const bonesRel   = './' + relative(fileAbsDir, bonesAbs).replace(/\\/g, '/')

  let content = readFileSync(absPath, 'utf-8')
  const lines  = () => content.split('\n')
  const fromLines = (ls: string[]) => { content = ls.join('\n') }

  // ── Step 1：注入 import（幂等）────────────────────────────────────────────
  const skeletonImport = `import { Skeleton } from '@skeleton/renderer-react'`
  const bonesImport    = `import ${camelName} from '${bonesRel}'`

  function insertAfterLastImport(line: string) {
    const ls = lines()
    let lastIdx = -1
    for (let i = 0; i < ls.length; i++) {
      if (/^import\s/.test(ls[i])) lastIdx = i
    }
    if (lastIdx >= 0) {
      ls.splice(lastIdx + 1, 0, line)
    } else {
      ls.unshift(line)
    }
    fromLines(ls)
  }

  if (!content.includes(skeletonImport)) insertAfterLastImport(skeletonImport)
  if (!content.includes(bonesImport))    insertAfterLastImport(bonesImport)

  // ── Step 2：包裹 JSX return ───────────────────────────────────────────────
  const skeletonOpen  = `<Skeleton loading={loading} bones={${camelName}} animation="shimmer">`
  const skeletonClose = `</Skeleton>`

  // 幂等：该具体 bones 的 <Skeleton> 已存在则跳过
  if (content.includes(`<Skeleton`) && content.includes(`bones={${camelName}}`)) {
    writeFileSync(absPath, content, 'utf-8')
    return { ok: true, message: `✓ import 已更新（<Skeleton bones={${camelName}}> 已存在，JSX 未改动）` }
  }

  // Pattern A: return (\n   <Xxx>
  // 找到 `return (` 行，在该行后面找第一个以 < 开头（可能有空格缩进）的行
  const patternA = /^([ \t]+)(return\s*\(\s*)$/m
  const matchA = patternA.exec(content)

  if (matchA) {
    const baseIndent = matchA[1]
    const matchPos   = matchA.index + matchA[0].length
    // 找 matchPos 之后第一个 < 开头的行
    const afterReturn = content.slice(matchPos)
    const firstTagLine = /^([ \t]*)(<\S)/m.exec(afterReturn)

    if (firstTagLine) {
      // 在这一行前插入 <Skeleton>，计算正确缩进
      const openLine = `${baseIndent}${' '.repeat(2)}${skeletonOpen}\n`
      const insertAt = matchPos + firstTagLine.index

      // 找 return 块结尾：与 return ( 同缩进的 )
      // 简单策略：找 afterReturn 中第一个以 baseIndent + ")" 开头的行（且不含 <）
      const closingRe = new RegExp(`^(${baseIndent.replace(/\s/g, '\\s')})(\\))`, 'm')
      const matchClose = closingRe.exec(afterReturn)

      if (matchClose) {
        const closeAt = matchPos + matchClose.index
        const closeLine = `\n${baseIndent}${' '.repeat(2)}${skeletonClose}`

        // 在 ) 前插入 </Skeleton>，在首个 < 前插入 <Skeleton>
        const before  = content.slice(0, insertAt)
        const between = content.slice(insertAt, closeAt)
        const after   = content.slice(closeAt)

        content = before + openLine + between + closeLine + after
        writeFileSync(absPath, content, 'utf-8')
        return { ok: true, message: '✓ import 已注入，JSX return 已用 <Skeleton> 包裹（Pattern A）' }
      }
    }
  }

  // Pattern B: 显式 return <Foo />（单行）
  const patternB = /^(\s+)(return\s+)(<[A-Z][A-Za-z]*|<[a-z][a-z-]*)(.+)$/m
  const matchB = patternB.exec(content)

  if (matchB) {
    const indent  = matchB[1]
    const jsxPart = matchB[3] + matchB[4]
    const replacement =
      `${indent}return (\n` +
      `${indent}  ${skeletonOpen}\n` +
      `${indent}    ${jsxPart}\n` +
      `${indent}  ${skeletonClose}\n` +
      `${indent})`

    content = content.slice(0, matchB.index) + replacement + content.slice(matchB.index + matchB[0].length)
    writeFileSync(absPath, content, 'utf-8')
    return { ok: true, message: '✓ import 已注入，JSX return 已用 <Skeleton> 包裹（Pattern B）' }
  }

  // Pattern B2: 箭头函数隐式 return：const Foo = (...) => <Bar ...>
  // 将 => <Bar> 改为 => (<Skeleton>...<Bar>...</Skeleton>)
  const patternB2 = /^([ \t]*)((?:export\s+)?(?:const|let)\s+\w+\s*=\s*(?:\([^)]*\)|\w+)\s*=>\s*)(<[A-Za-z][A-Za-z0-9.]*)(.*?)(\s*)$/m
  const matchB2 = patternB2.exec(content)

  if (matchB2) {
    const lineIndent = matchB2[1]
    const prefix     = matchB2[2]
    const jsxPart    = matchB2[3] + matchB2[4]
    const replacement =
      `${lineIndent}${prefix}(\n` +
      `${lineIndent}  ${skeletonOpen}\n` +
      `${lineIndent}    ${jsxPart}\n` +
      `${lineIndent}  ${skeletonClose}\n` +
      `${lineIndent})`

    content = content.slice(0, matchB2.index) + replacement + content.slice(matchB2.index + matchB2[0].length)
    writeFileSync(absPath, content, 'utf-8')
    return { ok: true, message: '✓ import 已注入，箭头函数 JSX 已用 <Skeleton> 包裹（Pattern B2）' }
  }

  // Pattern D: 无法识别，插入注释
  const patternD = /^(\s+)(return\s*[\(\<])/m
  const matchD = patternD.exec(content)
  if (matchD) {
    const hint = `${matchD[1]}// TODO: wrap with <Skeleton loading={loading} bones={${camelName}} animation="shimmer">`
    content = content.slice(0, matchD.index) + hint + '\n' + content.slice(matchD.index)
  }

  writeFileSync(absPath, content, 'utf-8')
  return { ok: true, message: '⚠️  import 已注入，JSX 无法自动包裹（已插入 TODO 注释，请手动添加 <Skeleton>）' }
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function toCamel(s: string): string {
  // 先规范化：大写字母前补 -（处理标题空格变横线后的残留），再将空格和连续非法字符变 -
  const cleaned = s
    .replace(/([A-Z])/g, '-$1')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.replace(/-([a-z0-9])/gi, (_, c) => c.toUpperCase())
}

// ─── 入口 ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv)

  switch (args.command) {
    case 'capture':
      await commandCapture(args)
      break
    case 'native':
      await commandNative(args)
      break
    default:
      console.log(`
  @skeleton/toolchain CLI

  命令：
    capture   使用 Playwright 从 dev server 捕获骨架
    native    启动服务器，接收 React Native 发送的骨架数据

  选项（capture）：
    --url         dev server 地址（自动发现时可省略）
    --routes      路由列表（空格分隔）
    --breakpoints 断点宽度（px，空格分隔，默认 375 768 1280）
    --out         输出目录（默认 src/bones）
    --config      配置文件路径（skeleton.config.json）
    --cdp         CDP 连接 URL（复用已有 Chrome）
    --watch       持续监听 HMR 变化

  选项（native）：
    --out         输出目录
    --port        监听端口（默认 9999）
    --watch       持续监听（不退出）

  示例：
    pnpm skeleton capture
    pnpm skeleton capture --url http://localhost:5173 --routes / /product /user
    pnpm skeleton capture --config skeleton.config.json
    pnpm skeleton native --out src/bones
`)
  }
}

// 只在作为脚本直接执行时运行（VITEST 环境下 import 此文件不触发 CLI）
if (!process.env['VITEST']) {
  main().catch(err => {
    console.error('[skeleton]', err)
    process.exit(1)
  })
}
