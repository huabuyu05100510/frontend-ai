/**
 * logger —— 结构化日志单测
 *
 * 模型：Claude (Sonnet 4.5)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createLogger, genReqId, setMinLevel } from '../lib/logger.mjs'

function captureStream(streamName) {
  const writes = []
  const stream = streamName === 'stderr' ? process.stderr : process.stdout
  const orig = stream.write.bind(stream)
  // 临时替换
  stream.write = (chunk) => {
    writes.push(String(chunk))
    return true
  }
  return {
    writes,
    restore() { stream.write = orig },
  }
}

test('genReqId: 单调递增、格式含 pid', () => {
  const a = genReqId()
  const b = genReqId()
  assert.ok(a !== b, '两次调用应不同')
  assert.match(a, /^r[0-9a-z]+_[0-9a-z]+$/, `格式应为 r<base36 pid>_<base36 counter>: ${a}`)
})

test('createLogger: 输出 JSON line，含 ts/level/component/msg', () => {
  const cap = captureStream('stdout')
  const log = createLogger('server')
  log.info('hello', { foo: 'bar' })
  cap.restore()

  assert.equal(cap.writes.length, 1)
  const parsed = JSON.parse(cap.writes[0])
  assert.equal(parsed.level, 'info')
  assert.equal(parsed.component, 'server')
  assert.equal(parsed.msg, 'hello')
  assert.equal(parsed.foo, 'bar')
  assert.ok(typeof parsed.ts === 'number')
})

test('createLogger: warn/error 走 stderr', () => {
  const cap = captureStream('stderr')
  const log = createLogger('server')
  log.warn('careful', { code: 1 })
  log.error('boom')
  cap.restore()

  assert.equal(cap.writes.length, 2)
  JSON.parse(cap.writes[0]) // 不抛即合法 JSON
  JSON.parse(cap.writes[1])
})

test('createLogger: debug 默认不输出（minLevel=info）', () => {
  const cap = captureStream('stdout')
  setMinLevel('info')
  const log = createLogger('x')
  log.debug('hidden')
  cap.restore()
  assert.equal(cap.writes.length, 0)
})

test('createLogger: setMinLevel(debug) 后 debug 输出', () => {
  const cap = captureStream('stdout')
  setMinLevel('debug')
  const log = createLogger('x')
  log.debug('visible')
  cap.restore()
  setMinLevel('info') // 还原
  assert.equal(cap.writes.length, 1)
  assert.equal(JSON.parse(cap.writes[0]).msg, 'visible')
})
