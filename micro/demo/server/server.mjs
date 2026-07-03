import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import crypto from 'node:crypto'

const app = express()
const PORT = process.env.PROXY_PORT || 7183
app.use(express.json())

// 极简 cookie parser（避免额外依赖）
app.use((req, _res, next) => {
  req.cookies = {}
  const header = req.headers.cookie
  if (header) {
    for (const kv of header.split(';')) {
      const [k, ...v] = kv.trim().split('=')
      req.cookies[k] = decodeURIComponent(v.join('='))
    }
  }
  next()
})

// 灰度比例（配置中心热下发模拟，不重启）
let grayscaleRatio = 0 // 0 = 全 MPA, 1 = 全 SPA

// RUM 滚动窗口（最近 5 分钟），按 LCP/error 聚合
const rumWindow = []
const WINDOW_MS = 5 * 60 * 1000

// 灰度决策：cookie 优先，无 cookie 按 ratio 哈希
function decideBackend(req) {
  const cookieVal = req.cookies?.spa_rollout
  if (cookieVal === '1') return 'spa'
  if (cookieVal === '0') return 'mpa'
  // 按 userId 哈希，保证同一用户稳定走同一条链路
  const uid = req.cookies?.uid || req.ip || 'anon'
  const hash = crypto.createHash('md5').update(uid).digest('hex')
  const bucket = parseInt(hash.slice(0, 8), 16) / 0xffffffff
  return bucket < grayscaleRatio ? 'spa' : 'mpa'
}

// 老 MPA 链路：直接代理到 sub-apps 静态服务（mock 老服务）
const mpaProxy = createProxyMiddleware({
  target: 'http://localhost:7182',
  changeOrigin: true,
  pathRewrite: { '^/legacy': '' },
})

// SPA 链路：代理到 shell dev server 或 dist
const spaProxy = createProxyMiddleware({
  target: process.env.SPA_TARGET || 'http://localhost:7180',
  changeOrigin: true,
})

// 路由分流 —— 同一端口下，根据 cookie 自动决定走 SPA 还是 MPA
app.use((req, res, next) => {
  const backend = decideBackend(req)
  req.backend = backend
  // 不在 /api/* / /legacy/* 路径的根请求 → 分流
  if (req.path === '/' || req.path.match(/^\/(vue2-list|jquery-form|react-detail)/)) {
    if (req.path.startsWith('/legacy')) return next()
    if (backend === 'spa') {
      // 走 shell（vite dev 或 dist）
      return spaProxy(req, res, next)
    }
    // MPA 模式：根路径跳 vue2-list（mock 老 MPA 入口）
    if (req.path === '/') return res.redirect('/vue2-list/index.html')
    return mpaProxy(req, res, next)
  }
  next()
})

// /legacy/* —— 灰度回滚时的 MPA fallback 路径（始终走老 MPA）
app.use('/legacy', (req, res, next) => mpaProxy(req, res, next))

// 灰度配置 API
app.post('/api/grayscale', (req, res) => {
  const { ratio } = req.body || {}
  if (typeof ratio !== 'number' || ratio < 0 || ratio > 1) {
    return res.status(400).json({ error: 'ratio must be in [0, 1]' })
  }
  grayscaleRatio = ratio
  console.log(`[grayscale] ratio -> ${ratio}`)
  res.json({ ok: true, ratio: grayscaleRatio })
})

app.get('/api/grayscale', (_req, res) => {
  res.json({ ratio: grayscaleRatio })
})

// 紧急回滚（一秒切回 MPA）
app.post('/api/rollback', (_req, res) => {
  grayscaleRatio = 0
  console.log('[grayscale] emergency rollback -> 0')
  res.json({ ok: true, ratio: 0 })
})

// RUM beacon 接收
app.post('/api/rum/beacon', (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [req.body]
  const now = Date.now()
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue
    rumWindow.push({ ...ev, t: now })
  }
  // 清窗口外数据
  while (rumWindow.length && rumWindow[0].t < now - WINDOW_MS) rumWindow.shift()

  // 自动回滚检查（每条 beacon 后判断）
  const recent = rumWindow.filter((e) => e.t > now - 60_000)
  const lcps = recent.filter((e) => e.name === 'LCP').map((e) => e.value)
  const errors = recent.filter((e) => e.type === 'error').length
  if (lcps.length >= 5) {
    const p95 = lcps.sort((a, b) => a - b)[Math.floor(lcps.length * 0.95)]
    if (p95 > 2500 && grayscaleRatio > 0) {
      console.warn(`[rum] LCP P95=${p95}ms > 2500ms, auto-rollback`)
      grayscaleRatio = 0
    }
  }
  if (errors > 10 && grayscaleRatio > 0) {
    console.warn(`[rum] error rate too high (${errors}/min), auto-rollback`)
    grayscaleRatio = 0
  }
  res.json({ ok: true, ratio: grayscaleRatio })
})

app.get('/api/rum/stats', (_req, res) => {
  const now = Date.now()
  const recent = rumWindow.filter((e) => e.t > now - WINDOW_MS)
  const lcps = recent.filter((e) => e.name === 'LCP').map((e) => e.value).sort((a, b) => a - b)
  const p = (q) => (lcps.length ? lcps[Math.floor(lcps.length * q)] : null)
  res.json({
    window: WINDOW_MS,
    count: recent.length,
    lcp: { p50: p(0.5), p90: p(0.9), p95: p(0.95), p99: p(0.99) },
    errors: recent.filter((e) => e.type === 'error').length,
    grayscaleRatio,
  })
})

app.listen(PORT, () => {
  console.log(`[proxy] http://localhost:${PORT}`)
  console.log(`[proxy] grayscale ratio = ${grayscaleRatio} (POST /api/grayscale {ratio} to update)`)
})
