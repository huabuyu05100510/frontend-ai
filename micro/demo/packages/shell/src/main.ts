import { createSandbox, type AppManifest, type SandboxInstance } from '@micro/engine'

const user = { id: 'u-1001', name: 'alice', country: 'CN' }
const abConfig = { exp: 'A', layers: { homepage: 'B' } }
document.getElementById('user')!.textContent = `${user.name} · ${user.country}`
document.getElementById('av')!.textContent = user.name[0].toUpperCase()

;(window as any).__RUM__ = {
  track(event: string, payload?: unknown) {
    log(`<b>track</b> ${event} ${payload ? JSON.stringify(payload) : ''}`)
  },
  metric(name: string, value: number) {
    if (
      name.startsWith('child.') ||
      name.startsWith('route.') ||
      name.startsWith('direct.') ||
      name.startsWith('activate.')
    ) {
      log(`<b>metric</b> ${name} = ${value}`)
    }
  },
  error(err: Error, meta?: unknown) {
    log(`<b style="color:#c0392b">error</b> ${err.message} ${meta ? JSON.stringify(meta) : ''}`)
  },
}

// ────────── Studio 元信息 ──────────
interface StudioMeta {
  app: AppManifest
  title: string
  desc: string
  cover: string
  icon: string
  author: string
  hot: number
  group: string
  category: string
  badge?: 'ext' | 'mock'
}

const studios: StudioMeta[] = [
  {
    app: {
      name: 'boogu-image-edit',
      directUrl: 'https://boogu-boogu-image-edit-gradio.ms.show',
      route: '/studio/boogu-image-edit',
      framework: 'external',
      mpaFallbackUrl: 'https://modelscope.cn/studios/Boogu/boogu-image-edit-gradio',
    },
    title: 'Boogu 图像编辑',
    desc: '涂抹蒙版 + prompt，生成式重绘（真实 Gradio，跨域直引）',
    cover: '🎨', icon: '🎨',
    author: 'Boogu', hot: 9420,
    group: 'AI 应用', category: '图像', badge: 'ext',
  },
  {
    app: {
      name: 'image-edit',
      entryUrl: '/image-edit/index.html',
      route: '/studio/image-edit',
      framework: 'native',
      mpaFallbackUrl: '/legacy/image-edit',
      prefetch: ['https://picsum.photos/seed/boogu-demo/512/512'],
    },
    title: '图像编辑 Studio',
    desc: '本地 mock：canvas 涂抹蒙版 + prompt 重绘（picsum 出图）',
    cover: '🖼️', icon: '🖼️',
    author: 'demo', hot: 1280,
    group: 'AI 应用', category: '图像', badge: 'mock',
  },
  {
    app: {
      name: 'text-gen',
      entryUrl: '/text-gen/index.html',
      route: '/studio/text-gen',
      framework: 'native',
      mpaFallbackUrl: '/legacy/text-gen',
    },
    title: '文本生成 Studio',
    desc: '本地 mock：prompt 流式输出（诗/代码/RAG/三体）',
    cover: '✍️', icon: '✍️',
    author: 'demo', hot: 2330,
    group: 'AI 应用', category: '文本', badge: 'mock',
  },
  {
    app: {
      name: 'vue2-list',
      entryUrl: '/vue2-list/index.html',
      route: '/studio/vue2-list',
      framework: 'vue2',
      mpaFallbackUrl: '/legacy/vue2-list',
      // 关键：预取 entry HTML 之外，还要预取子应用依赖的 CDN 资源
      // 否则首次激活时 iframe 还得现拉 Vue/ElementUI，会有几百 ms 的白屏
      prefetch: [
        'https://unpkg.com/element-ui@2.15.14/lib/theme-chalk/index.css',
        'https://unpkg.com/vue@2.7.16/dist/vue.js',
        'https://unpkg.com/element-ui@2.15.14/lib/index.js',
      ],
    },
    title: '商品管理',
    desc: 'Vue2 + Element UI 老应用零改造接入',
    cover: '🛒', icon: '🛒',
    author: 'icbu', hot: 580,
    group: '业务系统', category: '业务',
  },
  {
    app: {
      name: 'jquery-form',
      entryUrl: '/jquery-form/index.html',
      route: '/studio/jquery-form',
      framework: 'jquery',
      mpaFallbackUrl: '/legacy/jquery-form',
      prefetch: [
        'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js',
        'https://cdn.jsdelivr.net/npm/bootstrap@4.6.2/dist/css/bootstrap.min.css',
        'https://cdn.jsdelivr.net/npm/bootstrap@4.6.2/dist/js/bootstrap.bundle.min.js',
      ],
    },
    title: '入驻表单',
    desc: 'jQuery + Bootstrap 老应用，验证 top.postMessage 代理',
    cover: '📋', icon: '📋',
    author: 'icbu', hot: 360,
    group: '业务系统', category: '业务',
  },
  {
    app: {
      name: 'react-detail',
      entryUrl: '/react-detail/index.html',
      route: '/studio/react-detail',
      framework: 'react',
      mpaFallbackUrl: '/legacy/react-detail',
      prefetch: [
        'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
        'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
        'https://unpkg.com/htm@3.1.1/dist/htm.module.js',
      ],
    },
    title: '商品详情',
    desc: 'React 18 + htm，三段式 SSG hydrate 演示',
    cover: '📦', icon: '📦',
    author: 'icbu', hot: 720,
    group: '业务系统', category: '业务',
  },
  {
    app: {
      name: 'broken',
      entryUrl: '/broken/index.html',
      route: '/studio/broken',
      framework: 'native',
      mpaFallbackUrl: '/legacy/broken',
    },
    title: '失效 Studio',
    desc: '故意 404，触发 ErrorBoundary 跳 MPA',
    cover: '⚠️', icon: '⚠️',
    author: 'test', hot: 12,
    group: '测试', category: '其他',
  },
]

