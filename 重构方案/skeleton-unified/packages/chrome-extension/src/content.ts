/**
 * @skeleton/chrome-extension - Content Script
 *
 * 在任意页面注入「骨架屏生成器」面板（Shadow DOM 隔离，不影响页面样式）。
 *
 * 功能：
 * 1. 元素选择器 - 鼠标悬浮高亮，点击确认根节点
 * 2. 快照算法   - 与 vite-plugin.ts 完全一致的骨架生成算法
 * 3. 骨架预览   - 实时渲染生成的骨骼（pulse 动画）
 * 4. 代码生成   - JSON / React 组件用法两种输出，一键复制/下载/发送
 */

// ─── 类型 ─────────────────────────────────────────────────────────────────────

type CompactBone = (number | string | boolean | undefined)[]

interface SkeletonData {
  name: string
  aspectRatio: number
  capturedWidth: number
  bones: CompactBone[]
  version: 2
  capturedAt: number
  platform: 'web'
}

// ─── 快照算法（移植自 vite-plugin.ts SNAPSHOT_SCRIPT）────────────────────────

function toPercent(v: number, base: number): number {
  return base > 0 ? Math.round(v / base * 10000) / 100 : 0
}

function parseR(
  s: CSSStyleDeclaration,
  rect: DOMRect,
): number | string | undefined {
  const tl = parseFloat(s.borderTopLeftRadius) || 0
  const tr = parseFloat(s.borderTopRightRadius) || 0
  const br = parseFloat(s.borderBottomRightRadius) || 0
  const bl = parseFloat(s.borderBottomLeftRadius) || 0
  if (!tl && !tr && !br && !bl) return undefined
  const max = Math.max(tl, tr, br, bl)
  if (max > 9998) return Math.abs(rect.width - rect.height) < 4 ? '50%' : 9999
  if (tl === tr && tr === br && br === bl) return tl
  return `${tl}px ${tr}px ${br}px ${bl}px`
}

const ATOMIC = new Set([
  'img', 'svg', 'video', 'audio', 'canvas', 'picture',
  'input', 'button', 'textarea', 'select',
  'pre', 'code', 'iframe', 'i',
])
const LEAF = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'label', 'a'])

function snapshot(el: Element, name: string): SkeletonData {
  const rr = el.getBoundingClientRect()
  const rw = rr.width
  const rh = rr.height
  const bones: CompactBone[] = []

  function walk(n: Element): void {
    const s = getComputedStyle(n)
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return

    const tag = n.tagName.toLowerCase()
    const ch = [...n.children].filter(c => {
      const cs = getComputedStyle(c)
      return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'
    })

    const leaf = ch.length === 0 || ATOMIC.has(tag) || LEAF.has(tag)
    const rect = n.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) return

    const x = toPercent(rect.left - rr.left, rw)
    const y = toPercent(rect.top - rr.top, rh)
    const w = toPercent(rect.width, rw)
    const h = toPercent(rect.height, rh)
    const r = parseR(s, rect)
    const fixed = s.flexShrink === '0' || rect.width < rw * 0.4

    if (leaf) {
      const b: CompactBone = [x, y, w, h]
      if (r !== undefined) b.push(r)
      if (fixed) {
        while (b.length < 6) b.push(undefined)
        b.push(w, w)
      }
      let e = b.length - 1
      while (e >= 4 && b[e] === undefined) e--
      bones.push(b.slice(0, e + 1))
      return
    }

    const bg = s.backgroundColor
    const hasBg = bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
    const bw = parseFloat(s.borderTopWidth) || 0
    const hasBorder = bw > 0 && s.borderTopColor !== 'rgba(0, 0, 0, 0)'
    const hasBr = (parseFloat(s.borderTopLeftRadius) || 0) > 0

    if (hasBg || s.backgroundImage !== 'none' || (hasBorder && hasBr)) {
      const b: CompactBone = [x, y, w, h]
      if (r !== undefined) b.push(r)
      b.push(true)
      let e = b.length - 1
      while (e >= 4 && b[e] === undefined) e--
      bones.push(b.slice(0, e + 1))
    }

    for (const c of ch) walk(c)
  }

  for (const c of el.children) walk(c)

  return {
    name,
    aspectRatio: rh > 0 ? Math.round(rw / rh * 1000) / 1000 : 1,
    capturedWidth: Math.round(rw),
    bones,
    version: 2,
    capturedAt: Date.now(),
    platform: 'web',
  }
}

