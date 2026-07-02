/**
 * URL 抓取模块 —— 绕开浏览器 CORS，在服务端拉取目标网页 HTML
 *
 * 设计：
 * 1. SSRF 防护：拒绝私有/回环/链路本地 IP（解析 hostname 后检查）
 * 2. 协议白名单：只允许 http/https
 * 3. 大小上限：默认 5MB，防止内存爆炸
 * 4. 超时：默认 10s
 * 5. 强制 charset=utf-8（目标站点若返回GBK 等，UTF-8 解码失败也不崩）
 *
 * 可观测：结构化日志（fetch.start/done/failed）
 */

import dns from 'node:dns/promises'

const PRIVATE_PATTERNS = [
  /^127\./,                          // loopback v4
  /^10\./,                           // private 10/8
  /^172\.(1[6-9]|2\d|3[01])\./,     // private 172.16/12
  /^192\.168\./,                    // private 192.168/16
  /^169\.254\./,                    // link-local
  /^0\./,                            // 0.0.0.0/8
  /^::1$/,                           // loopback v6
  /^fc/,                            // ULA v6
  /^fe/,                            // link-local v6
  /^fd/,                            // ULA v6
]

/**
 * 解析 hostname → 检查所有解析出的 IP 是否都不在私网范围
 * @param {string} hostname
 * @throws {Error} 若解析到私网 IP（SSRF 拒绝）
 */
export async function assertPublicHost(hostname) {
  let addrs
  try {
    addrs = await dns.resolve(hostname)
  } catch (e) {
    // 解析失败：交给上游 fetch 去报错（可能 NXDOMAIN 等真实网络问题）
    return
  }
  for (const ip of addrs) {
    if (PRIVATE_PATTERNS.some(re => re.test(ip))) {
      const err = new Error(`SSRF blocked: ${hostname} → ${ip}`)
      err.code = 'SSRF_BLOCKED'
      throw err
    }
  }
}

/**
 * 抓取 URL，返回 { url, html, contentType, status }
 *
 * @param {string} urlStr
 * @param {{ timeout?: number, maxSize?: number, log?: { info?:Function, warn?:Function, error?:Function } }} [opts]
 */
export async function fetchUrl(urlStr, opts = {}) {
  const timeout = opts.timeout ?? 10000
  const maxSize = opts.maxSize ?? 5 * 1024 * 1024
  const log = opts.log || console
  // 可注入 SSRF 检查函数（默认走 assertPublicHost，测试可传 noop）
  const assertPublic = opts.assertPublic || assertPublicHost

  let u
  try {
    u = new URL(urlStr)
  } catch {
    const err = new Error('invalid url')
    err.code = 'INVALID_URL'
    throw err
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    const err = new Error(`protocol not allowed: ${u.protocol}`)
    err.code = 'BAD_PROTOCOL'
    throw err
  }

  await assertPublic(u.hostname)

  log.info?.('fetch.start', { url: u.href, timeout, maxSize })

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)

  const t0 = Date.now()
  try {
    const r = await fetch(u.href, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; WebpageTranslator/1.0)',
        accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
    })
    if (!r.ok) {
      const err = new Error(`fetch ${r.status}`)
      err.code = 'HTTP_' + r.status
      err.status = r.status
      throw err
    }

    // 流式读，超 maxSize 立即中止
    const reader = r.body.getReader()
    const chunks = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxSize) {
        await reader.cancel()
        const err = new Error(`body too large (>${maxSize} bytes)`)
        err.code = 'TOO_LARGE'
        throw err
      }
      chunks.push(value)
    }
    const buf = Buffer.concat(chunks)
    const html = buf.toString('utf-8')  // 强制 utf-8，对非 utf-8 站点可能出现乱码但保证不崩
    const contentType = r.headers.get('content-type') || 'text/html; charset=utf-8'

    log.info?.('fetch.done', { url: u.href, status: r.status, bytes: size, costMs: Date.now() - t0 })

    return {
      url: r.url,
      html,
      contentType,
      status: r.status,
      bytes: size,
    }
  } catch (e) {
    let out = e
    if (ctrl.signal.aborted) {
      out = new Error(`timeout after ${timeout}ms`)
      out.code = 'TIMEOUT'
      out.cause = e
    } else if (e.name === 'AbortError' || e.code === 20 || e.code === 'ABORT_ERR') {
      out = new Error(`timeout after ${timeout}ms`)
      out.code = 'TIMEOUT'
      out.cause = e
    }
    log.warn?.('fetch.failed', { url: u.href, err: out.message, code: out.code, costMs: Date.now() - t0 })
    throw out
  } finally {
    clearTimeout(timer)
  }
}
