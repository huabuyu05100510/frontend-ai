/**
 * annotation —— 标注 schema 单测
 *
 * 覆盖：
 *   - encode 正常路径（3 种 kind 各 1 case）
 *   - encode 缺字段抛错
 *   - decode 校验 schemaVersion（旧版本抛错）
 *   - validate 各类字段错误
 *   - normalize 边界
 *   - generateUuid 唯一性
 *   - isValidLangPair
 *
 * 模型：Claude (Sonnet 4.6) via MiniMax-M3 路由
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AnnotationKind,
  SCHEMA_VERSION,
  encode,
  decode,
  validate,
  normalize,
  generateUuid,
  isValidLangPair,
  ValidationError,
  SchemaError,
} from '../lib/annotation.mjs'

// ─── 测试夹具 ──────────────────────────────────────────
function baseInput(overrides = {}) {
  return {
    kind: AnnotationKind.ALIGN_FIX,
    url: 'https://example.com/page',
    domPath: '/html/body/div[2]/p[1]',
    srcSegmentId: 'seg-abc-123',
    langPair: ['zh', 'en'],
    srcText: '我 爱 这 只 懒 懒 狗',
    tgtText: 'I love this lazy dog',
    srcTokens: ['我', '爱', '这', '只', '懒', '懒', '狗'],
    tgtTokens: ['I', 'love', 'this', 'lazy', 'dog'],
    predicted: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 4], [6, 5]],
    modelVersion: 'nllb-600m-l0h15-v1',
    payload: {
      srcTokenIdx: 3,
      predictedTgtTokenIdx: 3,
      correctedTgtTokenIdx: 4,
      correctionKind: 'change',
    },
    context: { prevSrc: '上一段原文', nextSrc: '下一段原文' },
    appVersion: '1.0.0',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    ...overrides,
  }
}

// ─── AnnotationKind ──────────────────────────────────
test('AnnotationKind: 暴露 3 种 kind 常量', () => {
  assert.equal(AnnotationKind.ALIGN_FIX, 'align_fix')
  assert.equal(AnnotationKind.SEG_RATING, 'seg_rating')
  assert.equal(AnnotationKind.ALT_TRANS, 'alt_trans')
})

test('AnnotationKind: 不可写', () => {
  assert.equal(Object.isFrozen(AnnotationKind), true)
})

test('SCHEMA_VERSION: 等于 1', () => {
  assert.equal(SCHEMA_VERSION, 1)
})

// ─── isValidLangPair ──────────────────────────────────
test('isValidLangPair: 接受白名单内 4 种方向', () => {
  for (const lp of [['zh', 'en'], ['en', 'zh'], ['ja', 'zh'], ['zh', 'ja']]) {
    assert.equal(isValidLangPair(lp), true, `应接受 ${lp.join('-')}`)
  }
})

test('isValidLangPair: 拒绝不在白名单内的方向', () => {
  for (const lp of [['fr', 'en'], ['zh', 'ko'], ['xx', 'yy'], [], ['zh']]) {
    assert.equal(isValidLangPair(lp), false, `应拒绝 ${JSON.stringify(lp)}`)
  }
})

// ─── encode 正常路径 ──────────────────────────────────
test('encode: ALIGN_FIX 返回完整 Annotation 对象', () => {
  const anno = encode(baseInput())
  assert.equal(anno.kind, 'align_fix')
  assert.equal(anno.schemaVersion, 1)
  assert.ok(typeof anno.id === 'string' && anno.id.length >= 32, 'id 须是 uuid 字符串')
  assert.equal(anno.url, 'https://example.com/page')
  assert.equal(anno.langPair.length, 2)
  assert.equal(anno.langPair[0], 'zh')
  assert.deepEqual(anno.payload.srcTokenIdx, 3)
  assert.equal(typeof anno.createdAt, 'number')
  assert.ok(anno.createdAt > 0)
})

test('encode: SEG_RATING 正常路径', () => {
  const anno = encode(baseInput({
    kind: AnnotationKind.SEG_RATING,
    payload: { rating: 5 },
  }))
  assert.equal(anno.kind, 'seg_rating')
  assert.equal(anno.payload.rating, 5)
})

test('encode: ALT_TRANS 正常路径（schema 允许）', () => {
  const anno = encode(baseInput({
    kind: AnnotationKind.ALT_TRANS,
    payload: { altTgtText: 'alternative translation' },
  }))
  assert.equal(anno.kind, 'alt_trans')
  assert.equal(anno.payload.altTgtText, 'alternative translation')
})

// ─── encode 缺字段抛错 ────────────────────────────────
test('encode: 缺 kind 抛 ValidationError', () => {
  const input = baseInput()
  delete input.kind
  assert.throws(() => encode(input), ValidationError)
})

test('encode: 缺 langPair 抛 ValidationError', () => {
  const input = baseInput()
  delete input.langPair
  assert.throws(() => encode(input), ValidationError)
})

test('encode: 缺 payload 抛 ValidationError', () => {
  const input = baseInput()
  delete input.payload
  assert.throws(() => encode(input), ValidationError)
})

// ─── decode 校验 schemaVersion ────────────────────────
test('decode: 合法 JSON → 完整 Annotation', () => {
  const raw = JSON.stringify(encode(baseInput()))
  const anno = decode(raw)
  assert.equal(anno.kind, 'align_fix')
  assert.equal(anno.schemaVersion, 1)
})

test('decode: 旧 schemaVersion 抛 SchemaError', () => {
  const old = encode(baseInput())
  old.schemaVersion = 0
  assert.throws(() => decode(JSON.stringify(old)), SchemaError)
})

test('decode: 未来 schemaVersion 抛 SchemaError', () => {
  const future = encode(baseInput())
  future.schemaVersion = 999
  assert.throws(() => decode(JSON.stringify(future)), SchemaError)
})

test('decode: 非 JSON 字符串抛 SchemaError', () => {
  assert.throws(() => decode('not json{'), SchemaError)
})

// ─── validate 各类字段错误 ────────────────────────────
test('validate: kind 非法字符串', () => {
  const anno = encode(baseInput())
  anno.kind = 'invalid_kind'
  assert.throws(() => validate(anno), ValidationError)
})

test('validate: langPair 不在白名单', () => {
  const anno = encode(baseInput())
  anno.langPair = ['fr', 'en']
  assert.throws(() => validate(anno), ValidationError)
})

test('validate: srcTokens 非数组', () => {
  const anno = encode(baseInput())
  anno.srcTokens = '我 爱 这 只 懒 懒 狗'
  assert.throws(() => validate(anno), ValidationError)
})

test('validate: payload 不是 object', () => {
  const anno = encode(baseInput())
  anno.payload = 'not an object'
  assert.throws(() => validate(anno), ValidationError)
})

// ─── normalize 边界 ──────────────────────────────────
test('normalize: 字符串 trim 首尾空白', () => {
  const anno = encode(baseInput())
  anno.url = '  https://example.com/  '
  anno.srcText = '  hello world  '
  const out = normalize(anno)
  assert.equal(out.url, 'https://example.com/')
  assert.equal(out.srcText, 'hello world')
})

test('normalize: srcText 超 5000 截断', () => {
  const anno = encode(baseInput())
  anno.srcText = 'a'.repeat(6000)
  const out = normalize(anno)
  assert.equal(out.srcText.length, 5000)
})

test('normalize: payload 字符串强转 object', () => {
  const anno = encode(baseInput())
  anno.payload = 'malicious string'
  const out = normalize(anno)
  assert.equal(typeof out.payload, 'object')
  assert.notEqual(out.payload, null)
})

test('normalize: langPair 标准化为 lowercase', () => {
  const anno = encode(baseInput())
  anno.langPair = ['ZH', 'EN']
  const out = normalize(anno)
  assert.deepEqual(out.langPair, ['zh', 'en'])
})

// ─── generateUuid 唯一性 ─────────────────────────────
test('generateUuid: 1000 个无重复', () => {
  const seen = new Set()
  for (let i = 0; i < 1000; i++) {
    const u = generateUuid()
    assert.ok(typeof u === 'string' && u.length > 0)
    assert.ok(!seen.has(u), `重复 uuid: ${u}`)
    seen.add(u)
  }
  assert.equal(seen.size, 1000)
})

// ─── error class 继承关系 ────────────────────────────
test('ValidationError: 是 Error 子类且带字段路径', () => {
  const e = new ValidationError('kind 非法', 'kind')
  assert.ok(e instanceof Error)
  assert.equal(e.name, 'ValidationError')
  assert.equal(e.field, 'kind')
  assert.equal(e.message, 'kind 非法')
})

test('SchemaError: 是 Error 子类', () => {
  const e = new SchemaError('版本不匹配')
  assert.ok(e instanceof Error)
  assert.equal(e.name, 'SchemaError')
})
