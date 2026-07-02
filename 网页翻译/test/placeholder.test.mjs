/**
 * 占位符 codec —— 单元测试
 *
 * 占位符 schema（对标 tech-plan §2.3）：
 *   ⟦t1⟧ 词  ⟦/t1⟧
 *
 * 用 ⟦ ⟧ 而非 <> 避免 LLM 把它当 HTML 解析/翻译。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { encode, decode, extractPlaceholderIds } from '../lib/placeholder.mjs'

// ─── encode ─────────────────────────────────────────────
test('encode: 空串 → 空', () => {
  assert.deepEqual(encode(''), { text: '', tags: [] })
})

test('encode: 纯文本 → 占位符为 0，tags 为空', () => {
  const r = encode('今天买了一本书')
  assert.equal(r.text, '今天买了一本书')
  assert.deepEqual(r.tags, [])
})

test('encode: 单 inline tag → 完整占位符', () => {
  const r = encode('今天 <em>买了</em> 一本书')
  assert.equal(r.text, '今天 ⟦t1⟧买了⟦/t1⟧ 一本书')
  assert.equal(r.tags.length, 1)
  assert.equal(r.tags[0].id, 't1')
  assert.equal(r.tags[0].type, 'em')
  assert.deepEqual(r.tags[0].attrs, {})
})

test('encode: 带属性的 tag → attrs 进元信息，不进占位符文本', () => {
  const r = encode('看 <a href="/foo" class="x">这里</a> 详情')
  assert.equal(r.text, '看 ⟦t1⟧这里⟦/t1⟧ 详情')
  assert.deepEqual(r.tags[0].attrs, { href: '/foo', class: 'x' })
  // 属性不出现在 text 里，LLM 看不到就不会乱翻
  assert.ok(!r.text.includes('href'))
  assert.ok(!r.text.includes('/foo'))
})

test('encode: 多个 tag → id 递增', () => {
  const r = encode('<em>a</em> <strong>b</strong> <em>c</em>')
  assert.equal(r.text, '⟦t1⟧a⟦/t1⟧ ⟦t2⟧b⟦/t2⟧ ⟦t3⟧c⟦/t3⟧')
  assert.deepEqual(r.tags.map(t => t.type), ['em', 'strong', 'em'])
})

test('encode: 嵌套 tag → 多个独立 id，不嵌套', () => {
  const r = encode('<a href="/x"><em>链接</em></a>')
  assert.equal(r.text, '⟦t1⟧⟦t2⟧链接⟦/t2⟧⟦/t1⟧')
  assert.equal(r.tags.length, 2)
  // 外层先开
  assert.equal(r.tags[0].type, 'a')
  assert.equal(r.tags[1].type, 'em')
})

test('encode: 同类型不同实例 → 独立 id', () => {
  const r = encode('<em>甲</em> <em>乙</em>')
  assert.equal(r.text, '⟦t1⟧甲⟦/t1⟧ ⟦t2⟧乙⟦/t2⟧')
  assert.equal(r.tags[0].id, 't1')
  assert.equal(r.tags[1].id, 't2')
})

test('encode: 块级标签内联内容正确处理', () => {
  const r = encode('<p>hello <code>code</code> world</p>')
  // <code> 也算 inline 标签
  assert.equal(r.text, '⟦t1⟧hello ⟦t2⟧code⟦/t2⟧ world⟦/t1⟧')
})

// ─── decode ─────────────────────────────────────────────
test('decode: 占位符原样 → 还原 DOM 标签', () => {
  const html = decode('⟦t1⟧买了⟦/t1⟧', [
    { id: 't1', type: 'em', attrs: {} },
  ])
  assert.equal(html, '<em>买了</em>')
})

test('decode: 带属性', () => {
  const html = decode('⟦t1⟧这里⟦/t1⟧', [
    { id: 't1', type: 'a', attrs: { href: '/x', target: '_blank' } },
  ])
  assert.equal(html, '<a href="/x" target="_blank">这里</a>')
})

test('decode: LLM 移动了占位符位置（语序调整）', () => {
  const html = decode('⟦t2⟧book⟦/t2⟧ ⟦t1⟧bought⟦/t1⟧ a', [
    { id: 't1', type: 'a', attrs: { href: '/x' } },
    { id: 't2', type: 'em', attrs: {} },
  ])
  assert.equal(html, '<em>book</em> <a href="/x">bought</a> a')
})

test('decode: 嵌套 → 按开闭顺序还原', () => {
  const html = decode('⟦t1⟧⟦t2⟧link⟦/t2⟧⟦/t1⟧', [
    { id: 't1', type: 'a', attrs: {} },
    { id: 't2', type: 'em', attrs: {} },
  ])
  assert.equal(html, '<a><em>link</em></a>')
})

test('decode: 缺闭合占位符 → 保留开放', () => {
  const html = decode('⟦t1⟧orphan', [
    { id: 't1', type: 'em', attrs: {} },
  ])
  // 不抛错，保留开放状态（让上层决定怎么 fallback）
  assert.equal(html, '<em>orphan')
})

test('decode: 属性值需要 HTML 转义防注入', () => {
  const html = decode('⟦t1⟧x⟦/t1⟧', [
    { id: 't1', type: 'a', attrs: { href: '"><script>x</script>' } },
  ])
  assert.ok(!html.includes('<script>'), '属性被转义，无 XSS')
  assert.ok(html.includes('&quot;'))
})

// ─── extractPlaceholderIds ──────────────────────────────
test('extractPlaceholderIds: 提取所有占位符 id', () => {
  const ids = extractPlaceholderIds('⟦t1⟧foo⟦/t1⟧ ⟦t2⟧bar⟦/t2⟧')
  assert.deepEqual(ids.sort(), ['t1', 't2'])
})

test('extractPlaceholderIds: 文本中漏了占位符 → 报缺失', () => {
  // 占位符对不上时，让上层知道；不在 codec 里 fail
  const ids = extractPlaceholderIds('hello world no placeholder')
  assert.deepEqual(ids, [])
})