// ────────── 沙箱 ──────────
const sandbox: SandboxInstance = createSandbox({
  container: '#sandbox',
  apps: studios.map((s) => s.app),
  user,
  abConfig,
  rum: (window as any).__RUM__,
})
sandbox.on('activate:start', (p) => log(`▶ activate ${JSON.stringify(p)}`))
sandbox.on('activate:success', (p) => log(`✓ activate ${JSON.stringify(p)}`))
sandbox.on('activate:fallback', (p) => log(`⚠ fallback ${JSON.stringify(p)}`))
sandbox.on('lru:evict', (p) => log(`♻ LRU evict ${JSON.stringify(p)}`))
sandbox.on('route:sync', (p) => log(`⇄ route ${JSON.stringify(p)}`))

// ────────── 左侧菜单（按 group 分组） ──────────
const sideEl = document.getElementById('side')!
const listView = document.getElementById('list-view')!
const sandboxEl = document.getElementById('sandbox')!
const crumbName = document.getElementById('crumb-name')!
const ctbarTitle = document.getElementById('ctbar-title')!
const ctbarTag = document.getElementById('ctbar-tag')!
const ctbarMeta = document.getElementById('ctbar-meta')!

// 「应用列表」作为菜单顶部入口
const menuGroups: { name: string; items: StudioMeta[] }[] = [
  { name: '__home__', items: [] },
  ...groupOrder(studios),
]

function groupOrder(list: StudioMeta[]) {
  const order: string[] = []
  const map = new Map<string, StudioMeta[]>()
  for (const s of list) {
    if (!map.has(s.group)) { map.set(s.group, []); order.push(s.group) }
    map.get(s.group)!.push(s)
  }
  return order.map((name) => ({ name, items: map.get(name)! }))
}

function badgeHtml(s: StudioMeta): string {
  if (s.badge === 'ext') return '<span class="badge ext">真实</span>'
  if (s.badge === 'mock') return '<span class="badge mock">mock</span>'
  return ''
}

function renderSide() {
  const parts: string[] = []
  // 顶部：应用列表
  parts.push(`<div class="grp">
    <a data-action="home" class="on"><span class="ic">🗂</span>应用列表</a>
  </div>`)
  for (const g of menuGroups) {
    if (g.name === '__home__') continue
    parts.push(`<div class="grp">
      <div class="gtitle">${g.name}</div>
      ${g.items.map((s) => `<a data-app="${s.app.name}"><span class="ic">${s.icon}</span>${s.title}${badgeHtml(s)}</a>`).join('')}
    </div>`)
  }
  sideEl.innerHTML = parts.join('')

  sideEl.querySelectorAll<HTMLAnchorElement>('a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault()
      if (a.dataset.action === 'home') {
        showList()
      } else if (a.dataset.app) {
        openStudio(a.dataset.app)
      }
      // 高亮
      sideEl.querySelectorAll('a').forEach((l) => l.classList.remove('on'))
      a.classList.add('on')
    })
  })
}