// ─── 代码生成 ──────────────────────────────────────────────────────────────────

function toCamel(s: string): string {
  return s.replace(/[-_]([a-z])/g, (_, c) => c.toUpperCase())
}

function toPascal(s: string): string {
  const c = toCamel(s)
  return c.charAt(0).toUpperCase() + c.slice(1)
}

// "ProductCard" → "product-card"
function toKebab(name: string): string {
  return name.replace(/([A-Z])/g, (_, c, i) => i === 0 ? c.toLowerCase() : `-${c.toLowerCase()}`)
}

// ─── React Fiber 信息提取 ──────────────────────────────────────────────────────

interface ReactInfo {
  componentName: string  // "ProductCard"
  filePath: string       // "src/components/ProductCard.tsx"（项目相对路径，可为空）
}

/**
 * 从 DOM 元素的 React Fiber 中提取组件名和源文件路径。
 * 利用 React 开发模式下 fiber._debugSource.fileName（与 React DevTools 同机制）。
 * 非 React 页面或生产构建（无 source map）返回 null。
 */
function getReactInfo(el: Element): ReactInfo | null {
  try {
    // React Fiber key 格式：__reactFiber$xxxxxxxx 或旧版 __reactInternalInstance$
    const fiberKey = Object.keys(el).find(k =>
      k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'),
    )
    if (!fiberKey) return null

    // 沿 fiber.return 链向上，找第一个有 _debugSource 指向用户源码的组件
    let fiber = (el as Record<string, unknown>)[fiberKey] as Record<string, unknown> | null
    let firstComponent: { name: string; filePath: string } | null = null

    while (fiber) {
      const type = fiber['type']
      if (type && typeof type === 'function') {
        const name: string = (type as Record<string, string>)['displayName']
          || (type as Record<string, string>)['name']
          || ''
        if (name && /^[A-Z]/.test(name) && name !== 'Anonymous') {
          const src = fiber['_debugSource'] as { fileName?: string } | undefined
          const rawFile = src?.fileName ?? ''
          // 提取相对路径：优先 packages/xxx/src/...，其次 src/app/pages/...
          // Vite dev 模式返回绝对路径，需要剥掉项目根前缀
          const match = rawFile.match(/[/\\](packages[/\\].+\.(tsx|ts|jsx|js))$/)
            || rawFile.match(/[/\\](src[/\\].+|app[/\\].+|pages[/\\].+)$/)
          const filePath = match ? match[1].replace(/\\/g, '/') : ''

          if (!firstComponent) {
            firstComponent = { name, filePath }
          }

          // 找到带有效路径的优先返回
          if (filePath) return { componentName: name, filePath }
        }
      }
      fiber = fiber['return'] as Record<string, unknown> | null
    }

    // 没找到带路径的，返回第一个匹配到的组件
    return firstComponent
  } catch {
    // 任何意外错误（如权限、fiber 已销毁）静默降级
  }
  return null
}

function generateReactCode(name: string): string {
  const pascal = toPascal(name)
  return `// 1. 将下载的 ${name}.bones.json 放到 src/bones/ 目录
// 2. 在组件中引入并使用

import { Skeleton } from '@skeleton/renderer-react'
import bones from './bones/${name}.bones.json'

function ${pascal}Wrapper() {
  const [loading, setLoading] = useState(true)

  return (
    <Skeleton
      loading={loading}
      bones={bones}
      animation="shimmer"
    >
      <${pascal} />
    </Skeleton>
  )
}`
}

// ─── 骨架预览渲染（无依赖版） ─────────────────────────────────────────────────

