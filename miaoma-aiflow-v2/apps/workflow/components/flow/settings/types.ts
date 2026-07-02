import { Edge, Node } from '@xyflow/react'
import { ComponentType } from 'react'

/**
 * 内置节点类型
 */
export type BuiltInNodeKind = 'start' | 'llm' | 'http' | 'condition' | 'end' | 'knowledge'

/**
 * 节点类型 - 包括内置节点和插件节点
 * 插件节点使用 `plugin:pluginId:nodeType` 格式
 */
export type NodeKind = BuiltInNodeKind | `plugin:${string}:${string}`

/**
 * 流程上下文 - 包含所有节点和边的信息
 */
export interface FlowContext {
    nodes: Node[]
    edges: Edge[]
}

/**
 * 节点设置表单的属性接口
 */
export interface NodeSettingsFormProps<T = any> {
    node: Node
    onSave?: (data: T) => void
    onCancel?: () => void
    /** 流程上下文，用于获取上游节点信息 */
    flowContext?: FlowContext
}

/**
 * 节点设置表单组件类型
 */
export type NodeSettingsFormComponent<T = any> = ComponentType<NodeSettingsFormProps<T>>

/**
 * 节点设置表单策略接口
 */
export interface NodeSettingsStrategy {
    /**
     * 获取指定节点类型的设置表单组件
     */
    getFormComponent(nodeType: NodeKind): NodeSettingsFormComponent | null

    /**
     * 注册节点类型的设置表单组件
     */
    register(nodeType: NodeKind, component: NodeSettingsFormComponent): void

    /**
     * 注销节点类型的设置表单组件
     */
    unregister(nodeType: NodeKind): boolean

    /**
     * 检查是否支持该节点类型
     */
    supports(nodeType: NodeKind): boolean
}
