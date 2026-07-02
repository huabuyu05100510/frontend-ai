// ─────────────────────────────────────────────────────────────────────────────
// Document Model Types
// ─────────────────────────────────────────────────────────────────────────────

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'blockquote'
  | 'code_block'
  | 'bullet_list'
  | 'ordered_list'
  | 'list_item'
  | 'table'
  | 'table_row'
  | 'table_cell'
  | 'image'
  | 'divider'

export interface BlockMeta {
  createdBy: string
  createdAt: number
  updatedAt: number
  version: number
}

export interface Block {
  id: string
  type: BlockType
  content: string
  children: string[]
  props: Record<string, unknown>
  meta: BlockMeta
}

export interface DocumentJSON {
  id: string
  title: string
  rootId: string
  blocks: Record<string, Block>
  children: Record<string, string[]>
  meta: DocumentMeta
}

export interface DocumentMeta {
  createdBy: string
  createdAt: number
  updatedAt: number
  schemaVersion: '1.0'
}

export interface DocumentStats {
  wordCount: number
  charCount: number
  blockCount: number
}

export interface SearchResult {
  blockId: string
  matchStart: number
  matchEnd: number
  context: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Operation Types (for OT + version history)
// ─────────────────────────────────────────────────────────────────────────────

export type BlockOperationType = 'insert' | 'delete' | 'update' | 'move'

export interface BlockOperation {
  type: BlockOperationType
  blockId: string
  parentId?: string
  index?: number
  block?: Block
  patch?: Partial<Block>
  prevParentId?: string
  prevIndex?: number
  timestamp: number
  userId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Collaboration Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CursorPosition {
  blockId: string
  offset: number
}

export interface SelectionRange {
  anchor: CursorPosition
  head: CursorPosition
}

export interface CollabUser {
  id: string
  name: string
  color: string
  cursor: CursorPosition | null
  selection: SelectionRange | null
  isOnline: boolean
  lastSeen: number
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Types
// ─────────────────────────────────────────────────────────────────────────────

export type AICommand =
  | 'continue'
  | 'summarize'
  | 'translate'
  | 'fix_grammar'
  | 'expand'
  | 'shorten'

export interface AIRequest {
  command: AICommand
  selectedText: string
  context?: string
  targetLanguage?: string
  documentOutline?: string[]
}

export interface AIContext {
  selectedText: string
  surroundingText: string
  documentTitle: string
  outlineHeadings: string[]
  estimatedTokens: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Version History Types
// ─────────────────────────────────────────────────────────────────────────────

export interface VersionSnapshot {
  id: string
  label: string
  content: Record<string, unknown>
  timestamp: number
  isPinned: boolean
  author: string
  stats: { wordCount: number; charCount: number }
}

export interface DiffChunk {
  type: 'equal' | 'insert' | 'delete'
  text: string
}

export interface DiffSummary {
  added: number
  removed: number
  unchanged: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PerfSnapshot {
  fps: number
  operationTime: number
  renderTime: number
  aiLatency: number
  documentSize: number
  blockCount: number
  collaborators: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Bus Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EventMap {
  'doc:change': BlockOperation
  'collab:remote-op': { ops: string; userId: string }
  'collab:awareness': CollabUser[]
  'ai:start': AIRequest
  'ai:chunk': string
  'ai:done': string
  'ai:error': Error
  'version:snapshot': VersionSnapshot
  'perf:update': PerfSnapshot
}
