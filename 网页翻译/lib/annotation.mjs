/**
 * annotation —— 标注功能 schema 层
 *
 * 纯函数模块：encode / decode / validate / normalize / generateUuid / isValidLangPair
 * 配套两类自定义错误：ValidationError（字段级）、SchemaError（版本/解析级）
 *
 * 设计依据：docs/annotation-feature-tech-plan-V1.md §3 数据结构 / §4 存储方案
 *
 * 模型：Claude (Sonnet 4.6) via MiniMax-M3 路由
 */

/** 标注类型枚举（冻结防写） */
export const AnnotationKind = Object.freeze({
  ALIGN_FIX: 'align_fix',
  SEG_RATING: 'seg_rating',
  ALT_TRANS: 'alt_trans',
})

/** 当前 schema 版本号；decode 校验此值 */
export const SCHEMA_VERSION = 1

/** 支持的语言对白名单（双向独立维护，避免对称假设） */
const LANG_PAIR_WHITELIST = new Set([
  'zh-en', 'en-zh',
  'ja-zh', 'zh-ja',
])

/** srcText 上限字符数（防恶意长文刷库，docs §3.2） */
const SRC_TEXT_MAX_LEN = 5000

/**
 * 自定义错误：字段级校验失败
 * @property {string} field 触发错误的字段名（可选）
 */
export class ValidationError extends Error {
  constructor(message, field) {
    super(message)
    this.name = 'ValidationError'
    this.field = field
  }
}

/**
 * 自定义错误：schema 版本不匹配 / JSON 解析失败
 */
export class SchemaError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SchemaError'
  }
}

/**
 * 生成 uuid v4。
 * 优先使用 Node 18+ 原生 crypto.randomUUID()；运行时检测不可用时降级到手动拼装。
 * @returns {string} uuid v4 字符串
 */
