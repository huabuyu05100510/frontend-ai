// ============================================================================
// wsFrame — 零依赖 WebSocket 握手 + 帧编解码（RFC 6455 子集）
//   仅用 Node 内置 crypto；只处理我们需要的：文本帧(0x1)/关闭(0x8)/ping(0x9)。
//   客户端→服务端帧必带掩码；服务端→客户端帧不掩码。
// ============================================================================

import { createHash } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export function acceptKey(secWebSocketKey) {
  return createHash('sha1')
    .update(secWebSocketKey + GUID)
    .digest('base64')
}

/** 服务端→客户端：编码不掩码文本帧 */
export function encodeTextFrame(str) {
  const data = Buffer.from(str, 'utf8')
  const len = data.length
  let header
  if (len < 126) {
    header = Buffer.from([0x81, len])
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, data])
}

/**
 * 解析缓冲区中的若干完整帧；不完整部分作为 rest 返回（供下次拼接）。
 * @returns {{ messages: Array<{fin:boolean,opcode:number,payload:Buffer}>, rest: Buffer }}
 */
export function decodeFrames(buffer) {
  const messages = []
  let off = 0
  while (true) {
    if (buffer.length - off < 2) break
    const b0 = buffer[off]
    const b1 = buffer[off + 1]
    const fin = (b0 & 0x80) !== 0
    const opcode = b0 & 0x0f
    const masked = (b1 & 0x80) !== 0
    let len = b1 & 0x7f
    let p = off + 2
    if (len === 126) {
      if (buffer.length - off < 4) break
      len = buffer.readUInt16BE(p)
      p += 2
    } else if (len === 127) {
      if (buffer.length - off < 10) break
      len = Number(buffer.readBigUInt64BE(p))
      p += 8
    }
    let mask
    if (masked) {
      if (buffer.length - p < 4) break
      mask = buffer.subarray(p, p + 4)
      p += 4
    }
    if (buffer.length - p < len) break
    let payload = buffer.subarray(p, p + len)
    if (masked) {
      const u = Buffer.allocUnsafe(len)
      for (let i = 0; i < len; i++) u[i] = payload[i] ^ mask[i & 3]
      payload = u
    }
    messages.push({ fin, opcode, payload })
    off = p + len
  }
  return { messages, rest: buffer.subarray(off) }
}
