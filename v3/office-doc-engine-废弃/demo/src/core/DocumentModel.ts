import { nanoid } from '../utils/nanoid'
import type { Block, BlockOperation, BlockType, DocumentJSON, DocumentMeta, DocumentStats, SearchResult } from './types'

export class DocumentModel {
  readonly id: string
  title: string
  readonly rootId: string
  private blocks: Map<string, Block>
  private childrenMap: Map<string, string[]>
  private meta: DocumentMeta

  private constructor(
    id: string,
    title: string,
    rootId: string,
    blocks: Map<string, Block>,
    children: Map<string, string[]>,
    meta: DocumentMeta
  ) {
    this.id = id
    this.title = title
    this.rootId = rootId
    this.blocks = blocks
    this.childrenMap = children
    this.meta = meta
  }

  // ── Factory ──────────────────────────────────────────────────────────────
  static empty(id: string, title: string, userId = 'system'): DocumentModel {
    const rootId = nanoid()
    const now = Date.now()
    const root: Block = {
      id: rootId,
      type: 'paragraph',
      content: '',
      children: [],
      props: {},
      meta: { createdBy: userId, createdAt: now, updatedAt: now, version: 1 },
    }
    const blocks = new Map([[rootId, root]])
    const children = new Map([[rootId, []]])
    const meta: DocumentMeta = {
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
      schemaVersion: '1.0',
    }
    return new DocumentModel(id, title, rootId, blocks, children, meta)
  }

  static fromJSON(json: DocumentJSON): DocumentModel {
    const blocks = new Map(Object.entries(json.blocks))
    const children = new Map(Object.entries(json.children))
    return new DocumentModel(json.id, json.title, json.rootId, blocks, children, json.meta)
  }

  // ── Read ─────────────────────────────────────────────────────────────────
  getBlock(id: string): Block {
    const block = this.blocks.get(id)
    if (!block) throw new Error(`Block not found: ${id}`)
    return block
  }

  getChildren(parentId: string): Block[] {
    const ids = this.childrenMap.get(parentId) ?? []
    return ids.map(id => this.getBlock(id))
  }

  getPath(blockId: string): string[] {
    const path: string[] = []
    let current: string | undefined = blockId
    // Build reverse path
    const parentOf = new Map<string, string>()
    for (const [pid, cids] of this.childrenMap) {
      for (const cid of cids) parentOf.set(cid, pid)
    }
    while (current !== undefined) {
      path.unshift(current)
      if (current === this.rootId) break
      current = parentOf.get(current)
    }
    return path
  }

  findBlocks(predicate: (b: Block) => boolean): Block[] {
    return [...this.blocks.values()].filter(predicate)
  }

  search(query: string): SearchResult[] {
    const lower = query.toLowerCase()
    const results: SearchResult[] = []
    for (const block of this.blocks.values()) {
      const text = block.content.toLowerCase()
      let idx = text.indexOf(lower)
      while (idx !== -1) {
        results.push({
          blockId: block.id,
          matchStart: idx,
          matchEnd: idx + query.length,
          context: block.content.slice(Math.max(0, idx - 20), idx + query.length + 20),
        })
        idx = text.indexOf(lower, idx + 1)
      }
    }
    return results
  }

  stats(): DocumentStats {
    let wordCount = 0
    let charCount = 0
    for (const block of this.blocks.values()) {
      if (block.id === this.rootId) continue
      const words = block.content.trim().split(/\s+/).filter(Boolean)
      wordCount += words.length
      charCount += block.content.replace(/\s/g, '').length
    }
    return { wordCount, charCount, blockCount: this.blocks.size }
  }

  // ── Write (returns Operation for OT) ────────────────────────────────────
  insertBlock(
    parentId: string,
    index: number,
    blockData: Omit<Block, 'id'> & { id?: string }
  ): BlockOperation {
    const id = blockData.id ?? nanoid()
    const block: Block = { ...blockData, id } as Block
    this.blocks.set(id, block)
    const siblings = this.childrenMap.get(parentId) ?? []
    siblings.splice(index, 0, id)
    this.childrenMap.set(parentId, siblings)
    this.childrenMap.set(id, block.children ?? [])
    this._touchMeta()
    return { type: 'insert', blockId: id, parentId, index, block, timestamp: Date.now(), userId: block.meta.createdBy }
  }

  deleteBlock(blockId: string): BlockOperation {
    const block = this.getBlock(blockId)
    // Cascade delete children
    const toDelete = this._subtree(blockId)
    for (const id of toDelete) {
      this.blocks.delete(id)
      this.childrenMap.delete(id)
    }
    // Remove from parent
    for (const [pid, cids] of this.childrenMap) {
      const i = cids.indexOf(blockId)
      if (i !== -1) {
        cids.splice(i, 1)
        this.childrenMap.set(pid, cids)
        break
      }
    }
    this._touchMeta()
    return { type: 'delete', blockId, timestamp: Date.now(), userId: 'system' }
  }

  updateBlock(blockId: string, patch: Partial<Block>): BlockOperation {
    const block = this.getBlock(blockId)
    const updated: Block = {
      ...block,
      ...patch,
      meta: { ...block.meta, updatedAt: Date.now(), version: block.meta.version + 1 },
    }
    this.blocks.set(blockId, updated)
    this._touchMeta()
    return { type: 'update', blockId, patch, timestamp: Date.now(), userId: 'system' }
  }

  moveBlock(blockId: string, newParentId: string, newIndex: number): BlockOperation {
    // Remove from current parent
    let prevParentId = ''
    let prevIndex = 0
    for (const [pid, cids] of this.childrenMap) {
      const i = cids.indexOf(blockId)
      if (i !== -1) {
        prevParentId = pid
        prevIndex = i
        cids.splice(i, 1)
        break
      }
    }
    // Insert into new parent
    const siblings = this.childrenMap.get(newParentId) ?? []
    siblings.splice(newIndex, 0, blockId)
    this.childrenMap.set(newParentId, siblings)
    this._touchMeta()
    return { type: 'move', blockId, parentId: newParentId, index: newIndex, prevParentId, prevIndex, timestamp: Date.now(), userId: 'system' }
  }

  // ── Serialization ────────────────────────────────────────────────────────
  toJSON(): DocumentJSON {
    const blocksObj: Record<string, Block> = {}
    const childrenObj: Record<string, string[]> = {}
    for (const [id, block] of this.blocks) blocksObj[id] = block
    for (const [id, kids] of this.childrenMap) childrenObj[id] = kids
    return { id: this.id, title: this.title, rootId: this.rootId, blocks: blocksObj, children: childrenObj, meta: this.meta }
  }

  snapshot(): DocumentJSON {
    return this.toJSON()
  }

  // ── Private ──────────────────────────────────────────────────────────────
  private _subtree(blockId: string): string[] {
    const result: string[] = [blockId]
    const children = this.childrenMap.get(blockId) ?? []
    for (const child of children) result.push(...this._subtree(child))
    return result
  }

  private _touchMeta(): void {
    this.meta = { ...this.meta, updatedAt: Date.now() }
  }
}
