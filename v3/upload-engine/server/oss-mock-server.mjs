// ============================================================
// 本地「假 OSS」服务 —— 零云账号 / 零额度跑通整条直传链路
//   完整模拟阿里云 OSS 的三步：
//     ① GET  /api/oss/policy   返回签名（mock，不校验）
//     ② POST /                 PostObject 表单直传 → 落盘到 .oss-data/
//     ③ GET  /<key>            回显读取（带正确 Content-Type）
//   与真实 OSS 共用同一个前端适配器（createOSSAdapter），
//   有额度后改用 `npm run dev:oss` 即可，前端代码零改动。
// ============================================================

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '.oss-data')
const PORT = Number(process.env.PORT || 5180)
const HOST = `http://localhost:${PORT}`
const DIR = 'uploads/'

fs.mkdirSync(DATA_DIR, { recursive: true })

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
}

function cors(res, extra = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Expose-Headers', 'ETag')
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v)
}

function sendJSON(res, code, data) {
  cors(res, { 'Content-Type': 'application/json; charset=utf-8' })
  res.writeHead(code)
  res.end(JSON.stringify(data))
}

function safeExt(name) {
  return (path.extname(name || '') || '').toLowerCase().replace(/[^.a-z0-9]/g, '')
}

function buildKey(filename) {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const rand = Math.random().toString(36).slice(2, 10)
  return `${DIR}${ymd}/${rand}${safeExt(filename)}`
}

// ---- 二进制安全的 multipart/form-data 解析（零依赖）----
function parseMultipart(buf, boundary) {
  const fields = {}
  const delim = Buffer.from(`--${boundary}`)
  const CRLF = Buffer.from('\r\n')
  let start = buf.indexOf(delim)
  if (start === -1) return fields
  start += delim.length
  while (start < buf.length) {
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break // 结尾 "--"
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2
    const next = buf.indexOf(delim, start)
    if (next === -1) break
    let end = next
    if (buf[end - 2] === 0x0d && buf[end - 1] === 0x0a) end -= 2
    const part = buf.slice(start, end)
    const headerEnd = part.indexOf(Buffer.concat([CRLF, CRLF]))
    if (headerEnd !== -1) {
      const header = part.slice(0, headerEnd).toString('utf-8')
      const body = part.slice(headerEnd + 4)
      const name = header.match(/name="([^"]*)"/i)?.[1]
      const filename = header.match(/filename="([^"]*)"/i)?.[1]
      if (name) fields[name] = { data: body, filename }
    }
    start = next + delim.length
  }
  return fields
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, HOST)

  if (req.method === 'OPTIONS') {
    cors(res)
    res.writeHead(204)
    res.end()
    return
  }

  // ① 签名（mock）
  if (req.method === 'GET' && url.pathname === '/api/oss/policy') {
    const filename = url.searchParams.get('filename') || 'file'
    sendJSON(res, 200, {
      host: HOST,
      dir: DIR,
      key: buildKey(filename),
      policy: 'mock-policy',
      signature: 'mock-signature',
      OSSAccessKeyId: 'mock-akid',
      publicRead: true,
    })
    return
  }

  // ② PostObject 直传
  if (req.method === 'POST' && url.pathname === '/') {
    const ct = req.headers['content-type'] || ''
    const boundary = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i)
    if (!boundary) return sendJSON(res, 400, { error: 'no boundary' })
    const body = await readBody(req)
    const fields = parseMultipart(body, boundary[1] || boundary[2])
    const key = fields.key?.data.toString('utf-8')
    const file = fields.file
    if (!key || !file) return sendJSON(res, 400, { error: 'missing key or file' })

    const dest = path.join(DATA_DIR, key)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, file.data)
    console.log(`\x1b[32m[mock-oss]\x1b[0m 保存 ${key}  (${file.data.length} bytes)`)

    const status = fields.success_action_status?.data.toString('utf-8') || '204'
    cors(res, { ETag: `"${Date.now().toString(16)}"` })
    res.writeHead(Number(status) || 200)
    res.end()
    return
  }

  // ③ 回显读取
  if (req.method === 'GET') {
    const key = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const filePath = path.join(DATA_DIR, key)
    if (key && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      cors(res, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' })
      res.writeHead(200)
      fs.createReadStream(filePath).pipe(res)
      return
    }
    if (url.pathname === '/' || url.pathname === '/health') {
      return sendJSON(res, 200, { ok: true, mock: true, host: HOST, dir: DIR })
    }
    return sendJSON(res, 404, { error: 'not found' })
  }

  sendJSON(res, 405, { error: 'method not allowed' })
})

server.listen(PORT, () => {
  console.log(`\x1b[36m[mock-oss]\x1b[0m 假 OSS 服务已启动 ${HOST}`)
  console.log(`  无需任何云账号 / 额度，文件落盘到: ${path.relative(process.cwd(), DATA_DIR)}/`)
  console.log(`  ① 签名: GET ${HOST}/api/oss/policy?filename=xxx`)
  console.log(`  ② 直传: POST ${HOST}/`)
  console.log(`  ③ 回显: GET ${HOST}/<key>`)
  console.log(`  前端开「直传 OSS」开关即可测试。`)
})
