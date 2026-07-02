/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

/**
 * 插件分类
 */
export type PluginCategory = 'AI' | 'INTEGRATION' | 'DATA' | 'MEDIA' | 'UTILITY' | 'COMMUNICATION'

/**
 * 插件状态
 */
export type PluginStatus = 'PENDING' | 'PUBLISHED' | 'SUSPENDED' | 'DEPRECATED'

/**
 * 插件版本状态
 */
export type PluginVersionStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

/**
 * 插件作者
 */
export interface PluginAuthor {
    id: string
    name?: string
    email?: string
    avatar?: string
}

/**
 * 插件节点定义
 */
export interface PluginNodeInfo {
    type: string
    name: string
    icon: string
    color: string
    category: string
    description?: string
}

/**
 * 插件版本
 */
export interface PluginVersion {
    id: string
    version: string
    permissions: string[]
    nodes: PluginNodeInfo[]
    manifestUrl: string
    executorUrl: string
    componentsUrl?: string
    status: PluginVersionStatus
    changelog?: string
    publishedAt?: string
    createdAt: string
}

/**
 * 插件信息
 */
export interface PluginInfo {
    id: string
    pluginId: string
    name: string
    description: string
    icon?: string
    author?: PluginAuthor
    category: PluginCategory
    tags: string[]
    downloadCount: number
    status: PluginStatus
    isOfficial: boolean
    latestVersion?: PluginVersion
    versions?: PluginVersion[]
    createdAt: string
    updatedAt: string
}

/**
 * 已安装的插件
 */
export interface InstalledPlugin {
    id: string
    pluginId: string
    isEnabled: boolean
    config?: unknown
    plugin: PluginInfo
    version: PluginVersion
    hasUpdate: boolean
    installedAt: string
    updatedAt: string
}

/**
 * 插件列表过滤器
 */
export interface PluginFilters {
    category?: PluginCategory
    search?: string
    tag?: string
    isOfficial?: boolean
}

/**
 * 分类信息
 */
export interface CategoryInfo {
    value: PluginCategory
    label: string
    icon: string
    color: string
    description: string
}

/**
 * 分类配置
 */
export const PLUGIN_CATEGORIES: CategoryInfo[] = [
    { value: 'AI', label: 'AI / LLM', icon: 'Brain', color: '#8B5CF6', description: '人工智能与大语言模型相关插件' },
    { value: 'INTEGRATION', label: '集成', icon: 'Plug', color: '#3B82F6', description: '第三方服务和API集成' },
    { value: 'DATA', label: '数据处理', icon: 'Database', color: '#10B981', description: '数据转换、解析和处理工具' },
    { value: 'MEDIA', label: '媒体', icon: 'Image', color: '#F59E0B', description: '图片、音视频处理插件' },
    { value: 'UTILITY', label: '工具', icon: 'Wrench', color: '#6B7280', description: '通用工具和辅助功能' },
    { value: 'COMMUNICATION', label: '通讯', icon: 'Mail', color: '#EF4444', description: '邮件、消息和通知服务' },
]

/**
 * 权限说明
 */
export const PERMISSION_LABELS: Record<string, { label: string; description: string; risk: 'low' | 'medium' | 'high' }> = {
    network: {
        label: '网络请求',
        description: '插件可以发送HTTP请求访问外部服务',
        risk: 'medium',
    },
    storage: {
        label: '本地存储',
        description: '插件可以读写浏览器本地存储',
        risk: 'low',
    },
    'env:read': {
        label: '环境变量',
        description: '插件可以读取工作流环境变量',
        risk: 'medium',
    },
    'email:send': {
        label: '邮件发送',
        description: '插件可以调用平台内置 SMTP 邮件服务发送邮件',
        risk: 'medium',
    },
    'llm:invoke': {
        label: 'LLM 调用',
        description: '插件可以调用大语言模型',
        risk: 'low',
    },
    'knowledge:read': {
        label: '知识库访问',
        description: '插件可以读取知识库内容',
        risk: 'low',
    },
}