// ────────── 列表视图 ──────────
const cats = ['全部', '图像', '文本', '业务', '其他']
let curCat = '全部'
const catBar = document.getElementById('cat-bar')!
const grid = document.getElementById('grid')!

function renderCats() {
  catBar.innerHTML = cats
    .map((c) => `<div class="cat${c === curCat ? ' on' : ''}" data-cat="${c}">${c}</div>`)
    .join('')
  catBar.querySelectorAll<HTMLDivElement>('.cat').forEach((el) => {
    el.addEventListener('click', () => {
      curCat = el.dataset.cat!
      renderCats()
      renderGrid()
    })
  })
}

function renderGrid() {
  const list = curCat === '全部' ? studios : studios.filter((s) => s.category === curCat)
  grid.innerHTML = list
    .map((s) => {
      const pill = s.badge === 'ext'
        ? '<span class="pill ext">真实</span>'
        : s.badge === 'mock'
          ? '<span class="pill mock">mock</span>'
          : ''
      return `<div class="card" data-app="${s.app.name}">
        <div class="cover">${s.cover}</div>
        <div class="body">
          <h3>${pill}${s.title}</h3>
          <div class="desc">${s.desc}</div>
          <div class="meta"><span>@${s.author}</span><span>🔥 ${s.hot}</span></div>
        </div>
      </div>`
    })
    .join('')
  grid.querySelectorAll<HTMLDivElement>('.card').forEach((c) => {
    c.addEventListener('click', () => {
      openStudio(c.dataset.app!)
      // 同步侧栏高亮
      sideEl.querySelectorAll('a').forEach((l) => l.classList.toggle('on', l.dataset.app === c.dataset.app))
    })
  })
}

// ────────── 列表 ↔ 详情 ──────────
function showList() {
  listView.style.display = ''
  sandboxEl.style.display = 'none'
  crumbName.textContent = '应用列表'
  ctbarTitle.textContent = '应用列表'
  ctbarTag.textContent = `${studios.length} 个 Studio`
  ctbarMeta.textContent = ''
}

function openStudio(appName: string) {
  const meta = studios.find((s) => s.app.name === appName)
  if (!meta) return
  listView.style.display = 'none'
  sandboxEl.style.display = 'block'
  crumbName.textContent = meta.title
  ctbarTitle.textContent = meta.title
  ctbarTag.innerHTML =
    meta.badge === 'ext'
      ? '<span class="pill ext">真实 · 跨域直引</span>'
      : meta.badge === 'mock'
        ? '<span class="pill mock">本地 mock</span>'
        : `<span class="pill">${meta.app.framework}</span>`
  ctbarMeta.textContent = `@${meta.author} · 🔥 ${meta.hot}`
  sandbox.activate(appName).catch((err) => log(`❌ activate err: ${err.message}`))
}

renderSide()
renderCats()
renderGrid()
showList()

// ────────── 性能对比：预加载 vs 不预加载 ──────────
const perfBtn = document.getElementById('perf-btn')! as HTMLButtonElement
const perfMask = document.getElementById('perf-mask')!
const perfBody = document.getElementById('perf-body')!
const perfFoot = document.getElementById('perf-foot')!
document.getElementById('perf-close')!.addEventListener('click', () => perfMask.classList.remove('show'))
perfMask.addEventListener('click', (e) => { if (e.target === perfMask) perfMask.classList.remove('show') })

perfBtn.addEventListener('click', runPerfCompare)

