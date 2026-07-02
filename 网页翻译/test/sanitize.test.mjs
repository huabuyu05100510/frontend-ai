/**
 * sanitize —— HTML 输出消毒层单测
 *
 * 模型：Claude (Sonnet 4.5)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  escapeAttr, escapeText, sanitizeUrl, sanitizeAttrs,
  TAG_WHITELIST, ATTR_DENYLIST, URL_ATTRS, isTagAllowed,
} from '../lib/sanitize.mjs'

// ─── escapeAttr ─────────────────────────────────────────
test('escapeAttr: 转义 5 字符', () => {
  assert.equal(escapeAttr('a&b<c>"d\'e'), 'a&amp;b&lt;c&gt;&quot;d&#39;e')
  assert.equal(escapeAttr(undefined), 'undefined')
  assert.equal(escapeAttr(42), '42')
})

test('escapeText: 转义 3 字符', () => {
  assert.equal(escapeText('a<b&c>d'), 'a&lt;b&amp;c&gt;d')
})

// ─── sanitizeUrl ───────────────────────────────────────
test('sanitizeUrl: 放行 http/https/mailto/tel', () => {
  for (const u of ['http://x.com/a', 'https://x.com', 'mailto:a@b.com', 'tel:+86138']) {
    assert.equal(sanitizeUrl(u), u)
  }
})

test('sanitizeUrl: 放行相对路径/锚点/查询/protocol-relative', () => {
  for (const u of ['/abs/path', './rel', '#anchor', '?q=1', '//cdn.x.com/a.js']) {
    assert.equal(sanitizeUrl(u), u)
  }
})

test('sanitizeUrl: 拒绝 javascript:/vbscript:/data:', () => {
  for (const u of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'vbscript:msgbox', 'data:text/html,<script>']) {
    assert.equal(sanitizeUrl(u), '', `应拒绝 ${u}`)
  }
})

test('sanitizeUrl: 含控制字符拒绝', () => {
  assert.equal(sanitizeUrl('java\tscript:alert(1)'), '')
  assert.equal(sanitizeUrl('http://x.com\x00'), '')
})

test('sanitizeUrl: 空/null/undefined', () => {
  assert.equal(sanitizeUrl(''), '')
  assert.equal(sanitizeUrl(null), '')
  assert.equal(sanitizeUrl(undefined), '')
})

// ─── sanitizeAttrs ─────────────────────────────────────
test('sanitizeAttrs: 剔除 on* 事件 handler', () => {
  const out = sanitizeAttrs({
    href: '/x',
    onclick: 'alert(1)',
    onerror: 'alert(2)',
    ONLOAD: 'alert(3)',
    class: 'foo',
  })
  assert.deepEqual(out, { href: '/x', class: 'foo' })
})

test('sanitizeAttrs: 剔除 style/srcset/formaction', () => {
  const out = sanitizeAttrs({
    style: 'background:url(javascript:alert(1))',
    srcset: '/x 1x',
    formaction: 'javascript:alert(1)',
    class: 'ok',
  })
  assert.deepEqual(out, { class: 'ok' })
})

test('sanitizeAttrs: URL attrs 走 sanitizeUrl', () => {
  const out = sanitizeAttrs({
    href: 'javascript:alert(1)',
    src: 'http://ok.com/a.png',
    action: 'vbscript:x',
  })
  assert.deepEqual(out, { src: 'http://ok.com/a.png' })
})

test('sanitizeAttrs: hooks.onDeny 触发', () => {
  const denied = []
  sanitizeAttrs({ onclick: 'x', href: 'javascript:1' }, {
    onDeny: (k, v) => denied.push([k, v]),
  })
  assert.equal(denied.length, 2)
  assert.deepEqual(denied[0], ['onclick', 'x'])
})

// ─── TAG / ATTR 配置 ───────────────────────────────────
test('TAG_WHITELIST: 包含 p/a/em/ul/li/td/table', () => {
  for (const t of ['p', 'a', 'em', 'ul', 'li', 'td', 'table', 'div', 'span']) {
    assert.ok(TAG_WHITELIST.has(t), `应有 ${t}`)
  }
})

test('TAG_WHITELIST: 不含 script/iframe/object/embed', () => {
  for (const t of ['script', 'iframe', 'object', 'embed', 'svg', 'math']) {
    assert.ok(!TAG_WHITELIST.has(t), `不应有 ${t}`)
  }
})

test('isTagAllowed: 大小写不敏感', () => {
  assert.equal(isTagAllowed('P'), true)
  assert.equal(isTagAllowed('SCRIPT'), false)
})

test('URL_ATTRS: 包含 href/src/action', () => {
  for (const a of ['href', 'src', 'action']) {
    assert.ok(URL_ATTRS.has(a))
  }
})