function renderPreview(data: SkeletonData, container: HTMLElement): void {
  const color = '#e0e0e0'
  const uid = `ske-${Date.now().toString(36)}`
  const { aspectRatio, bones } = data

  container.innerHTML = ''

  // 动画 CSS
  const style = document.createElement('style')
  style.textContent = `
    @keyframes ${uid}-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .${uid}-bone:not([data-c]) {
      animation: ${uid}-pulse 1.8s ease-in-out infinite;
    }
    .${uid}-bone[data-c] {
      opacity: 0.4;
    }
  `
  container.appendChild(style)

  // 比例容器
  const wrap = document.createElement('div')
  wrap.style.cssText = `
    position: relative;
    width: 100%;
    padding-top: ${((1 / aspectRatio) * 100).toFixed(2)}%;
    background: #f9f9f9;
    border-radius: 8px;
    overflow: hidden;
  `

  bones.forEach(rawBone => {
    const [x, y, w, h, ...rest] = rawBone as number[]
    // 解析 r / c
    let r: number | string | undefined
    let isContainer = false
    for (const v of rest) {
      if (v === true) { isContainer = true; break }
      if (v === undefined) continue
      if (typeof v === 'number' || typeof v === 'string') { r ??= v }
    }

    const bone = document.createElement('div')
    bone.className = `${uid}-bone`
    if (isContainer) bone.setAttribute('data-c', '')

    const radius = r !== undefined
      ? (typeof r === 'number' ? `${r}px` : r)
      : '6px'

    bone.style.cssText = `
      position: absolute;
      left: ${x}%;
      top: ${y}%;
      width: ${w}%;
      height: ${h}%;
      border-radius: ${radius};
      background-color: ${isContainer ? '#d0d0d0' : color};
      box-sizing: border-box;
    `
    wrap.appendChild(bone)
  })

  container.appendChild(wrap)
}

// ─── 面板 HTML 模板 ────────────────────────────────────────────────────────────

const PANEL_CSS = `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }

  #panel {
    position: fixed;
    top: 20px;
    right: 20px;
    width: 360px;
    max-height: calc(100vh - 40px);
    background: #1e1e2e;
    color: #cdd6f4;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1);
    display: flex;
    flex-direction: column;
    z-index: 2147483647;
    overflow: hidden;
    user-select: none;
  }
  #panel.minimized { max-height: 48px; }

  /* 标题栏 */
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    background: #181825;
    cursor: move;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .header-icon { font-size: 18px; }
  .header-title { flex: 1; font-weight: 600; font-size: 14px; color: #cdd6f4; }
  .header-btns { display: flex; gap: 4px; }
  .header-btn {
    width: 24px; height: 24px;
    border: none; background: rgba(255,255,255,0.1);
    color: #cdd6f4; border-radius: 6px; cursor: pointer;
    font-size: 12px; display: flex; align-items: center; justify-content: center;
    transition: background 0.15s;
  }
  .header-btn:hover { background: rgba(255,255,255,0.2); }

  /* 内容区 */
  .body {
    flex: 1;
    overflow-y: auto;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .body::-webkit-scrollbar { width: 4px; }
  .body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 2px; }

  /* 初始态 */
  #initial-state { display: flex; flex-direction: column; gap: 10px; }
  .hint-text { font-size: 12px; color: #6c7086; line-height: 1.6; }

  /* 选中后的内容 */
  #result-state { display: none; flex-direction: column; gap: 12px; }

  /* 输入框 */
  .field label {
    display: block; font-size: 11px; color: #6c7086;
    margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .field input {
    width: 100%; padding: 7px 10px;
    background: #313244; border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px; color: #cdd6f4; font-size: 13px; outline: none;
    transition: border-color 0.15s;
  }
  .field input:focus { border-color: #89b4fa; }

  /* 预览区 */
  .preview-label {
    font-size: 11px; color: #6c7086;
    text-transform: uppercase; letter-spacing: 0.5px;
    margin-bottom: 6px;
  }
  #preview-container {
    background: #313244;
    border-radius: 8px;
    padding: 8px;
    max-height: 200px;
    overflow: hidden;
  }

  /* 标签页 */
  .tabs { display: flex; gap: 4px; }
  .tab-btn {
    flex: 1; padding: 6px; border: none;
    background: #313244; color: #6c7086;
    border-radius: 6px; cursor: pointer; font-size: 12px;
    transition: all 0.15s;
  }
  .tab-btn.active { background: #89b4fa; color: #1e1e2e; font-weight: 600; }

  /* 代码展示 */
  .code-wrap { position: relative; }
  #code-display {
    background: #181825;
    border-radius: 8px;
    padding: 10px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 11px;
    line-height: 1.6;
    color: #a6e3a1;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre;
    overflow-x: auto;
  }
  #code-display::-webkit-scrollbar { height: 3px; width: 3px; }
  #code-display::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 2px; }
  .copy-btn {
    position: absolute; top: 6px; right: 6px;
    padding: 3px 8px; background: rgba(137,180,250,0.2);
    border: 1px solid rgba(137,180,250,0.4); border-radius: 4px;
    color: #89b4fa; font-size: 11px; cursor: pointer;
    transition: all 0.15s;
  }
  .copy-btn:hover { background: rgba(137,180,250,0.3); }

  /* 操作按钮 */
  .actions { display: flex; flex-direction: column; gap: 6px; }
  .btn {
    padding: 8px 12px; border: none; border-radius: 7px;
    cursor: pointer; font-size: 13px; font-weight: 500;
    transition: all 0.15s; display: flex; align-items: center; gap: 6px;
    justify-content: center;
  }
  .btn-primary { background: #89b4fa; color: #1e1e2e; }
  .btn-primary:hover { background: #b4d0fb; }
  .btn-secondary { background: #313244; color: #cdd6f4; }
  .btn-secondary:hover { background: #45475a; }
  .btn-success { background: #a6e3a1; color: #1e1e2e; }
  .btn-success:hover { background: #bef0bb; }
  .btn-warn { background: #fab387; color: #1e1e2e; }
  .btn-warn:hover { background: #fcc9a8; }

  /* 状态提示 */
  .status {
    font-size: 11px; text-align: center; padding: 4px 0;
    border-radius: 4px; display: none;
  }
  .status.ok { background: rgba(166,227,161,0.15); color: #a6e3a1; display: block; }
  .status.err { background: rgba(243,139,168,0.15); color: #f38ba8; display: block; }
  .status.info { background: rgba(137,180,250,0.1); color: #89b4fa; display: block; }

  /* 分割线 */
  .divider {
    height: 1px; background: rgba(255,255,255,0.08); margin: 2px 0;
  }

  /* 元素信息 */
  .el-info {
    font-size: 11px; color: #89b4fa;
    padding: 5px 8px; background: rgba(137,180,250,0.1);
    border-radius: 5px; font-family: monospace;
  }
`