interface PerfRow { name: string; cold: number; warm: number }
async function runPerfCompare() {
  perfBtn.disabled = true
  perfMask.classList.add('show')
  perfBody.innerHTML = '<div style="text-align:center;padding:40px 0;color:#86909c;font-size:13px">⏱ 测量中…</div>'
  perfFoot.textContent = ''

  // 只测有 entryUrl 的（同源），跨域 directUrl 测不出 HTTP cache 差异
  const targets = studios.filter((s) => s.app.entryUrl).map((s) => ({ name: s.title, url: s.app.entryUrl! }))
  const rows: PerfRow[] = []

  // 给浏览器一个空闲槽，避免和 activate 抢主线程
  await new Promise((r) => setTimeout(r, 50))

  for (const t of targets) {
    // ── 无预加载（cold）：每次都强制走网络（no-store）
    // 取 3 次平均，减少抖动
    let coldTotal = 0
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now()
      await fetch(t.url + '?cold=1&i=' + i, { cache: 'no-store' })
      coldTotal += performance.now() - t0
    }
    const cold = coldTotal / 3

    // ── 预加载（warm）：模拟 idle prefetch 已把资源拉到 HTTP cache
    // 先用默认 cache 模式预热一次（等同 IdlePrefetch.prefetch()）
    await new Promise<void>((resolve) => {
      const ric = (globalThis as any).requestIdleCallback ?? ((cb: any) => setTimeout(() => cb({ timeRemaining: () => 50 }), 0))
      ric(() => {
        fetch(t.url + '?warm=1').then(() => resolve()).catch(() => resolve())
      })
    })
    // 给 disk cache 一拍落盘
    await new Promise((r) => setTimeout(r, 10))

    // 用户首次激活时：force-cache 命中 → 秒出
    let warmTotal = 0
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now()
      await fetch(t.url + '?warm=1', { cache: 'force-cache' })
      warmTotal += performance.now() - t0
    }
    const warm = warmTotal / 3

    rows.push({ name: t.name, cold, warm })
    // 增量渲染：每测完一个就画一次，看得见进度
    renderPerfRows(rows)
  }

  const totalCold = rows.reduce((s, r) => s + r.cold, 0)
  const totalWarm = rows.reduce((s, r) => s + r.warm, 0)
  const speedup = (totalCold / totalWarm).toFixed(1)
  perfFoot.innerHTML = `共 ${rows.length} 个 studio · 无预加载合计 <b>${totalCold.toFixed(0)}ms</b> vs 有预加载 <b>${totalWarm.toFixed(0)}ms</b> · 整体提速 <b style="color:#16a34a">${speedup}×</b>。原理：IdlePrefetch 在浏览器空闲时把 entry HTML 拉进 HTTP disk cache，用户首次激活时直接命中，跳过 TCP/解析阶段。`

  perfBtn.disabled = false
}

function renderPerfRows(rows: PerfRow[]) {
  const max = Math.max(...rows.map((r) => Math.max(r.cold, r.warm)), 1)
  const legend = `
    <div class="perf-legend">
      <span><i style="background:#ef4444"></i>无预加载（cold fetch · 强制走网络）</span>
      <span><i style="background:#16a34a"></i>有预加载（HTTP cache 命中 · 模拟 idle prefetch 后）</span>
    </div>`
  const html = legend + rows.map((r) => {
    const coldW = (r.cold / max * 100).toFixed(1)
    const warmW = (r.warm / max * 100).toFixed(1)
    const sp = r.cold / r.warm
    const spClass = sp >= 1.5 ? '' : ' slow'
    return `
      <div class="perf-row">
        <div class="perf-name">${r.name}</div>
        <div class="perf-bars">
          <div class="perf-bar cold" style="width:${coldW}%"><span>${r.cold.toFixed(1)}ms</span></div>
          <div class="perf-bar warm" style="width:${warmW}%"><span>${r.warm.toFixed(1)}ms</span></div>
        </div>
        <div class="perf-speedup${spClass}">${sp.toFixed(1)}×</div>
      </div>`
  }).join('')
  perfBody.innerHTML = html
}

// ────────── metrics 面板 ──────────
const dash = document.getElementById('dash-body')!
setInterval(() => {
  const m = sandbox.metrics()
  dash.innerHTML = `
    <div>pool: ${m.poolSize} (peak ${m.poolPeak})</div>
    <div>keepAlive: ${m.keepAlive.length ? m.keepAlive.join(', ') : '—'}</div>
    <div>current: ${m.current ?? '—'}</div>
    <div>activate: ${m.activateCount} · fallback: ${m.fallbackCount}</div>
  `
}, 500)

// ────────── 日志面板 ──────────
const logEl = (() => {
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;left:12px;bottom:12px;max-width:42%;max-height:28vh;overflow:auto;background:rgba(0,0,0,.78);color:#eee;font-size:11px;font-family:monospace;padding:8px;border-radius:6px;z-index:100'
  document.body.appendChild(el)
  return el
})()
function log(html: string) {
  const line = document.createElement('div')
  line.innerHTML = new Date().toLocaleTimeString() + ' ' + html
  logEl.appendChild(line)
  logEl.scrollTop = logEl.scrollHeight
  while (logEl.children.length > 80) logEl.removeChild(logEl.firstChild!)
}
