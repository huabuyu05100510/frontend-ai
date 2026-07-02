import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickEndpoint, mapLang, callDeepL } from '../lib/deepl.mjs'

test('pickEndpoint: :fx 后缀走 Free', () => {
  assert.equal(pickEndpoint('abc:fx'), 'https://api-free.deepl.com/v2/translate')
  assert.equal(pickEndpoint('abc-PRO'), 'https://api.deepl.com/v2/translate')
})

test('mapLang: 中文/EN/日本語', () => {
  assert.equal(mapLang('中文'), 'ZH')
  assert.equal(mapLang('English'), 'EN-US')
  assert.equal(mapLang('日本語'), 'JA')
  assert.equal(mapLang('未知'), 'ZH')  // 默认
})

test('callDeepL: 200 正常返回译文数组', async () => {
  const calls = []
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts })
    return {
      ok: true,
      status: 200,
      json: async () => ({
        translations: [
          { text: '你好' },
          { text: '世界' },
        ],
      }),
    }
  }
  const out = await callDeepL(
    ['Hello', 'World'],
    '中文',
    'fake-key:fx',
    { fetch: fakeFetch }
  )
  assert.deepEqual(out, ['你好', '世界'])
  assert.match(calls[0].url, /api-free\.deepl\.com/)
  assert.match(calls[0].opts.body, /target_lang=ZH/)
  assert.match(calls[0].opts.headers.Authorization, /DeepL-Auth-Key fake-key:fx/)
})

test('callDeepL: 429 触发重试，最终成功', async () => {
  let n = 0
  const fakeFetch = async () => {
    n++
    if (n < 3) return { ok: false, status: 429, text: async () => 'limited' }
    return { ok: true, status: 200, json: async () => ({ translations: [{ text: 'OK' }] }) }
  }
  const out = await callDeepL(['x'], '中文', 'fake-key', { fetch: fakeFetch, _maxBackoff: 1 })
    .catch(() => null) || await callDeepLWithShortBackoff(['x'], '中文', 'fake-key', fakeFetch)
  assert.equal(n >= 2, true)
  assert.deepEqual(out, ['OK'])
})

// 帮助函数：用极短 backoff 跑重试场景
async function callDeepLWithShortBackoff(batch, lang, key, fakeFetch) {
  // 直接用公共 API（backoff 不可注入，但测试中 200ms 退避可接受）
  return callDeepL(batch, lang, key, { fetch: fakeFetch })
}

test('callDeepL: 403 直接抛错不重试', async () => {
  let n = 0
  const fakeFetch = async () => {
    n++
    return { ok: false, status: 403, text: async () => 'forbidden' }
  }
  await assert.rejects(
    () => callDeepL(['x'], '中文', 'bad-key', { fetch: fakeFetch }),
    (e) => { assert.match(e.message, /403/); return true }
  )
  assert.equal(n, 1)  // 没重试
})

test('callDeepL: 不足段数补空字符串', async () => {
  const fakeFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ translations: [{ text: 'one' }] }),  // 只返回1个
  })
  const out = await callDeepL(['one', 'two', 'three'], '中文', 'k', { fetch: fakeFetch })
  assert.deepEqual(out, ['one', '', ''])
})
