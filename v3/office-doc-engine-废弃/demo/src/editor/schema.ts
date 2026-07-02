import { Schema, type NodeSpec, type MarkSpec, type DOMOutputSpec } from 'prosemirror-model'

// ── Marks ──────────────────────────────────────────────────────────────────────

const marks: Record<string, MarkSpec> = {
  bold: {
    parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight=bold' }],
    toDOM(): DOMOutputSpec { return ['strong', 0] },
  },
  italic: {
    parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
    toDOM(): DOMOutputSpec { return ['em', 0] },
  },
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM(): DOMOutputSpec { return ['u', 0] },
  },
  strikethrough: {
    parseDOM: [{ tag: 's' }, { style: 'text-decoration=line-through' }],
    toDOM(): DOMOutputSpec { return ['s', 0] },
  },
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM(): DOMOutputSpec { return ['code', { class: 'inline-code' }, 0] },
  },
  link: {
    attrs: { href: { default: '' }, title: { default: '' } },
    inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => ({ href: (dom as HTMLElement).getAttribute('href'), title: (dom as HTMLElement).getAttribute('title') }) }],
    toDOM(node): DOMOutputSpec { return ['a', { href: node.attrs.href, title: node.attrs.title, class: 'link' }, 0] },
  },
  highlight: {
    parseDOM: [{ tag: 'mark' }],
    toDOM(): DOMOutputSpec { return ['mark', { class: 'highlight' }, 0] },
  },
  ai_generated: {
    parseDOM: [{ tag: 'span.ai-generated' }],
    toDOM(): DOMOutputSpec { return ['span', { class: 'ai-generated' }, 0] },
  },
}

// ── Nodes ──────────────────────────────────────────────────────────────────────

const blockAttrs = { id: { default: null } }

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },

  text: { group: 'inline' },

  paragraph: {
    content: 'inline*',
    group: 'block',
    attrs: blockAttrs,
    parseDOM: [{ tag: 'p' }],
    toDOM(): DOMOutputSpec { return ['p', 0] },
  },

  heading: {
    content: 'inline*',
    group: 'block',
    attrs: { ...blockAttrs, level: { default: 1 } },
    defining: true,
    parseDOM: [
      { tag: 'h1', attrs: { level: 1 } },
      { tag: 'h2', attrs: { level: 2 } },
      { tag: 'h3', attrs: { level: 3 } },
      { tag: 'h4', attrs: { level: 4 } },
      { tag: 'h5', attrs: { level: 5 } },
      { tag: 'h6', attrs: { level: 6 } },
    ],
    toDOM(node): DOMOutputSpec { return [`h${node.attrs.level}`, { class: `heading heading-${node.attrs.level}` }, 0] },
  },

  blockquote: {
    content: 'block+',
    group: 'block',
    attrs: blockAttrs,
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM(): DOMOutputSpec { return ['blockquote', { class: 'blockquote' }, 0] },
  },

  code_block: {
    content: 'text*',
    group: 'block',
    attrs: { ...blockAttrs, language: { default: '' } },
    code: true,
    defining: true,
    marks: '',
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    toDOM(): DOMOutputSpec { return ['pre', { class: 'code-block' }, ['code', 0]] },
  },

  horizontal_rule: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM(): DOMOutputSpec { return ['hr', { class: 'divider' }] },
  },

  bullet_list: {
    content: 'list_item+',
    group: 'block',
    attrs: blockAttrs,
    parseDOM: [{ tag: 'ul' }],
    toDOM(): DOMOutputSpec { return ['ul', { class: 'bullet-list' }, 0] },
  },

  ordered_list: {
    content: 'list_item+',
    group: 'block',
    attrs: { ...blockAttrs, order: { default: 1 } },
    parseDOM: [{ tag: 'ol' }],
    toDOM(): DOMOutputSpec { return ['ol', { class: 'ordered-list' }, 0] },
  },

  list_item: {
    content: 'paragraph block*',
    attrs: blockAttrs,
    defining: true,
    parseDOM: [{ tag: 'li' }],
    toDOM(): DOMOutputSpec { return ['li', { class: 'list-item' }, 0] },
  },

  image: {
    group: 'block',
    attrs: { ...blockAttrs, src: { default: '' }, alt: { default: '' }, title: { default: '' } },
    parseDOM: [{ tag: 'img[src]', getAttrs: (dom) => ({ src: (dom as HTMLElement).getAttribute('src'), alt: (dom as HTMLElement).getAttribute('alt'), title: (dom as HTMLElement).getAttribute('title') }) }],
    toDOM(node): DOMOutputSpec { return ['img', { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title, class: 'block-image' }] },
  },
}

export const schema = new Schema({ nodes, marks })