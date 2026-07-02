import { buildPluginNodeType } from '@/components/flow/plugin-node-utils'
import type { RegisteredPluginNode } from '@/components/plugin/plugin-registry-client'

import { ConditionNode } from './condition-node'
import { EndNode } from './end-node'
import { HttpNode } from './http-node'
import { KnowledgeNode } from './knowledge-node'
import { LLMNode } from './llm-node'
import { PluginFlowNode } from './plugin-node'
import { StartNode } from './start-node'

export const builtInNodeTypes = {
    start: StartNode,
    llm: LLMNode,
    http: HttpNode,
    end: EndNode,
    condition: ConditionNode,
    knowledge: KnowledgeNode,
}

export function createNodeTypes(pluginNodes: RegisteredPluginNode[] = []) {
    const pluginNodeTypes = Object.fromEntries(pluginNodes.map(node => [buildPluginNodeType(node.pluginId, node.nodeType), PluginFlowNode]))

    return {
        ...builtInNodeTypes,
        ...pluginNodeTypes,
    }
}

export const nodeTypes = builtInNodeTypes

export { StartNode }
export { LLMNode }
export { HttpNode }
export { EndNode }
export { ConditionNode }
export { KnowledgeNode }
export { PluginFlowNode }
