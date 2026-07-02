// ============================================================
// OSS 本地签名服务（开发/试用用）—— 零第三方依赖，仅用 Node 内置模块
//   职责：用 AK/SK 在服务端签 PostObject policy（前端拿去直传 OSS）
//   密钥只存在于本机 .env，绝不下发到前端。
//
// 运行：  node server/oss-dev-server.mjs
// 依赖：  .env 中的 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET / OSS_REGION
// ============================================================

import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---- 极简 .env 解析（不引第三方）----
function loadEnv() {
  const envPath = path.resolve(__dirname, '../.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!m) continue
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val
  }
}
loadEnv()

const {
  OSS_ACCESS_KEY_ID,
  OSS_ACCESS_KEY_SECRET,
  OSS_BUCKET,
  OSS_REGION = 'oss-cn-hangzhou',
  OSS_DIR = 'uploads/',
  OSS_PUBLIC_READ = 'true',
  PORT = '5180',
} = process.env

if (!OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET || !OSS_BUCKET) {
  console.error('\x1b[31m[oss-dev-server] 缺少配置：请在 upload-engine/.env 填写 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET\x1b[0m')
  console.error('可复制 .env.example 为 .env 后填写。')
  process.exit(1)
}

const HOST = `https://${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com`
const PUBLIC_READ = OSS_PUBLIC_READ === 'true'
const MAX_BYTES = 2 * 1024 * 1024 * 1024 // 2GB

function hmacSha1Base64(key, str) {
  return crypto.createHmac('sha1', key).update(str, 'utf-8').digest('base64')
}

function safeExt(filename) {
  const ext = path.extname(filename || '').toLowerCase().replace(/[^.a-z0-9]/g, '')
  return ext || ''
}

function buildKey(filename) {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const rand = crypto.randomBytes(8).toString('hex')
  const dir = OSS_DIR.endsWith('/') ? OSS_DIR : OSS_DIR + '/'
  return `${dir}${ymd}/${rand}${safeExt(filename)}`
}

// 签 PostObject policy
function signPolicy(filename) {
  const key = buildKey(filename)
  const expiration = new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 分钟有效
  const policyDoc = {
    expiration,
    conditions: [
      { bucket: OSS_BUCKET },
      ['content-length-range', 0, MAX_BYTES],
      ['eq', '$key', key],
    ],
  }
  const policy = Buffer.from(JSON.stringify(policyDoc)).toString('base64')
  const signature = hmacSha1Base64(OSS_ACCESS_KEY_SECRET, policy)
  return {
    host: HOST,
    dir: OSS_DIR,
    key,
    policy,
    signature,
    OSSAccessKeyId: OSS_ACCESS_KEY_ID,
    publicRead: PUBLIC_READ,
  }
}

// 私有桶签名 GET URL（V1）
function signGetUrl(key) {
  const expires = Math.floor(Date.now() / 1000) + 3600 // 1 小时
  const canonical = `GET\n\n\n${expires}\n/${OSS_BUCKET}/${key}`
  const signature = hmacSha1Base64(OSS_ACCESS_KEY_SECRET, canonical)
  const q = new URLSearchParams({
    OSSAccessKeyId: OSS_ACCESS_KEY_ID,
    Expires: String(expires),
    Signature: signature,
  })
  return `${HOST}/${encodeURI(key)}?${q.toString()}`
}

function sendJSON(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  })
  res.end(body)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (req.method === 'OPTIONS') {
    sendJSON(res, 204, {})
    return
  }

  if (url.pathname === '/api/oss/policy') {
    const filename = url.searchParams.get('filename') || 'file'
    try {
      sendJSON(res, 200, signPolicy(filename))
    } catch (e) {
      sendJSON(res, 500, { error: String(e) })
    }
    return
  }

  if (url.pathname === '/api/oss/sign-get') {
    const key = url.searchParams.get('key')
    if (!key) return sendJSON(res, 400, { error: 'missing key' })
    sendJSON(res, 200, { url: signGetUrl(key) })
    return
  }

  if (url.pathname === '/' || url.pathname === '/health') {
    sendJSON(res, 200, { ok: true, host: HOST, publicRead: PUBLIC_READ, dir: OSS_DIR })
    return
  }

  sendJSON(res, 404, { error: 'not found' })
})

server.listen(Number(PORT), () => {
  console.log(`\x1b[32m[oss-dev-server]\x1b[0m 监听 http://localhost:${PORT}`)
  console.log(`  Bucket : ${OSS_BUCKET}`)
  console.log(`  Host   : ${HOST}`)
  console.log(`  公共读 : ${PUBLIC_READ}`)
  console.log(`  目录   : ${OSS_DIR}`)
  console.log(`  签名接口: GET /api/oss/policy?filename=xxx`)
})