// ─── 元素选择器 ────────────────────────────────────────────────────────────────

let pickerActive = false
let panelHost: HTMLElement | null = null

function getDefaultName(el: Element): string {
  // 优先级：data-ske-name > data-testid > id > 第一个 class
  const skeName = el.getAttribute('data-ske-name')
  if (skeName) return skeName

  const testId = el.getAttribute('data-testid')
  if (testId) return testId

  if (el.id) return el.id

  const cls = el.classList[0]
  if (cls && !cls.startsWith('css-') && cls.length < 40) return cls

  return el.tagName.toLowerCase()
}

function elDescription(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const cls = el.classList.length > 0 ? `.${[...el.classList].slice(0, 2).join('.')}` : ''
  return `${tag}${id}${cls}`
}

/**
 * 根据 URL pathname 推导页面组件文件路径。
 * 约定：`/visualization/multi-dimension-data-analysis` →
 * `packages/arco-pro-app/src/pages/visualization/multi-dimension-data-analysis/index.tsx`
 */
function inferFilePathFromUrl(pathname: string): string {
  if (!pathname || pathname === '/') return ''
  const segments = pathname.replace(/^\//, '').split('/').filter(Boolean)
  if (segments.length === 0) return ''
  return `packages/arco-pro-app/src/pages/${segments.join('/')}/index.tsx`
}

// ─── 面板状态管理 ──────────────────────────────────────────────────────────────

class SkeletonPanel {
  private shadow: ShadowRoot
  private panel: HTMLElement
  private currentData: SkeletonData | null = null
  private currentTab: 'json' | 'react' = 'json'

  // 高亮蒙层
  private overlay: HTMLElement
  private tooltip: HTMLElement

  constructor() {
    // 创建宿主
    panelHost = document.createElement('div')
    panelHost.id = 'ske-devtools-host'
    panelHost.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;pointer-events:none;'
    document.body.appendChild(panelHost)

    this.shadow = panelHost.attachShadow({ mode: 'closed' })

    // 注入样式
    const style = document.createElement('style')
    style.textContent = PANEL_CSS
    this.shadow.appendChild(style)

    // 创建面板
    this.panel = document.createElement('div')
    this.panel.id = 'panel'
    this.panel.style.pointerEvents = 'all'
    this.panel.innerHTML = this.buildHTML()
    this.shadow.appendChild(this.panel)

    // 高亮蒙层（注入到真实 DOM，不在 shadow 内）
    this.overlay = document.createElement('div')
    this.overlay.style.cssText = `
      position: fixed; pointer-events: none; z-index: 2147483646;
      border: 2px solid #89b4fa; background: rgba(137,180,250,0.1);
      border-radius: 4px; transition: all 0.1s;
      box-shadow: 0 0 0 1px rgba(137,180,250,0.3);
      display: none;
    `
    document.body.appendChild(this.overlay)

    this.tooltip = document.createElement('div')
    this.tooltip.style.cssText = `
      position: fixed; pointer-events: none; z-index: 2147483646;
      background: #1e1e2e; color: #89b4fa; border: 1px solid rgba(137,180,250,0.3);
      padding: 3px 8px; border-radius: 4px; font-size: 11px; font-family: monospace;
      display: none; max-width: 300px; overflow: hidden; text-overflow: ellipsis;
    `
    document.body.appendChild(this.tooltip)

    this.bindEvents()
    this.makeDraggable()
  }

  private buildHTML(): string {
    return `
      <div class="header" id="ske-header">
        <span class="header-icon">🦴</span>
        <span class="header-title">骨架屏生成器</span>
        <div class="header-btns">
          <button class="header-btn" id="ske-minimize" title="最小化">_</button>
          <button class="header-btn" id="ske-close" title="关闭">×</button>
        </div>
      </div>

      <div class="body" id="ske-body">
        <!-- 初始态 -->
        <div id="initial-state">
          <button class="btn btn-primary" id="ske-pick-btn">
            🎯 选择根节点
          </button>
          <p class="hint-text">
            点击后在页面上鼠标悬浮高亮元素，<br>
            单击选中作为骨架的根节点。<br>
            按 ESC 取消选择。
          </p>
        </div>

        <!-- 选中后 -->
        <div id="result-state">
          <div class="el-info" id="ske-el-info"></div>

          <div class="field">
            <label>骨架名称</label>
            <input type="text" id="ske-name-input" placeholder="product-card" />
          </div>

          <div class="field">
            <label>组件文件路径（相对项目根）</label>
            <input type="text" id="ske-file-input" placeholder="src/components/ProductCard.tsx（可选）" />
          </div>

          <div>
            <div class="preview-label">骨架预览</div>
            <div id="preview-container"></div>
          </div>

          <div>
            <div class="tabs" style="margin-bottom:8px">
              <button class="tab-btn active" data-tab="json">JSON</button>
              <button class="tab-btn" data-tab="react">React 代码</button>
            </div>
            <div class="code-wrap">
              <pre id="code-display"></pre>
              <button class="copy-btn" id="ske-copy-btn">📋 复制</button>
            </div>
          </div>

          <div id="ske-status" class="status"></div>

          <div class="actions">
            <button class="btn btn-success" id="ske-download-btn">⬇ 下载 .bones.json</button>
            <button class="btn btn-warn" id="ske-send-btn">💉 写入项目（:7777）</button>
            <div class="divider"></div>
            <button class="btn btn-secondary" id="ske-reselect-btn">🔄 重新选择</button>
          </div>
        </div>
      </div>
    `
  }

  private bindEvents(): void {
    const $ = (id: string) => this.shadow.getElementById(id)!

    // 关闭/最小化
    $('ske-close').addEventListener('click', () => this.hide())
    $('ske-minimize').addEventListener('click', () => {
      this.panel.classList.toggle('minimized')
      ;($('ske-minimize') as HTMLButtonElement).textContent =
        this.panel.classList.contains('minimized') ? '□' : '_'
    })

    // 选择根节点
    $('ske-pick-btn').addEventListener('click', () => this.startPicker())

    // 重新选择
    $('ske-reselect-btn').addEventListener('click', () => {
      ;($('result-state') as HTMLElement).style.display = 'none'
      ;($('initial-state') as HTMLElement).style.display = 'flex'
      this.currentData = null
    })

    // 名称变更时更新代码
    $('ske-name-input').addEventListener('input', () => {
      if (this.currentData) this.updateCode()
    })

    // 标签页切换
    this.shadow.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = (e.currentTarget as HTMLElement).dataset['tab'] as 'json' | 'react'
        this.currentTab = tab
        this.shadow.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
        ;(e.currentTarget as HTMLElement).classList.add('active')
        this.updateCode()
      })
    })

    // 复制
    $('ske-copy-btn').addEventListener('click', () => this.copyCode())

    // 下载
    $('ske-download-btn').addEventListener('click', () => this.download())

    // 发送到本地服务器
    $('ske-send-btn').addEventListener('click', () => this.sendToLocal())
  }

  private makeDraggable(): void {
    const header = this.shadow.getElementById('ske-header')!
    let startX = 0, startY = 0, startRight = 20, startTop = 20
    let dragging = false

    header.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return
      dragging = true
      startX = e.clientX
      startY = e.clientY
      const rect = this.panel.getBoundingClientRect()
      startRight = window.innerWidth - rect.right
      startTop = rect.top
      e.preventDefault()
    })

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return
      const dx = startX - e.clientX  // 向左拖 → right 增大
      const dy = e.clientY - startY
      const newRight = Math.max(0, startRight + dx)
      const newTop = Math.max(0, startTop + dy)
      this.panel.style.right = `${newRight}px`
      this.panel.style.top = `${newTop}px`
    })

    document.addEventListener('mouseup', () => { dragging = false })
  }

  // ── 元素选择器 ─────────────────────────────────────────────────────────────

  startPicker(): void {
    pickerActive = true
    document.body.style.cursor = 'crosshair'
    this.overlay.style.display = 'block'
    this.tooltip.style.display = 'block'

    const onMove = (e: MouseEvent) => {
      if (!pickerActive) return
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el || el === panelHost || panelHost?.contains(el)) return

      const rect = el.getBoundingClientRect()
      this.overlay.style.top = `${rect.top}px`
      this.overlay.style.left = `${rect.left}px`
      this.overlay.style.width = `${rect.width}px`
      this.overlay.style.height = `${rect.height}px`

      this.tooltip.textContent = elDescription(el)
      const tx = Math.min(e.clientX + 12, window.innerWidth - 200)
      const ty = e.clientY - 28
      this.tooltip.style.left = `${tx}px`
      this.tooltip.style.top = `${ty < 0 ? e.clientY + 12 : ty}px`
    }

    const onClick = (e: MouseEvent) => {
      if (!pickerActive) return
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (!el || el === panelHost || panelHost?.contains(el)) return

      e.preventDefault()
      e.stopPropagation()
      this.stopPicker()
      this.onElementSelected(el)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.stopPicker()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKey)

    // 保存引用便于清理
    ;(this as any)._pickerCleanup = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKey)
    }
  }

  private stopPicker(): void {
    pickerActive = false
    document.body.style.cursor = ''
    this.overlay.style.display = 'none'
    this.tooltip.style.display = 'none'
    ;(this as any)._pickerCleanup?.()
  }

  private onElementSelected(el: Element): void {
    // 优先从 React Fiber 提取组件名和源文件路径
    const reactInfo = getReactInfo(el)
    const name = reactInfo ? toKebab(reactInfo.componentName) : getDefaultName(el)

    // 若 Fiber 没拿到文件路径，用 URL pathname 推导
    let filePath = reactInfo?.filePath ?? ''
    if (!filePath) {
      filePath = inferFilePathFromUrl(window.location.pathname)
    }

    const data = snapshot(el, name)
    this.currentData = data

    const $ = (id: string) => this.shadow.getElementById(id) as HTMLElement
    $('initial-state').style.display = 'none'
    $('result-state').style.display = 'flex'

    $('ske-el-info').textContent = `已选中: ${elDescription(el)} (${data.capturedWidth}×${Math.round(data.capturedWidth / data.aspectRatio)}px)`

    ;($('ske-name-input') as HTMLInputElement).value = name
    ;($('ske-file-input') as HTMLInputElement).value = filePath

    renderPreview(data, $('preview-container'))
    this.currentTab = 'json'
    this.shadow.querySelectorAll('.tab-btn').forEach((b, i) => {
      b.classList.toggle('active', i === 0)
    })
    this.updateCode()

    const src = filePath ? ` → ${filePath}` : ''
    this.showStatus(`已捕获 ${data.bones.length} 个骨骼${src}`, 'info')
  }

  // ── 代码展示 ─────────────────────────────────────────────────────────────────

  private getCurrentName(): string {
    return (this.shadow.getElementById('ske-name-input') as HTMLInputElement)?.value || 'component'
  }

  private updateCode(): void {
    if (!this.currentData) return
    const name = this.getCurrentName()
    const codeEl = this.shadow.getElementById('code-display')!

    if (this.currentTab === 'json') {
      const output = { ...this.currentData, name }
      codeEl.textContent = JSON.stringify(output, null, 2)
      codeEl.style.color = '#a6e3a1'
    } else {
      codeEl.textContent = generateReactCode(name)
      codeEl.style.color = '#89b4fa'
    }
  }

  private copyCode(): void {
    if (!this.currentData) return
    const code = this.shadow.getElementById('code-display')!.textContent || ''
    navigator.clipboard.writeText(code).then(() => {
      this.showStatus('已复制到剪贴板 ✓', 'ok')
    }).catch(() => {
      // 降级方案
      const ta = document.createElement('textarea')
      ta.value = code
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      this.showStatus('已复制到剪贴板 ✓', 'ok')
    })
  }

  // ── 下载 ─────────────────────────────────────────────────────────────────────

  private download(): void {
    if (!this.currentData) return
    const name = this.getCurrentName()
    const output = { ...this.currentData, name }

    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.bones.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    this.showStatus(`已下载 ${name}.bones.json ✓`, 'ok')
  }

  // ── 发送到本地服务器 ──────────────────────────────────────────────────────────

  private async sendToLocal(): Promise<void> {
    if (!this.currentData) return
    const name     = this.getCurrentName()
    const filePath = (this.shadow.getElementById('ske-file-input') as HTMLInputElement)?.value.trim() ?? ''
    const output   = { ...this.currentData, name, filePath }

    this.showStatus('正在写入...', 'info')
    try {
      const res = await fetch('http://localhost:7777/bones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(output),
      })
      if (res.ok) {
        try {
          const json = await res.json() as { ok: boolean; injected: boolean; message: string }
          if (json.injected) {
            this.showStatus(`${json.message}`, 'ok')
          } else if (json.ok) {
            this.showStatus(json.message || '骨架已保存 ✓', 'ok')
          } else {
            this.showStatus(json.message || '写入失败', 'err')
          }
        } catch {
          this.showStatus('已写入 ✓', 'ok')
        }
      } else {
        this.showStatus(`服务器返回 ${res.status}`, 'err')
      }
    } catch {
      this.showStatus('连接失败 - 请先运行 pnpm skeleton native', 'err')
    }
  }

  // ── 工具 ─────────────────────────────────────────────────────────────────────

  private showStatus(msg: string, type: 'ok' | 'err' | 'info'): void {
    const el = this.shadow.getElementById('ske-status')!
    el.textContent = msg
    el.className = `status ${type}`
    setTimeout(() => { el.className = 'status' }, 4000)
  }

  show(): void { panelHost!.style.display = '' }
  hide(): void { panelHost!.style.display = 'none' }
  toggle(): void {
    panelHost!.style.display = panelHost!.style.display === 'none' ? '' : 'none'
  }
}

// ─── 初始化 ───────────────────────────────────────────────────────────────────

let panelInstance: SkeletonPanel | null = null

function init(): void {
  if (panelInstance) { panelInstance.toggle(); return }
  panelInstance = new SkeletonPanel()
}

// 监听 background 发来的 toggle 消息
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SKE_TOGGLE') {
    if (!panelInstance) {
      panelInstance = new SkeletonPanel()
    } else {
      panelInstance.toggle()
    }
  }
})
