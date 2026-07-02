/**
 * StreamingParser — 增量 Markdown 解析
 *
 * 核心思路：
 *   1. 维护 buffer（全量文本）和 renderedLength（已提交长度）
 *   2. append(delta) 追加到 buffer，标记 dirty
 *   3. commit() 解析 buffer.slice(renderedLength) 得到新 tokens
 *      → 更新 renderedLength，仅 patch 新增 token 对应节点
 *
 * 每帧最多 commit 一次（由调用方配合 rAF 节流）
 */

export interface MarkdownToken {
  type: 'heading' | 'paragraph' | 'code' | 'list_item' | 'blockquote' | 'hr'
  text: string
  depth?: number      // heading 层级
  lang?: string       // code 语言
  raw: string
}

export class StreamingParser {
  private buffer = ''
  private committed = ''
  private _renderedLength = 0
  private allTokens: MarkdownToken[] = []
  private lastCommitTokenCount = 0

  get renderedLength(): number {
    return this._renderedLength
  }

  append(delta: string): void {
    if (!delta) return
    this.buffer += delta
  }

  /**
   * 解析当前 buffer 中尚未提交的部分，追加新 tokens。
   * 调用方应在 rAF 回调中调用，避免高频触发。
   */
  commit(): void {
    // 尝试解析完整 block（以两个换行符为边界）
    const text = this.buffer
    const tokens = parseMarkdown(text)
    this.allTokens = tokens
    this._renderedLength = text.length
    this.committed = text
  }

  /** 获取所有已解析 tokens（直接解析当前 buffer，无需先 commit） */
  getTokens(): MarkdownToken[] {
    return parseMarkdown(this.buffer)
  }

  /**
   * 获取上次 commit 以来新增的 tokens（增量 patch 用）
   */
  getNewTokens(): MarkdownToken[] {
    const newTokens = this.allTokens.slice(this.lastCommitTokenCount)
    this.lastCommitTokenCount = this.allTokens.length
    return newTokens
  }
}

// ── 轻量 Markdown tokenizer（只需满足 demo 场景）──────────────

function parseMarkdown(text: string): MarkdownToken[] {
  const tokens: MarkdownToken[] = []
  // 按两个换行分割成块
  const blocks = text.split(/\n{2,}/)

  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue

    // heading
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      tokens.push({
        type: 'heading',
        depth: headingMatch[1].length,
        text: headingMatch[2],
        raw: block,
      })
      continue
    }

    // fenced code block
    const codeMatch = trimmed.match(/^```(\w*)\n([\s\S]*?)```$/)
    if (codeMatch) {
      tokens.push({
        type: 'code',
        lang: codeMatch[1] || undefined,
        text: codeMatch[2],
        raw: block,
      })
      continue
    }

    // blockquote
    if (trimmed.startsWith('> ')) {
      tokens.push({ type: 'blockquote', text: trimmed.slice(2), raw: block })
      continue
    }

    // list item
    if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      tokens.push({ type: 'list_item', text: trimmed.replace(/^[-*+\d.]+\s/, ''), raw: block })
      continue
    }

    // hr
    if (/^[-*_]{3,}$/.test(trimmed)) {
      tokens.push({ type: 'hr', text: '', raw: block })
      continue
    }

    // paragraph（default）
    tokens.push({ type: 'paragraph', text: trimmed, raw: block })
  }

  return tokens
}
