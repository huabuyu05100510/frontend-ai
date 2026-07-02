// ============================================================================
// server — 零依赖协同服务端（http upgrade → WebSocket → CRDT 中转）
//   端口 PORT（默认 8787）。协议：
//     client→server: {t:'join',room} / {t:'op',update} / {t:'awareness',...}
//     server→client: {t:'snapshot',snapshot} / {t:'op',update} / {t:'awareness',...}
//   仅用 Node 内置模块（http/crypto），不依赖任何 npm 包。
// ============================================================================

import http from 'node:http'
import { statSync, createReadStream, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { acceptKey, encodeTextFrame, decodeFrames } from './wsFrame.mjs'
import { createRoom, applyUpdate, snapshot } from './room.mjs'
import { convertLegacy, convertToPdf, PDF_CACHE_DIR } from './convert.mjs'

const PORT = Number(process.env.PORT) || 8787
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Room ID 合法字符：字母/数字/连字符/下划线，长度 1-64 */
const ROOM_ID_RE = /^[a-zA-Z0-9_:.-]{1,64}$/
/** 最多同时存在的 room 数量，防止资源耗尽 */
const MAX_ROOMS = 1000
/** 单条 WebSocket 消息最大字节数（1 MB），防止 OOM 攻击 */
const MAX_MSG_BYTES = 1 * 1024 * 1024

function isValidRoomId(id) {
  return typeof id === 'string' && ROOM_ID_RE.test(id)
}

/** roomId -> { room, clients:Set<socket> } */
const rooms = new Map()
function getRoom(id) {
  let r = rooms.get(id)
  if (!r) {
    r = { room: createRoom(), clients: new Set() }
    rooms.set(id, r)
  }
  return r
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type, range')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'content-type, content-length, content-range, accept-ranges')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  const url = new URL(req.url, 'http://localhost')
  // GET /samples/:name — 提供 samples 目录下的静态文件（支持 Range 请求）
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/samples/')) {
    const filename = path.basename(url.pathname)
    const filePath = path.join(__dirname, '..', 'samples', filename)
    try {
      const stat = statSync(filePath)
      const fileSize = stat.size
      const range = req.headers.range
      const isRangeMode = url.searchParams.has('range')
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? Math.min(parseInt(parts[1], 10), fileSize - 1) : fileSize - 1
        const chunkSize = end - start + 1
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'application/pdf',
        })
        if (req.method !== 'HEAD') createReadStream(filePath, { start, end }).pipe(res)
        else res.end()
      } else if (isRangeMode && req.method === 'GET') {
        // ?range=1 模式：首次探测请求只返回首块 64KB（206），
        // 让 pdf.js 的 PDFFetchStream 识别 Range 支持而不下载全量文件
        const CHUNK = 64 * 1024
        const end = Math.min(CHUNK - 1, fileSize - 1)
        res.writeHead(206, {
          'Content-Range': `bytes 0-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end + 1,
          'Content-Type': 'application/pdf',
        })
        createReadStream(filePath, { start: 0, end }).pipe(res)
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': 'application/pdf',
          'Accept-Ranges': 'bytes',
        })
        if (req.method !== 'HEAD') createReadStream(filePath).pipe(res)
        else res.end()
      }
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Sample file not found')
    }
    return
  }
  // GET /pdf/:id — 流式提供 PDF 文件，支持 Range 请求（pdf.js 按需加载）
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/pdf/')) {
    const filename = path.basename(url.pathname) // 路径穿越防护
    const filePath = path.join(PDF_CACHE_DIR, filename)
    try {
      const stat = statSync(filePath)
      const fileSize = stat.size
      const range = req.headers.range
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? Math.min(parseInt(parts[1], 10), fileSize - 1) : fileSize - 1
        const chunkSize = end - start + 1
        console.log(`[pdf] Range: ${range} → ${(chunkSize / 1024).toFixed(1)}KB / ${(fileSize / 1024).toFixed(1)}KB total`)
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'application/pdf',
        })
        if (req.method !== 'HEAD') createReadStream(filePath, { start, end }).pipe(res)
        else res.end()
      } else {
        console.log(`[pdf] Full: ${(fileSize / 1024).toFixed(1)}KB`)
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': 'application/pdf',
          'Accept-Ranges': 'bytes',
        })
        if (req.method !== 'HEAD') createReadStream(filePath).pipe(res)
        else res.end()
      }
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('PDF not found or expired')
    }
    return
  }
  if (req.method === 'POST' && url.pathname === '/upload-pdf') {
    const chunks = []
    let total = 0
    req.on('data', (c) => {
      total += c.length
      if (total > 600 * 1024 * 1024) req.destroy()
      else chunks.push(c)
    })
    req.on('end', () => {
      try {
        const id = crypto.randomUUID()
        writeFileSync(path.join(PDF_CACHE_DIR, `${id}.pdf`), Buffer.concat(chunks))
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, url: `/pdf/${id}.pdf` }))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, reason: String(e?.message || e) }))
      }
    })
    return
  }
  if (req.method === 'POST' && url.pathname === '/convert-pdf') {
    const ext = (url.searchParams.get('ext') || '').toLowerCase()
    const chunks = []
    let total = 0
    req.on('data', (c) => {
      total += c.length
      if (total > 600 * 1024 * 1024) req.destroy()
      else chunks.push(c)
    })
    req.on('end', () => {
      convertToPdf(Buffer.concat(chunks), ext)
        .then((result) => {
          res.writeHead(result.ok ? 200 : 422, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(result))
        })
        .catch((e) => {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, reason: String(e && e.message ? e.message : e) }))
        })
    })
    return
  }
  if (req.method === 'POST' && url.pathname === '/convert') {
    const ext = (url.searchParams.get('ext') || '').toLowerCase()
    const chunks = []
    let total = 0
    req.on('data', (c) => {
      total += c.length
      if (total > 600 * 1024 * 1024) req.destroy() // 600MB 上限
      else chunks.push(c)
    })
    req.on('end', () => {
      try {
        const result = convertLegacy(Buffer.concat(chunks), ext)
        res.writeHead(result.ok ? 200 : 422, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(result))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, reason: String(e && e.message ? e.message : e) }))
      }
    })
    return
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('collab-server ok')
})

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key']
  if (!key) {
    socket.destroy()
    return
  }
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      '\r\n',
    ].join('\r\n'),
  )

  let buffer = Buffer.alloc(0)
  let bufferSize = 0
  let joined = null
  const send = (obj) => {
    if (!socket.writable) return
    socket.write(encodeTextFrame(JSON.stringify(obj)))
  }
  const broadcast = (obj, except) => {
    if (!joined) return
    const frame = encodeTextFrame(JSON.stringify(obj))
    for (const c of joined.clients) {
      if (c !== except && c.writable) c.write(frame)
    }
  }

  socket.on('data', (chunk) => {
    bufferSize += chunk.length
    if (bufferSize > MAX_MSG_BYTES) {
      // 单条消息超限，关闭连接防止 OOM
      socket.destroy()
      return
    }
    buffer = Buffer.concat([buffer, chunk])
    const { messages, rest } = decodeFrames(buffer)
    buffer = rest
    bufferSize = rest.length
    for (const m of messages) {
      if (m.opcode === 0x8) {
        socket.end()
        return
      }
      if (m.opcode !== 0x1) continue // 只处理文本
      let msg
      try {
        msg = JSON.parse(m.payload.toString('utf8'))
      } catch {
        continue
      }
      if (msg.t === 'join') {
        const roomId = String(msg.room || 'default')
        // 校验 room ID 格式
        if (!isValidRoomId(roomId)) {
          send({ t: 'error', reason: 'invalid room id' })
          socket.destroy()
          return
        }
        // 防止 room 数量无限增长
        if (!rooms.has(roomId) && rooms.size >= MAX_ROOMS) {
          send({ t: 'error', reason: 'server at capacity' })
          socket.destroy()
          return
        }
        joined = getRoom(roomId)
        joined.clients.add(socket)
        send({ t: 'snapshot', snapshot: snapshot(joined.room) })
      } else if (msg.t === 'op' && joined && msg.update) {
        const changed = applyUpdate(joined.room, msg.update)
        if (changed) broadcast({ t: 'op', update: msg.update }, socket)
      } else if (msg.t === 'awareness' && joined) {
        broadcast({ t: 'awareness', from: msg.from, state: msg.state }, socket)
      }
    }
  })

  const cleanup = () => {
    if (!joined) return
    joined.clients.delete(socket)
    // room 最后一个客户端离开后自动回收，防止空 room 无限积累
    if (joined.clients.size === 0) {
      for (const [id, r] of rooms) {
        if (r === joined) { rooms.delete(id); break }
      }
    }
  }
  socket.on('close', cleanup)
  socket.on('error', cleanup)
})

server.listen(PORT, () => {
  console.log(`[collab-server] listening on ws://localhost:${PORT}`)
})
