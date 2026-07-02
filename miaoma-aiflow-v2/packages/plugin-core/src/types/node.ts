/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import type { JSONSchema7 } from 'json-schema'

/**
 * 节点分类
 */
export type PluginNodeCategory =
    | 'input'
    | 'process'
    | 'output'
    | 'control'
    | 'integration'
    | 'ai'
    | 'utility'
    | 'communication'
    | 'data'
    | 'media'

/**
 * 节点输出定义
 */
export interface PluginNodeOutput {
    /** 输出名称 */
    name: string
    /** 输出类型 */
    type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any'
    /** 输出描述 */
    description: string
}

/**
 * 节点输入定义
 */
export interface PluginNodeInput {
    /** 输入名称 */
    name: string
    /** 输入类型 */
    type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any'
    /** 输入描述 */
    description: string
    /** 是否必需 */
    required?: boolean
}

/**
 * 扩展的 JSON Schema 属性
 * 用于支持变量引用等自定义功能
 */
export interface ExtendedJSONSchema7 extends JSONSchema7 {
    /** 是否支持变量引用 */
    'x-variable'?: boolean
    /** 组件类型提示 */
    'x-component'?: string
    /** 组件属性 */
    'x-component-props'?: Record<string, unknown>
    /** 字段分组 */
    'x-group'?: string
    /** 字段顺序 */
    'x-order'?: number
    /** 嵌套属性也支持扩展 */
    properties?: Record<string, ExtendedJSONSchema7>
    items?: ExtendedJSONSchema7 | ExtendedJSONSchema7[]
}

/**
 * 插件节点声明
 * 用于在 plugin.json 中声明节点类型
 */
export interface PluginNodeDeclaration {
    /** 节点类型标识（唯一） */
    type: string
    /** 节点显示名称 */
    name: string
    /** 节点描述 */
    description?: string
    /** 节点图标（Lucide 图标名称或 emoji） */
    icon: string
    /** 节点颜色（十六进制颜色值） */
    color: string
    /** 节点分类 */
    category: PluginNodeCategory
    /** 节点配置 Schema */
    configSchema: ExtendedJSONSchema7
    /** 节点输入定义 */
    inputs?: PluginNodeInput[]
    /** 节点输出定义 */
    outputs: PluginNodeOutput[]
    /** 自定义组件名称（可选，用于自定义渲染） */
    customComponent?: string
    /** 是否支持多个输入连接 */
    multipleInputs?: boolean
    /** 是否支持多个输出连接 */
    multipleOutputs?: boolean
}

/**
 * 节点执行上下文
 */
export interface PluginNodeExecutionContext {
    /** 节点 ID */
    nodeId: string
    /** 节点类型 */
    nodeType: string
    /** 工作流 ID */
    workflowId: string
    /** 执行 ID */
    executionId: string
    /** 上游节点输出 */
    inputs: Record<string, unknown>
    /** 节点配置 */
    config: Record<string, unknown>
    /** 日志记录器 */
    logger: PluginLogger
    /** 服务代理 */
    services: PluginServices
}

/**
 * 插件日志记录器接口
 */
export interface PluginLogger {
    debug(message: string, ...args: unknown[]): void
    info(message: string, ...args: unknown[]): void
    warn(message: string, ...args: unknown[]): void
    error(message: string, ...args: unknown[]): void
}

/**
 * 平台邮件发送选项
 */
export interface PluginEmailSendOptions {
    /** 收件人，支持单个邮箱或逗号分隔的多个邮箱 */
    to: string
    /** 邮件主题 */
    subject: string
    /** HTML 内容 */
    html: string
}

/**
 * 插件服务代理接口
 * 提供受权限控制的系统服务访问
 */
export interface PluginServices {
    /** 发起 HTTP 请求（需要 network 权限） */
    fetch: typeof fetch
    /** 读取环境变量（需要 env:read 权限） */
    getEnv: (key: string) => string | undefined
    /** 调用平台内置邮件服务（需要 email:send 权限） */
    sendEmail: (options: PluginEmailSendOptions) => Promise<boolean>
    /** 调用 LLM（需要 llm:invoke 权限） */
    invokeLLM: (options: LLMInvokeOptions) => Promise<LLMInvokeResult>
    /** 知识库检索（需要 knowledge:read 权限） */
    searchKnowledge: (options: KnowledgeSearchOptions) => Promise<KnowledgeSearchResult>
}

/**
 * LLM 调用选项
 */
export interface LLMInvokeOptions {
    /** 模型标识 */
    model?: string
    /** 系统提示词 */
    systemPrompt?: string
    /** 用户消息 */
    userMessage: string
    /** 温度参数 */
    temperature?: number
    /** 最大 token 数 */
    maxTokens?: number
}

/**
 * LLM 调用结果
 */
export interface LLMInvokeResult {
    /** 生成的文本 */
    text: string
    /** 使用的 token 数 */
    usage?: {
        promptTokens: number
        completionTokens: number
        totalTokens: number
    }
}

/**
 * 知识库检索选项
 */
export interface KnowledgeSearchOptions {
    /** 知识库 ID 列表 */
    knowledgeBaseIds: string[]
    /** 查询文本 */
    query: string
    /** 返回结果数量 */
    topK?: number
    /** 相似度阈值 */
    threshold?: number
}

/**
 * 知识库检索结果
 */
export interface KnowledgeSearchResult {
    /** 检索到的文档片段 */
    documents: Array<{
        id: string
        content: string
        score: number
        metadata?: Record<string, unknown>
    }>
}

/**
 * 节点执行结果
 */
export interface PluginNodeExecutionResult {
    /** 是否执行成功 */
    success: boolean
    /** 输出数据 */
    outputs?: Record<string, unknown>
    /** 错误信息 */
    error?: string
    /** 执行元数据 */
    metadata?: Record<string, unknown>
}

/**
 * 插件节点执行器接口
 */
export interface PluginNodeExecutor {
    /** 节点类型 */
    readonly type: string
    /** 执行节点 */
    execute(context: PluginNodeExecutionContext): Promise<PluginNodeExecutionResult>
    /** 验证配置（可选） */
    validate?(config: Record<string, unknown>): { valid: boolean; errors?: string[] }
}
