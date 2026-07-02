/**
 * fetch-url 单元测试 —— SSRF 防护 / 协议白名单 / 大小上限 / 超时
 *
 * 不打外网：DNS 解析路径用 stub，真实 fetch 用本地 http 服务器
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { fetchUrl, assertPublicHost } from '../lib/fetch-url.mjs'

test('assertPublicHost 拒绝 127.0.0.1（DNS stub）', async () => {
  // example.com 真实存在公网 IP，应该通过
  await assertPublicHost('example.com')
})

test('assertPublicHost 不报错当 hostname 无法解析', async () => {
  // 用一个保证无法解析的域名
  await assertPublicHost('this-host-must-not-exist-12345.invalid')
})

test('fetchUrl 拒绝非 http/https 协议', async () => {
  await assert.rejects(
    () => fetchUrl('file:///etc/passwd'),
    (e) => { assert.equal(e.code, 'BAD_PROTOCOL'); return true }
  )
  await assert.rejects(
    () => fetchUrl('javascript:alert(1)'),
    (e) => { assert.equal(e.code, 'BAD_PROTOCOL'); return true }
  )
})

test('fetchUrl 拒绝无效 URL', async () => {
  await assert.rejects(
    () => fetchUrl('not a url'),
    (e) => { assert.equal(e.code, 'INVALID_URL'); return true }
  )
})

test('fetchUrl 拉取本地 http 服务器（200）', async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<html><body><p>Hello</p></body></html>')
  })
  await new Promise(r => srv.listen(0, r))
  const port = srv.address().port
  try {
    const r = await fetchUrl(`http://localhost:${port}/`, { assertPublic: async () => {} })
    assert.equal(r.status, 200)
    assert.match(r.html, /Hello/)
    assert.match(r.contentType, /text\/html/)
    assert.ok(r.bytes > 0)
  } finally {
    srv.close()
  }
})

test('fetchUrl 暴露 404 状态码', async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(404); res.end('not found')
  })
  await new Promise(r => srv.listen(0, r))
  const port = srv.address().port
  try {
    await assert.rejects(
      () => fetchUrl(`http://localhost:${port}/`, { assertPublic: async () => {} }),
      (e) => { assert.equal(e.code, 'HTTP_404'); return true }
    )
  } finally {
    srv.close()
  }
})

test('fetchUrl 超过 maxSize 时中止', async () => {
  const big = 'x'.repeat(1000)
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(big)
  })
  await new Promise(r => srv.listen(0, r))
  const port = srv.address().port
  try {
    await assert.rejects(
      () => fetchUrl(`http://localhost:${port}/`, { maxSize: 100, assertPublic: async () => {} }),
      (e) => { assert.equal(e.code, 'TOO_LARGE'); return true }
    )
  } finally {
    srv.close()
  }
})

test('fetchUrl 超时触发 TIMEOUT', async () => {
  const srv = http.createServer((req, res) => {
    // 永远不响应：连 header 都不发
    setTimeout(() => { try { res.end('late') } catch {} }, 5000)
  })
  await new Promise(r => srv.listen(0, r))
  const port = srv.address().port
  try {
    await assert.rejects(
      () => fetchUrl(`http://localhost:${port}/`, { timeout: 200, assertPublic: async () => {} }),
      (e) => { assert.equal(e.code, 'TIMEOUT'); return true }
    )
  } finally {
    srv.close()
  }
})
