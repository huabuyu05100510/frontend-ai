/**
 * segment-encoder —— DOM/HTML → AlignedSegment
 *
 * 对标 tech-plan §3 segment-encoder.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeSegment, extractSegmentsFromHTML } from '../lib/segment-encoder.mjs'

test('encodeSegment: 纯文本', () => {
  const seg = encodeSegment('hello world')
  assert.deepEqual(seg.tokens, ['hello', 'world'])
  assert.equal(seg.tags.length, 0)
})

test('encodeSegment: 单 tag 包裹单 token', () => {
  const seg = encodeSegment('look at <em>this</em> now')
  assert.deepEqual(seg.tokens, ['look', 'at', 'this', 'now'])
  assert.equal(seg.tags.length, 1)
  // tag t1 wraps token index 2 ("this")
  assert.equal(seg.tagSpans[0].openToken, 2)
  assert.equal(seg.tagSpans[0].closeToken, 3)
})

test('encodeSegment: tag 跨多 token', () => {
  const seg = encodeSegment('visit <a href="/x">our great site</a> today')
  assert.deepEqual(seg.tokens, ['visit', 'our', 'great', 'site', 'today'])
  // tag wraps tokens 1..4 (our, great, site)
  assert.equal(seg.tagSpans[0].openToken, 1)
  assert.equal(seg.tagSpans[0].closeToken, 4)
  assert.deepEqual(seg.tagSpans[0].attrs, { href: '/x' })
})

test('encodeSegment: 多 tag 嵌套', () => {
  const seg = encodeSegment('<a href="/x"><em>link</em></a> outside')
  assert.deepEqual(seg.tokens, ['link', 'outside'])
  // 外层 t1 包 t2 包 link
  assert.equal(seg.tagSpans[0].openToken, 0)  // t1 (a)
  assert.equal(seg.tagSpans[0].closeToken, 1)
  assert.equal(seg.tagSpans[1].openToken, 0)  // t2 (em)
  assert.equal(seg.tagSpans[1].closeToken, 1)
})

test('encodeSegment: 多个独立 tag', () => {
  const seg = encodeSegment('<em>one</em> and <strong>two</strong>')
  assert.deepEqual(seg.tokens, ['one', 'and', 'two'])
  assert.equal(seg.tagSpans[0].openToken, 0)
  assert.equal(seg.tagSpans[0].closeToken, 1)
  assert.equal(seg.tagSpans[1].openToken, 2)
  assert.equal(seg.tagSpans[1].closeToken, 3)
})

test('encodeSegment: 占位符 text 正确（不含属性）', () => {
  const seg = encodeSegment('visit <a href="/foo">here</a>')
  // 占位符文本不应包含 href 等属性
  assert.ok(!seg.sourceText.includes('href'))
  assert.ok(!seg.sourceText.includes('/foo'))
  assert.ok(seg.sourceText.includes('⟦t1⟧'))
})

test('extractSegmentsFromHTML: 提取多个段落', () => {
  const html = '<p>First paragraph here.</p><p>Second <em>with tag</em> here.</p>'
  const segs = extractSegmentsFromHTML(html)
  assert.equal(segs.length, 2)
  assert.deepEqual(segs[0].tokens.slice(0, 3), ['First', 'paragraph', 'here'])
  assert.equal(segs[1].tags.length, 1)
  assert.equal(segs[1].tags[0].type, 'em')
})

test('extractSegmentsFromHTML: 跳过 script/style', () => {
  const html = `
    <p>visible text</p>
    <script>var hidden = "secret";</script>
    <style>.x { color: red }</style>
    <p>another visible</p>
  `
  const segs = extractSegmentsFromHTML(html)
  assert.equal(segs.length, 2)
  // 不应包含 hidden/secret 等
  const allText = segs.map(s => s.sourceText).join(' ')
  assert.ok(!allText.includes('hidden'))
  assert.ok(!allText.includes('secret'))
})

test('extractSegmentsFromHTML: h1/h2 也算段', () => {
  const html = '<h1>Title</h1><p>body</p>'
  const segs = extractSegmentsFromHTML(html)
  assert.equal(segs.length, 2)
})

test('extractSegmentsFromHTML: 太短的段落过滤', () => {
  const html = '<p>a</p><p>this is a longer paragraph</p>'
  const segs = extractSegmentsFromHTML(html)
  assert.equal(segs.length, 1, '< 4 字符的段落过滤掉')
  assert.equal(segs[0].tokens.join(' '), 'this is a longer paragraph')
})

test('encodeSegment: 中文 + tag（CJK 逐字 token）', () => {
  const seg = encodeSegment('看 <a href="/x">这里</a> 的详情')
  // CJK 单字 token
  assert.deepEqual(seg.tokens, ['看', '这', '里', '的', '详', '情'])
  // tag 包 "这","里" → token 索引 1..3
  assert.equal(seg.tagSpans[0].openToken, 1)
  assert.equal(seg.tagSpans[0].closeToken, 3)
  assert.deepEqual(seg.tagSpans[0].attrs, { href: '/x' })
})