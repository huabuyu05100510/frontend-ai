// ============================================================================
// xml — 极简 XML 解析（命名空间感知，纯函数，不依赖 DOMParser）
//   面向 OOXML：处理元素/属性/文本/自闭合/声明/注释/CDATA/实体。
// ============================================================================

export interface XmlNode {
  tag: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string // 直接文本（拼接本元素下的文本片段）
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    switch (e) {
      case 'amp':
        return '&'
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
      default:
        if (e[0] === '#') {
          const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
          return Number.isFinite(code) ? String.fromCodePoint(code) : ''
        }
        return ''
    }
  })
}

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const key = m[1] ?? m[3]
    const val = m[2] ?? m[4]
    attrs[key] = decodeEntities(val)
  }
  return attrs
}

export function parseXml(input: string): XmlNode {
  // 去掉声明、注释、CDATA 包裹（CDATA 内容保留为文本）
  let src = input.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  src = src.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, c) => c.replace(/&/g, '&amp;').replace(/</g, '&lt;'))

  const root: XmlNode = { tag: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  const tagRe = /<(\/?)([\w:.-]+)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(src))) {
    const textChunk = src.slice(last, m.index)
    if (textChunk.trim()) {
      const t = decodeEntities(textChunk)
      stack[stack.length - 1].text += t
    }
    last = tagRe.lastIndex
    const [, closing, tag, attrStr, selfClose] = m
    if (closing) {
      // 关闭标签：回退到匹配层
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i
          break
        }
      }
    } else {
      const node: XmlNode = { tag, attrs: parseAttrs(attrStr), children: [], text: '' }
      stack[stack.length - 1].children.push(node)
      if (!selfClose) stack.push(node)
    }
  }
  return root.children.length === 1 ? root.children[0] : root
}

/** 深度优先收集所有指定标签节点 */
export function findAll(node: XmlNode, tag: string): XmlNode[] {
  const out: XmlNode[] = []
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.tag === tag) out.push(c)
      walk(c)
    }
  }
  walk(node)
  return out
}

/** 直接子节点中第一个匹配标签 */
export function firstChild(node: XmlNode, tag: string): XmlNode | undefined {
  return node.children.find((c) => c.tag === tag)
}

export function firstText(node: XmlNode): string {
  return node.text
}

export function attr(node: XmlNode, name: string): string | undefined {
  return node.attrs[name]
}
