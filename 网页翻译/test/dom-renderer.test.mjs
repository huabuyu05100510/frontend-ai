/**
 * dom-renderer —— projected span + tokens → HTML 字符串
 *
 * 浏览器侧再把字符串挂到 Shadow DOM
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderHTML, renderToFragment } from '../lib/dom-renderer.mjs'

// ─── renderHTML 纯字符串版本（Node 可测） ───────────────
test('renderHTML: 纯文本无 span', () => {
  const html = renderHTML({
    tokens: ['hello', 'world'],
    originalTags: [],
    projectedSpans: [],
  })
  assert.equal(html, '<p>hello world</p>')
})

test('renderHTML: 单 span 包裹单 token', () => {
  const html = renderHTML({
    tokens: ['Visit', 'our', 'great', 'site'],
    originalTags: [{ id: 't1', type: 'a', attrs: { href: '/x' } }],
    projectedSpans: [{ tagId: 't1', open: 1, close: 2, score: 1.5 }],
  })
  assert.equal(html, '<p>Visit <a href="/x">our</a> great site</p>')
})

test('renderHTML: CJK 单字 token 之间无空格（CJK 紧贴规则）', () => {
  const html = renderHTML({
    tokens: ['看', '这', '里', '的', '详', '情'],
    originalTags: [{ id: 't1', type: 'a', attrs: { href: '/x' } }],
    projectedSpans: [{ tagId: 't1', open: 1, close: 3, score: 1.5 }],
  })
  assert.equal(html, '<p>看<a href="/x">这里</a>的详情</p>')
})

test('renderHTML: 单 span 包裹多 token', () => {
  const html = renderHTML({
    tokens: ['visit', 'our', 'great', 'site', 'today'],
    originalTags: [{ id: 't1', type: 'a', attrs: { href: '/x' } }],
    projectedSpans: [{ tagId: 't1', open: 1, close: 4, score: 2 }],
  })
  assert.equal(html, '<p>visit <a href="/x">our great site</a> today</p>')
})

test('renderHTML: 空 span → 不渲染标签', () => {
  const html = renderHTML({
    tokens: ['看', '这', '里'],
    originalTags: [{ id: 't1', type: 'a', attrs: {} }],
    projectedSpans: [{ tagId: 't1', open: 0, close: 0, score: 0 }],  // 标签内容未翻译
  })
  assert.equal(html, '<p>看这里</p>')
})

test('renderHTML: 多独立 span（latin token）', () => {
  const html = renderHTML({
    tokens: ['See', 'this', 'and', 'that'],
    originalTags: [
      { id: 't1', type: 'a', attrs: { href: '/a' } },
      { id: 't2', type: 'a', attrs: { href: '/b' } },
    ],
    projectedSpans: [
      { tagId: 't1', open: 1, close: 2, score: 1 },
      { tagId: 't2', open: 3, close: 4, score: 1 },
    ],
  })
  assert.equal(html, '<p>See <a href="/a">this</a> and <a href="/b">that</a></p>')
})

test('renderHTML: 嵌套 span → 内层先开后关', () => {
  const html = renderHTML({
    tokens: ['看', '链', '接', '文', '字'],
    originalTags: [
      { id: 't1', type: 'a', attrs: { href: '/x' } },
      { id: 't2', type: 'em', attrs: {} },
    ],
    projectedSpans: [
      { tagId: 't1', open: 1, close: 4, score: 1 },
      { tagId: 't2', open: 2, close: 3, score: 1 },
    ],
  })
  // 嵌套结构 + 闭合顺序正确
  assert.match(html, /<a href="\/x">[^<]*<em>[^<]*<\/em>[^<]*<\/a>/, 'a 包 em，em 在 a 内部')
})

test('renderHTML: span 引用未知 tag → 跳过', () => {
  const html = renderHTML({
    tokens: ['a', 'b'],
    originalTags: [],
    projectedSpans: [{ tagId: 't_unknown', open: 0, close: 1, score: 1 }],
  })
  assert.equal(html, '<p>a b</p>')
})

test('renderHTML: javascript: 协议被 sanitizeUrl 拒绝', () => {
  const html = renderHTML({
    tokens: ['x'],
    originalTags: [{ id: 't1', type: 'a', attrs: { href: 'javascript:alert(1)' } }],
    projectedSpans: [{ tagId: 't1', open: 0, close: 1, score: 1 }],
  })
  // 危险协议被剔除，输出无 href 的空 <a>
  assert.ok(html.includes('<a>x</a>'), `实际输出: ${html}`)
  assert.ok(!html.includes('javascript:'), `javascript: 应被剔除: ${html}`)
})

test('renderHTML: onerror handler 被剔除', () => {
  const html = renderHTML({
    tokens: ['x'],
    originalTags: [{ id: 't1', type: 'a', attrs: { href: '/ok', onerror: 'alert(1)' } }],
    projectedSpans: [{ tagId: 't1', open: 0, close: 1, score: 1 }],
  })
  assert.ok(html.includes('href="/ok"'))
  assert.ok(!html.includes('onerror'), `onerror 应被剔除: ${html}`)
})

test('renderHTML: 非 whitelist tag 被整段丢', () => {
  const html = renderHTML({
    tokens: ['x'],
    originalTags: [{ id: 't1', type: 'script', attrs: { src: '/evil.js' } }],
    projectedSpans: [{ tagId: 't1', open: 0, close: 1, score: 1 }],
  })
  assert.ok(!html.includes('script'), `script 应被剔除: ${html}`)
  assert.equal(html, '<p>x</p>')
})

test('renderHTML: 自定义 wrapper 标签', () => {
  const html = renderHTML({
    tokens: ['title'],
    originalTags: [],
    projectedSpans: [],
    wrapper: 'h1',
  })
  assert.equal(html, '<h1>title</h1>')
})

test('renderHTML: 不传 wrapper → 默认 p', () => {
  const html = renderHTML({ tokens: ['x'], originalTags: [], projectedSpans: [] })
  assert.ok(html.startsWith('<p>'))
  assert.ok(html.endsWith('</p>'))
})

// ─── renderToFragment —— 浏览器侧（playwright 测）─────
test('renderToFragment: 存在但需要 document', () => {
  assert.equal(typeof renderToFragment, 'function')
})