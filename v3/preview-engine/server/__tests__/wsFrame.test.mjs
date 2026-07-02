import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptKey, encodeTextFrame, decodeFrames } from '../wsFrame.mjs'

test('acceptKey 符合 RFC6455 示例向量', () => {
  // RFC6455 4.2.2：key 'dGhlIHNhbXBsZSBub25jZQ==' → 's3pPLMBiTxaQ9kYGzzhZRbK+xOo='
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
})

test('encodeTextFrame：小负载头部正确', () => {
  const f = encodeTextFrame('hi')
  assert.equal(f[0], 0x81) // FIN + text
  assert.equal(f[1], 2) // 未掩码 + 长度 2
  assert.equal(f.subarray(2).toString('utf8'), 'hi')
})

test('encodeTextFrame：中等负载用 126 扩展长度', () => {
  const s = 'x'.repeat(200)
  const f = encodeTextFrame(s)
  assert.equal(f[0], 0x81)
  assert.equal(f[1], 126)
  assert.equal(f.readUInt16BE(2), 200)
  assert.equal(f.subarray(4).toString('utf8'), s)
})

// 构造一个客户端→服务端的「掩码」文本帧
function maskedTextFrame(str) {
  const data = Buffer.from(str, 'utf8')
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78])
  const masked = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i & 3]
  return Buffer.concat([Buffer.from([0x81, 0x80 | data.length]), mask, masked])
}

test('decodeFrames：解掩码还原文本', () => {
  const { messages, rest } = decodeFrames(maskedTextFrame('hello'))
  assert.equal(messages.length, 1)
  assert.equal(messages[0].opcode, 0x1)
  assert.equal(messages[0].payload.toString('utf8'), 'hello')
  assert.equal(rest.length, 0)
})

test('decodeFrames：多帧粘包一次解析', () => {
  const buf = Buffer.concat([maskedTextFrame('a'), maskedTextFrame('bc')])
  const { messages } = decodeFrames(buf)
  assert.equal(messages.length, 2)
  assert.equal(messages[0].payload.toString('utf8'), 'a')
  assert.equal(messages[1].payload.toString('utf8'), 'bc')
})

test('decodeFrames：半包保留 rest 不丢字节', () => {
  const full = maskedTextFrame('partial')
  const half = full.subarray(0, 5) // 不完整
  const { messages, rest } = decodeFrames(half)
  assert.equal(messages.length, 0)
  assert.equal(rest.length, half.length)
})

test('decodeFrames：识别 close 帧 opcode', () => {
  // close 帧（掩码、空负载）：0x88, 0x80, mask4
  const close = Buffer.from([0x88, 0x80, 0, 0, 0, 0])
  const { messages } = decodeFrames(close)
  assert.equal(messages[0].opcode, 0x8)
})
