// ─── 翻译段落 ──────────────────────────────────────────────
export interface Segment {
  id: string
  text: string
  /** 保留 inline 标签的 HTML（有 a/em/strong 等标签时非空），用于保结构翻译 */
  html?: string
  element: Element
  role: SegmentRole
  /** W2-3: 段来源（top frame / iframe / shadow root），调试用 */
  sourceFrame?: 'top' | 'iframe' | 'shadow'
}

export type SegmentRole =
  | 'heading'
  | 'body'
  | 'caption'
  | 'list-item'
  | 'table-cell'
  | 'blockquote'

// ─── 翻译结果 ──────────────────────────────────────────────
export interface TranslationChunk {
  segmentId: string
  delta: string      // 流式增量
  done: boolean
  full?: string      // done=true 时的完整译文
}

export type TranslationMode = 'bilingual' | 'translation-only' | 'sidebar'

export type LangCode = string  // 'zh' | 'en' | 'ja' | 'ko' | ...

// ─── 翻译后端 ──────────────────────────────────────────────
export type TranslationBackend = 'deepl' | 'minimax'

// ─── 消息协议 ──────────────────────────────────────────────
// ─── 词级对齐（W1-5）─────────────────────────────────────────
export interface AlignmentResult {
  segmentId: string
  srcTokens: string[]
  tgtTokens: string[]
  alignments: { srcIdx: number; tgtIdx: number; score: number }[]
  took?: number
}

export type ExtensionMessage =
  | { type: 'TRANSLATE';   srcLang: LangCode; tgtLang: LangCode; mode: TranslationMode }
  | { type: 'RESTORE' }
  | { type: 'SET_MODE';    mode: TranslationMode }
  | { type: 'GET_STATE' }
  | { type: 'TRANSLATE_BATCH'; segments: Pick<Segment, 'id' | 'text' | 'html'>[]; srcLang: LangCode; tgtLang: LangCode }
  | { type: 'TRANSLATION_CHUNK'; chunk: TranslationChunk }
  | { type: 'TRANSLATION_ERROR'; message: string }
  | { type: 'STATE_UPDATE'; state: PageTranslationState }
  | { type: 'COMMAND'; command: string }
  | { type: 'PING' }
  | { type: 'ALIGN_QUERY'; segmentId: string; src: string; tgt: string }
  | { type: 'ALIGN_RESPONSE'; result: AlignmentResult }
  | { type: 'ALIGN_ERROR'; segmentId: string; message: string }
  | { type: 'XT_FORCE_SYNC' }   // 主动触发标注同步（content FAB 📊 或 popup）
  | { type: 'XT_TEST_SEED'; items: unknown[] }   // e2e/test 专用：批量预填标注到 IDB
  | { type: 'XT_ANNOTATION_TOGGLE'; enabled: boolean }   // Agent 8: popup 标注开关切换广播

export interface PageTranslationState {
  active: boolean
  mode: TranslationMode
  srcLang: LangCode
  tgtLang: LangCode
  progress: number   // 0-100
  total: number
  translated: number
}

// ─── 缓存 key ─────────────────────────────────────────────
export function cacheKey(text: string, src: LangCode, tgt: LangCode): string {
  return `${src}:${tgt}:${hashText(text)}`
}

function hashText(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0
  }
  return (h >>> 0).toString(36)
}