export function generateUuid() {
  // Node 18+ / 现代浏览器自带
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  // 兜底：手工拼装 v4（rfc4122 compliant）
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * 判断语言对是否在白名单内。
 * @param {unknown} langPair
 * @returns {boolean}
 */
export function isValidLangPair(langPair) {
  if (!Array.isArray(langPair) || langPair.length !== 2) return false
  const key = `${langPair[0]}-${langPair[1]}`
  return LANG_PAIR_WHITELIST.has(key)
}

/**
 * 校验单条 Annotation 的字段类型与取值。
 * 缺字段 / 类型错 / 取值非法 → 抛 ValidationError（带 field 路径）。
 * @param {object} anno
 */
export function validate(anno) {
  if (anno == null || typeof anno !== 'object' || Array.isArray(anno)) {
    throw new ValidationError('annotation 必须是 object')
  }
  // kind
  if (typeof anno.kind !== 'string') {
    throw new ValidationError('kind 必须是 string', 'kind')
  }
  if (!Object.values(AnnotationKind).includes(anno.kind)) {
    throw new ValidationError(`kind 非法: ${anno.kind}，允许值 ${Object.values(AnnotationKind).join('|')}`, 'kind')
  }
  // schemaVersion
  if (anno.schemaVersion !== SCHEMA_VERSION) {
    throw new ValidationError(`schemaVersion 必须是 ${SCHEMA_VERSION}`, 'schemaVersion')
  }
  // id
  if (typeof anno.id !== 'string' || anno.id.length < 16) {
    throw new ValidationError('id 必须是合法 uuid 字符串', 'id')
  }
  // url / domPath / srcSegmentId
  for (const f of ['url', 'domPath', 'srcSegmentId']) {
    if (typeof anno[f] !== 'string' || anno[f].length === 0) {
      throw new ValidationError(`${f} 必须是非空 string`, f)
    }
  }
  // langPair
  if (!isValidLangPair(anno.langPair)) {
    throw new ValidationError(`langPair 非法: ${JSON.stringify(anno.langPair)}`, 'langPair')
  }
  // srcText / tgtText
  for (const f of ['srcText', 'tgtText']) {
    if (typeof anno[f] !== 'string') {
      throw new ValidationError(`${f} 必须是 string`, f)
    }
  }
  // srcTokens / tgtTokens
  for (const f of ['srcTokens', 'tgtTokens']) {
    if (!Array.isArray(anno[f])) {
      throw new ValidationError(`${f} 必须是 string[]`, f)
    }
    for (let i = 0; i < anno[f].length; i++) {
      if (typeof anno[f][i] !== 'string') {
        throw new ValidationError(`${f}[${i}] 必须是 string`, f)
      }
    }
  }
  // predicted
  if (!Array.isArray(anno.predicted)) {
    throw new ValidationError('predicted 必须是 Array<[number,number]>', 'predicted')
  }
  for (let i = 0; i < anno.predicted.length; i++) {
    const pair = anno.predicted[i]
    if (!Array.isArray(pair) || pair.length !== 2
        || !Number.isInteger(pair[0]) || !Number.isInteger(pair[1])) {
      throw new ValidationError(`predicted[${i}] 必须是 [int, int]`, 'predicted')
    }
  }
  // modelVersion
  if (typeof anno.modelVersion !== 'string' || anno.modelVersion.length === 0) {
    throw new ValidationError('modelVersion 必须是非空 string', 'modelVersion')
  }
  // payload
  if (anno.payload == null || typeof anno.payload !== 'object' || Array.isArray(anno.payload)) {
    throw new ValidationError('payload 必须是 object', 'payload')
  }
  // context
  if (anno.context != null) {
    if (typeof anno.context !== 'object' || Array.isArray(anno.context)) {
      throw new ValidationError('context 必须是 object', 'context')
    }
    for (const f of ['prevSrc', 'nextSrc']) {
      if (anno.context[f] != null && typeof anno.context[f] !== 'string') {
        throw new ValidationError(`context.${f} 必须是 string|null`, `context.${f}`)
      }
    }
  }
  // createdAt
  if (typeof anno.createdAt !== 'number' || !Number.isFinite(anno.createdAt)) {
    throw new ValidationError('createdAt 必须是 number', 'createdAt')
  }
  // appVersion / userAgent
  for (const f of ['appVersion', 'userAgent']) {
    if (anno[f] != null && typeof anno[f] !== 'string') {
      throw new ValidationError(`${f} 必须是 string`, f)
    }
  }
}

/**
 * 兜底：把 annotation 规整为可持久化形态。
 *   - 字符串 trim 首尾空白
 *   - srcText 超长截断到 SRC_TEXT_MAX_LEN
 *   - langPair 标准化为 lowercase
 *   - payload 字符串/null 强转空 object
 *   - context 缺失补空 object
 * @param {object} anno
 * @returns {object} 规整后的 annotation（不修改入参）
 */
export function normalize(anno) {
  const out = { ...anno }
  if (typeof out.url === 'string') out.url = out.url.trim()
  if (typeof out.domPath === 'string') out.domPath = out.domPath.trim()
  if (typeof out.srcSegmentId === 'string') out.srcSegmentId = out.srcSegmentId.trim()
  if (typeof out.srcText === 'string') {
    out.srcText = out.srcText.trim()
    if (out.srcText.length > SRC_TEXT_MAX_LEN) {
      out.srcText = out.srcText.slice(0, SRC_TEXT_MAX_LEN)
    }
  }
  if (typeof out.tgtText === 'string') out.tgtText = out.tgtText.trim()
  if (Array.isArray(out.langPair)) {
    out.langPair = out.langPair.map(s => String(s).toLowerCase())
  }
  if (out.payload == null || typeof out.payload !== 'object' || Array.isArray(out.payload)) {
    out.payload = {}
  }
  if (out.context == null || typeof out.context !== 'object' || Array.isArray(out.context)) {
    out.context = {}
  }
  return out
}

/**
 * 从原始输入生成一条规范化、可持久化的 Annotation 对象。
 * 流程：normalize → 补默认字段（id/createdAt/schemaVersion）→ validate
 * @param {object} input 部分字段的原始输入
 * @returns {object} 完整 Annotation
 */
export function encode(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('encode 入参必须是 object')
  }
  // 必填字段先做最小检查，避免 normalize 阶段空指针
  if (input.kind == null) {
    throw new ValidationError('kind 必填', 'kind')
  }
  if (input.langPair == null) {
    throw new ValidationError('langPair 必填', 'langPair')
  }
  if (input.payload == null) {
    throw new ValidationError('payload 必填', 'payload')
  }
  const now = Date.now()
  const merged = {
    id: input.id ?? generateUuid(),
    schemaVersion: SCHEMA_VERSION,
    createdAt: input.createdAt ?? now,
    appVersion: '',
    userAgent: '',
    context: {},
    ...input,
  }
  const normalized = normalize(merged)
  validate(normalized)
  return normalized
}

/**
 * 从持久化原始数据还原 Annotation 对象。
 * 校验 schemaVersion 与字段类型，超出版本抛 SchemaError，字段错抛 ValidationError。
 * @param {string} raw JSON 字符串
 * @returns {object} Annotation
 */
export function decode(raw) {
  if (typeof raw !== 'string') {
    throw new SchemaError('decode 入参必须是 string')
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new SchemaError(`JSON 解析失败: ${e.message}`)
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SchemaError('annotation 必须是 object')
  }
  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new SchemaError(
      `schemaVersion 不匹配: 当前=${SCHEMA_VERSION} 解析=${parsed.schemaVersion}`,
    )
  }
  validate(parsed)
  return parsed
}
