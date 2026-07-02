// multipart/form-data 解析（零依赖）。上传先 readBody 收进 Buffer，
// 再用 parseMultipart 切分 part（已验证字节正确）。
import fs from 'node:fs'

const CRLF = Buffer.from('\r\n')
const CRLFCRLF = Buffer.from('\r\n\r\n')

// 把整 body 收进 Buffer（含大小上限校验）
export function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let aborted = false
    req.on('data', c => {
      size += c.length
      if (maxBytes && size > maxBytes) {
        aborted = true
        reject(new Error('FILE_TOO_LARGE'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => { if (!aborted) resolve(Buffer.concat(chunks)) })
    req.on('error', reject)
  })
}

export function parseMultipart(buf, boundary) {
  const fields = {}
  const delim = Buffer.from(`--${boundary}`)
  let start = buf.indexOf(delim)
  if (start === -1) return fields
  start += delim.length
  while (start < buf.length) {
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break
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
