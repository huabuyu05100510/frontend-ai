import type { DocumentModel } from '../core/DocumentModel'
import type { Block } from '../core/types'

export class ExportEngine {
  // ── Markdown ───────────────────────────────────────────────────────────
  toMarkdown(doc: DocumentModel): string {
    const lines: string[] = []
    this._renderBlockMd(doc, doc.rootId, lines, 0, { orderedCounters: new Map() })
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
  }

  private _renderBlockMd(
    doc: DocumentModel,
    blockId: string,
    lines: string[],
    depth: number,
    ctx: { orderedCounters: Map<string, number> }
  ): void {
    const block = doc.getBlock(blockId)
    const children = doc.getChildren(blockId)

    if (blockId === doc.rootId) {
      for (const child of children) this._renderBlockMd(doc, child.id, lines, depth, ctx)
      return
    }

    switch (block.type) {
      case 'heading': {
        const level = (block.props.level as number) ?? 1
        lines.push('#'.repeat(level) + ' ' + block.content)
        lines.push('')
        break
      }
      case 'paragraph':
        if (block.content.trim()) {
          lines.push(block.content)
          lines.push('')
        }
        break
      case 'blockquote':
        lines.push('> ' + block.content)
        lines.push('')
        break
      case 'code_block': {
        const lang = (block.props.language as string) ?? ''
        lines.push('```' + lang)
        lines.push(block.content)
        lines.push('```')
        lines.push('')
        break
      }
      case 'divider':
        lines.push('---')
        lines.push('')
        break
      case 'bullet_list':
        for (const child of children) {
          this._renderBlockMd(doc, child.id, lines, depth + 1, ctx)
        }
        lines.push('')
        return
      case 'ordered_list': {
        ctx.orderedCounters.set(blockId, 0)
        for (const child of children) {
          const count = (ctx.orderedCounters.get(blockId) ?? 0) + 1
          ctx.orderedCounters.set(blockId, count)
          this._renderListItemMd(doc, child, lines, depth, 'ordered', count)
        }
        lines.push('')
        return
      }
      case 'list_item': {
        // Standalone list_item (inside bullet_list parent)
        const indent = '  '.repeat(Math.max(0, depth - 1))
        lines.push(`${indent}- ${block.content}`)
        for (const child of children) this._renderBlockMd(doc, child.id, lines, depth + 1, ctx)
        return
      }
      case 'image': {
        const src = (block.props.src as string) ?? ''
        const alt = (block.props.alt as string) ?? ''
        lines.push(`![${alt}](${src})`)
        lines.push('')
        break
      }
      default:
        if (block.content) lines.push(block.content)
    }

    for (const child of children) this._renderBlockMd(doc, child.id, lines, depth + 1, ctx)
  }

  private _renderListItemMd(
    doc: DocumentModel,
    block: Block,
    lines: string[],
    depth: number,
    listType: 'ordered' | 'bullet',
    index: number
  ): void {
    const indent = '  '.repeat(depth)
    const prefix = listType === 'ordered' ? `${index}. ` : '- '
    lines.push(`${indent}${prefix}${block.content}`)
    for (const child of doc.getChildren(block.id)) {
      this._renderBlockMd(doc, child.id, lines, depth + 1, { orderedCounters: new Map() })
    }
  }

  // ── HTML ───────────────────────────────────────────────────────────────
  toHTML(doc: DocumentModel): string {
    const body = this._renderBlockHTML(doc, doc.rootId)
    return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>${this._escape(doc.title)}</title>
<style>
  body { font-family: sans-serif; max-width: 800px; margin: 2rem auto; line-height: 1.6; }
  code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; }
  pre { background: #f4f4f4; padding: 1rem; border-radius: 6px; overflow: auto; }
  blockquote { border-left: 4px solid #ddd; margin: 0; padding-left: 1rem; color: #666; }
  hr { border: none; border-top: 1px solid #eee; }
</style>
</head>
<body>
${body}
</body>
</html>`
  }

  private _renderBlockHTML(doc: DocumentModel, blockId: string): string {
    const block = doc.getBlock(blockId)
    const children = doc.getChildren(blockId)
    const childrenHTML = children.map(c => this._renderBlockHTML(doc, c.id)).join('\n')

    if (blockId === doc.rootId) return childrenHTML

    const escaped = this._escape(block.content)

    switch (block.type) {
      case 'heading': {
        const level = (block.props.level as number) ?? 1
        return `<h${level}>${escaped}</h${level}>`
      }
      case 'paragraph': return `<p>${escaped}</p>`
      case 'blockquote': return `<blockquote><p>${escaped}</p></blockquote>`
      case 'code_block': return `<pre><code>${escaped}</code></pre>`
      case 'bullet_list': return `<ul>\n${childrenHTML}\n</ul>`
      case 'ordered_list': return `<ol>\n${childrenHTML}\n</ol>`
      case 'list_item': return `<li>${escaped}${childrenHTML ? '\n' + childrenHTML : ''}</li>`
      case 'divider': return '<hr>'
      case 'image': {
        const src = this._escape((block.props.src as string) ?? '')
        const alt = this._escape((block.props.alt as string) ?? '')
        return `<img src="${src}" alt="${alt}">`
      }
      default: return `<p>${escaped}</p>`
    }
  }

  // ── Plain text ─────────────────────────────────────────────────────────
  toPlainText(doc: DocumentModel): string {
    const lines: string[] = []
    this._collectText(doc, doc.rootId, lines)
    return lines.filter(Boolean).join('\n')
  }

  private _collectText(doc: DocumentModel, blockId: string, lines: string[]): void {
    const block = doc.getBlock(blockId)
    if (blockId !== doc.rootId && block.content) lines.push(block.content)
    for (const child of doc.getChildren(blockId)) this._collectText(doc, child.id, lines)
  }

  // ── JSON ───────────────────────────────────────────────────────────────
  toJSON(doc: DocumentModel): string {
    return JSON.stringify(doc.toJSON(), null, 2)
  }

  private _escape(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
  }
}
