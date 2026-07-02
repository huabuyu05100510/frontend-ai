// 翻译标注 schema 层（移植自 ./网页翻译/lib/annotation.mjs）
// 模型：claude-sonnet-4-6
//
// 3 类标注：
//   - align_fix   修正词级对齐（用户认为某 src 词应对应到另一个 tgt 词）
//   - seg_rating  段落评分（1-5 星 + 文字反馈）
//   - alt_trans   备选翻译建议
//
// 简化点（相比原版）：
//   - url/domPath 可由 taskId+segmentId 自动派生，前端不强依赖
//   - 移除 appVersion/userAgent 强约束（可选）
//   - 保留 schemaVersion 校验、uuid 生成、langPair 白名单、validate/normalize/encode/decode 全套

/** 标注类型枚举（冻结防写） */
export const AnnotationKind = Object.freeze({
  ALIGN_FIX: 'align_fix',
  SEG_RATING: 'seg_rating',
  ALT_TRANS: 'alt_trans',
})

/** 当前 schema 版本号 */
export const SCHEMA_VERSION = 1

/** 支持的语言对白名单 */
const LANG_PAIR_WHITELIST = new Set([
  'zh-en', 'en-zh',
  'ja-zh', 'zh-ja',
  'ko-zh', 'zh-ko',
  'fr-en', 'en-fr',
  'de-en', 'en-de',
  'es-en', 'en-es',
  'ru-en', 'en-ru',
])

/** srcText 上限 */
const SRC_TEXT_MAX_LEN = 5000

export class ValidationError extends Error {
  constructor(message, field) {
    super(message)
    this.name = 'ValidationError'
    this.field = field
  }
}

export class SchemaError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SchemaError'
  }
}

/** uuid v4（Node 18+ 原生） */
export function generateUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function isValidLangPair(langPair) {
  if (!Array.isArray(langPair) || langPair.length !== 2) return false
  const key = `${String(langPair[0]).toLowerCase()}-${String(langPair[1]).toLowerCase()}`
  return LANG_PAIR_WHITELIST.has(key)
}

export function validate(anno) {
  if (anno == null || typeof anno !== 'object' || Array.isArray(anno)) {
    throw new ValidationError('annotation 必须是 object')
  }
  if (typeof anno.kind !== 'string' || !Object.values(AnnotationKind).includes(anno.kind)) {
    throw new ValidationError(`kind 非法: ${anno.kind}`, 'kind')
  }
  if (anno.schemaVersion !== SCHEMA_VERSION) {
    throw new ValidationError(`schemaVersion 必须是 ${SCHEMA_VERSION}`, 'schemaVersion')
  }
  if (typeof anno.id !== 'string' || anno.id.length < 16) {
    throw new ValidationError('id 必须是合法 uuid 字符串', 'id')
  }
  for (const f of ['url', 'domPath', 'srcSegmentId']) {
    if (typeof anno[f] !== 'string' || anno[f].length === 0) {
      throw new ValidationError(`${f} 必须是非空 string`, f)
    }
  }
  if (!isValidLangPair(anno.langPair)) {
    throw new ValidationError(`langPair 非法: ${JSON.stringify(anno.langPair)}`, 'langPair')
  }
  for (const f of ['srcText', 'tgtText']) {
    if (typeof anno[f] !== 'string') {
      throw new ValidationError(`${f} 必须是 string`, f)
    }
  }
  for (const f of ['srcTokens', 'tgtTokens']) {
    if (!Array.isArray(anno[f])) {
      throw new ValidationError(`${f} 必须是 string[]`, f)
    }
  }
  if (!Array.isArray(anno.predicted)) {
    throw new ValidationError('predicted 必须是 Array<[number,number]>', 'predicted')
  }
  if (typeof anno.modelVersion !== 'string' || anno.modelVersion.length === 0) {
    throw new ValidationError('modelVersion 必须是非空 string', 'modelVersion')
  }
  if (anno.payload == null || typeof anno.payload !== 'object' || Array.isArray(anno.payload)) {
    throw new ValidationError('payload 必须是 object', 'payload')
  }
  if (anno.context != null && (typeof anno.context !== 'object' || Array.isArray(anno.context))) {
    throw new ValidationError('context 必须是 object', 'context')
  }
  if (typeof anno.createdAt !== 'number' || !Number.isFinite(anno.createdAt)) {
    throw new ValidationError('createdAt 必须是 number', 'createdAt')
  }
}

export function normalize(anno) {
  const out = { ...anno }
  if (typeof out.url === 'string') out.url = out.url.trim()
  if (typeof out.domPath === 'string') out.domPath = out.domPath.trim()
  if (typeof out.srcSegmentId === 'string') out.srcSegmentId = out.srcSegmentId.trim()
  if (typeof out.srcText === 'string') {
    out.srcText = out.srcText.trim()
    if (out.srcText.length > SRC_TEXT_MAX_LEN) out.srcText = out.srcText.slice(0, SRC_TEXT_MAX_LEN)
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

export function encode(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('encode 入参必须是 object')
  }
  if (input.kind == null) throw new ValidationError('kind 必填', 'kind')
  if (input.langPair == null) throw new ValidationError('langPair 必填', 'langPair')
  if (input.payload == null) throw new ValidationError('payload 必填', 'payload')
  const merged = {
    id: input.id ?? generateUuid(),
    schemaVersion: SCHEMA_VERSION,
    createdAt: input.createdAt ?? Date.now(),
    appVersion: '',
    userAgent: '',
    context: {},
    ...input,
  }
  const normalized = normalize(merged)
  validate(normalized)
  return normalized
}

export function decode(raw) {
  if (typeof raw !== 'string') throw new SchemaError('decode 入参必须是 string')
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
    throw new SchemaError(`schemaVersion 不匹配: 当前=${SCHEMA_VERSION} 解析=${parsed.schemaVersion}`)
  }
  validate(parsed)
  return parsed
}
