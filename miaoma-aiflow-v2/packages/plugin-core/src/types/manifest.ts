/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import type { PluginNodeDeclaration } from './node'
import type { PluginPermission } from './permission'

/**
 * 插件作者信息
 */
export interface PluginAuthor {
    /** 作者名称 */
    name: string
    /** 作者邮箱 */
    email?: string
    /** 作者主页 */
    url?: string
}

/**
 * 插件仓库信息
 */
export interface PluginRepository {
    /** 仓库类型 */
    type: 'git' | 'svn' | 'hg'
    /** 仓库地址 */
    url: string
}

/**
 * 插件入口配置
 */
export interface PluginEntrypoints {
    /** 后端执行器入口（UMD/ESM 格式） */
    executor: string
    /** 前端组件入口（UMD 格式，可选） */
    components?: string
}

/**
 * 插件依赖配置
 */
export interface PluginDependencies {
    /** 依赖的其他插件 */
    plugins?: Record<string, string>
    /** 平台版本要求 */
    platform?: string
}

/**
 * 插件配置 Schema
 * 用于插件级别的全局配置
 */
export interface PluginConfigSchema {
    /** Schema 类型 */
    type: 'object'
    /** 配置属性定义 */
    properties: Record<string, unknown>
    /** 必需属性 */
    required?: string[]
}

/**
 * 插件清单 (plugin.json)
 * 用于描述插件的完整信息
 */
export interface PluginManifest {
    /** 插件 ID（@scope/name 或 name 格式） */
    id: string
    /** 语义化版本号 */
    version: string
    /** 插件显示名称 */
    name: string
    /** 插件描述 */
    description: string
    /** 插件图标（URL 或 emoji） */
    icon?: string
    /** 插件作者 */
    author: PluginAuthor
    /** 插件许可证 */
    license?: string
    /** 插件主页 */
    homepage?: string
    /** 插件仓库 */
    repository?: PluginRepository
    /** 插件关键词 */
    keywords?: string[]
    /** 所需权限 */
    permissions: PluginPermission[]
    /** 节点声明列表 */
    nodes: PluginNodeDeclaration[]
    /** 入口文件配置 */
    main: PluginEntrypoints
    /** 插件依赖 */
    dependencies?: PluginDependencies
    /** 插件全局配置 Schema */
    config?: PluginConfigSchema
    /** 引擎版本要求 */
    engines?: {
        miaoma?: string
        node?: string
    }
}

/**
 * 插件清单验证结果
 */
export interface ManifestValidationResult {
    /** 是否验证通过 */
    valid: boolean
    /** 验证错误列表 */
    errors?: ManifestValidationError[]
    /** 验证警告列表 */
    warnings?: ManifestValidationWarning[]
}

/**
 * 清单验证错误
 */
export interface ManifestValidationError {
    /** 错误字段路径 */
    path: string
    /** 错误信息 */
    message: string
    /** 错误代码 */
    code: string
}

/**
 * 清单验证警告
 */
export interface ManifestValidationWarning {
    /** 警告字段路径 */
    path: string
    /** 警告信息 */
    message: string
    /** 警告代码 */
    code: string
}

/**
 * 插件状态
 */
export type PluginStatus = 'pending' | 'published' | 'suspended' | 'deprecated'

/**
 * 插件版本状态
 */
export type PluginVersionStatus = 'pending' | 'approved' | 'rejected'

/**
 * 插件分类
 */
export type PluginCategory = 'ai' | 'integration' | 'data' | 'media' | 'utility' | 'communication'

/**
 * 插件元信息（市场信息）
 */
export interface PluginMetadata {
    /** 数据库 ID */
    id: string
    /** 插件 ID */
    pluginId: string
    /** 插件名称 */
    name: string
    /** 插件描述 */
    description: string
    /** 插件图标 */
    icon?: string
    /** 插件分类 */
    category: PluginCategory
    /** 标签列表 */
    tags: string[]
    /** 下载次数 */
    downloadCount: number
    /** 评分 */
    rating?: number
    /** 状态 */
    status: PluginStatus
    /** 是否官方插件 */
    isOfficial: boolean
    /** 作者 ID */
    authorId?: string
    /** 最新版本 */
    latestVersion?: string
    /** 创建时间 */
    createdAt: Date
    /** 更新时间 */
    updatedAt: Date
}

/**
 * 插件版本信息
 */
export interface PluginVersionInfo {
    /** 版本 ID */
    id: string
    /** 版本号 */
    version: string
    /** 所需权限 */
    permissions: PluginPermission[]
    /** 节点声明 */
    nodes: PluginNodeDeclaration[]
    /** 清单文件 URL */
    manifestUrl: string
    /** 执行器 URL */
    executorUrl: string
    /** 组件 URL */
    componentsUrl?: string
    /** 变更日志 */
    changelog?: string
    /** 版本状态 */
    status: PluginVersionStatus
    /** 发布时间 */
    publishedAt?: Date
    /** 创建时间 */
    createdAt: Date
}

/**
 * 插件安装信息
 */
export interface PluginInstallation {
    /** 安装 ID */
    id: string
    /** 插件 ID */
    pluginId: string
    /** 已安装版本 */
    version: string
    /** 是否启用 */
    isEnabled: boolean
    /** 用户 ID */
    userId: string
    /** 安装时间 */
    installedAt: Date
    /** 更新时间 */
    updatedAt: Date
}
