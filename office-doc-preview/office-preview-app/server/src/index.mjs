// 入口：启动 HTTP 服务 + 首次扫描样本
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

// 加载 server/.env（AI key 等敏感配置不进 git）
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const envPath = path.resolve(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
  console.log(`[env] loaded ${envPath}`)
}

import { CONFIG } from './config.mjs'
import { route } from './router.mjs'
import { scanSamples } from './router.mjs'
import { loadTasks } from './store.mjs'
import { warmupAll } from './converter.mjs'

function ensureDirs() {
  for (const d of [CONFIG.DATA_DIR, CONFIG.UPLOAD_DIR, CONFIG.DERIVED_DIR]) {
    fs.mkdirSync(d, { recursive: true })
  }
}

const server = http.createServer((req, res) => {
  // 全局 CORP 头：允许跨域加载（Vite dev 的 COEP require-corp 需要）
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  route(req, res).catch(err => {
    console.error('[server] unhandled', err)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(err.message || err) }))
    }
  })
})

ensureDirs()
loadTasks()
server.listen(CONFIG.PORT, async () => {
  console.log(`\x1b[36m[server]\x1b[0m Office Preview 服务已启动: ${CONFIG.HOST}`)
  console.log(`  数据目录:   ${CONFIG.DATA_DIR}`)
  console.log(`  样本目录:   ${CONFIG.SAMPLES_DIR}`)
  // 后台预热 soffice 池（消除首转冷启动）
  warmupAll().catch(e => console.warn('[server] warmup skipped:', e?.message))
  // 启动时幂等扫描预置样本
  const n = scanSamples()
  if (n > 0) console.log(`\x1b[32m[server]\x1b[0m 已导入 ${n} 个样本文件`)
})
