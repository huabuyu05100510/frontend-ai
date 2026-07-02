import { inputRules, wrappingInputRule, textblockTypeInputRule } from 'prosemirror-inputrules'
import { type NodeType } from 'prosemirror-model'
import { schema } from './schema'

/**
 * Markdown-style input rules:
 *   #  space → heading 1
 *   ## space → heading 2
 *   ### space → heading 3
 *   -  space → bullet list
 *   1.  space → ordered list
 *   >  space → blockquote
 *   ``` → code block
 *   --- → horizontal rule
 *   **text** → bold
 *   *text* → italic
 *   `text` → code
 */
export function buildInputRules() {
  const rules = [
    // Heading rules
    textblockTypeInputRule(
      /^###\s$/,
      schema.nodes.heading,
      () => ({ level: 3 })
    ),
    textblockTypeInputRule(
      /^##\s$/,
      schema.nodes.heading,
      () => ({ level: 2 })
    ),
    textblockTypeInputRule(
      /^#\s$/,
      schema.nodes.heading,
      () => ({ level: 1 })
    ),

    // Blockquote
    wrappingInputRule(/^>\s$/, schema.nodes.blockquote),

    // Ordered list
    wrappingInputRule(
      /^(\d+)\.\s$/,
      schema.nodes.ordered_list,
      match => ({ order: +match[1] }),
      (match, node) => node.childCount + node.attrs.order === +match[1]
    ),

    // Bullet list
    wrappingInputRule(/^\s*[-+*]\s$/, schema.nodes.bullet_list),

    // Code block
    textblockTypeInputRule(/^```$/, schema.nodes.code_block),

    // Horizontal rule
    (nodeType: NodeType) => textblockTypeInputRule(/^(---|\*\*\*|___)\s$/, nodeType),
  ]

  return inputRules({ rules: rules.map(r => (typeof r === 'function' ? r(schema.nodes.horizontal_rule) : r)) })
}