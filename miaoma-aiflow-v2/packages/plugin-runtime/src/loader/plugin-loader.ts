/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import type { PluginManifest, PluginNodeExecutor, PluginPermission, PluginServices } from '@miaoma-aiflow/plugin-core'

import type { SandboxContext } from '../sandbox/sandbox-context'
import { createSandboxContext } from '../sandbox/sandbox-context'
import type { CDNFetcherConfig, PluginRemoteAssetUrls, PluginResource } from './cdn-fetcher'
import { CDNFetcher } from './cdn-fetcher'

/**
 * 插件模块 - 加载后的插件实例
 */
export interface PluginModule {
    /** 插件 ID */
    pluginId: string
    /** 版本号 */
    version: string
    /** 插件清单 */
    manifest: PluginManifest
    /** 节点执行器映射 */
    executors: Map<string, PluginNodeExecutor>
    /** 沙箱上下文 */
    sandbox: SandboxContext
    /** 卸载方法 */
    unload: () => void
}

/**
 * 插件加载器配置
 */
export interface PluginLoaderConfig {
    /** CDN 配置 */
    cdn: CDNFetcherConfig
    /** 服务提供者（用于沙箱） */
    services: PluginLoaderServices
}

/**
 * 插件加载器服务
 */
export interface PluginLoaderServices {
    /** 原生 fetch（将被包装） */
    fetch: typeof fetch
    /** 获取环境变量 */
    getEnv: (key: string) => string | undefined
    /** 发送邮件 */
    sendEmail: PluginServices['sendEmail']
    /** 调用 LLM */
    invokeLLM: (options: {
        model?: string
        systemPrompt?: string
        userMessage: string
        temperature?: number
        maxTokens?: number
    }) => Promise<{ text: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }>
    /** 知识库检索 */
    searchKnowledge: (options: {
        knowledgeBaseIds: string[]
        query: string
        topK?: number
        threshold?: number
    }) => Promise<{ documents: Array<{ id: string; content: string; score: number; metadata?: Record<string, unknown> }> }>
}

/**
 * 基于显式 URL 的插件加载参数
 */
export interface PluginLoaderRemoteLoadOptions extends PluginRemoteAssetUrls {
    /** 实际授予的权限 */
    grantedPermissions: PluginPermission[]
}

/**
 * 加载结果
 */
export interface LoadResult {
    success: boolean
    module?: PluginModule
    error?: string
}

/**
 * 插件加载器
 * 负责动态加载和管理插件
 */
export class PluginLoader {
    private fetcher: CDNFetcher
    private services: PluginLoaderServices
    private loadedPlugins: Map<string, PluginModule> = new Map()

    constructor(config: PluginLoaderConfig) {
        this.fetcher = new CDNFetcher({
            ...config.cdn,
            fetch: config.services.fetch,
        })
        this.services = config.services
    }

    /**
     * 加载插件
     */
    async load(pluginId: string, version: string, grantedPermissions: PluginPermission[]): Promise<LoadResult> {
        const fetchResult = await this.fetcher.fetchPlugin(pluginId, version)
        if (!fetchResult.success || !fetchResult.data) {
            return { success: false, error: fetchResult.error }
        }

        return this.loadFromResource(fetchResult.data, grantedPermissions)
    }

    /**
     * 通过显式资源 URL 加载插件
     */
    async loadFromUrls(options: PluginLoaderRemoteLoadOptions): Promise<LoadResult> {
        const { grantedPermissions, ...resourceUrls } = options
        const fetchResult = await this.fetcher.fetchPluginByUrls(resourceUrls)
        if (!fetchResult.success || !fetchResult.data) {
            return { success: false, error: fetchResult.error }
        }

        return this.loadFromResource(fetchResult.data, grantedPermissions)
    }

    /**
     * 直接从已解析资源加载插件
     */
    async loadFromResource(resource: PluginResource, grantedPermissions: PluginPermission[]): Promise<LoadResult> {
        const cacheKey = `${resource.pluginId}@${resource.version}`

        if (this.loadedPlugins.has(cacheKey)) {
            return { success: true, module: this.loadedPlugins.get(cacheKey) }
        }

        try {
            const permissionValidation = this.validatePermissions(resource.manifest.permissions, grantedPermissions)
            if (!permissionValidation.valid) {
                return {
                    success: false,
                    error: `Permission denied: ${permissionValidation.missingPermissions?.join(', ')}`,
                }
            }

            const sandbox = createSandboxContext({
                pluginId: resource.pluginId,
                grantedPermissions,
                services: this.services,
            })

            const executors = await this.executePluginCode(resource, sandbox)

            const module: PluginModule = {
                pluginId: resource.pluginId,
                version: resource.version,
                manifest: resource.manifest,
                executors,
                sandbox,
                unload: () => this.unload(resource.pluginId, resource.version),
            }

            this.loadedPlugins.set(cacheKey, module)

            return { success: true, module }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to load plugin',
            }
        }
    }

    /**
     * 卸载插件
     */
    async unload(pluginId: string, version: string): Promise<void> {
        const cacheKey = `${pluginId}@${version}`
        const module = this.loadedPlugins.get(cacheKey)

        if (module) {
            // 清理沙箱
            module.sandbox.destroy()
            // 从缓存移除
            this.loadedPlugins.delete(cacheKey)
            // 清理 CDN 缓存
            this.fetcher.clearCache(pluginId, version)
        }
    }

    /**
     * 获取已加载的插件
     */
    getLoadedPlugin(pluginId: string, version: string): PluginModule | undefined {
        return this.loadedPlugins.get(`${pluginId}@${version}`)
    }

    /**
     * 获取所有已加载的插件
     */
    getAllLoadedPlugins(): PluginModule[] {
        return Array.from(this.loadedPlugins.values())
    }

    /**
     * 验证权限
     */
    private validatePermissions(
        requiredPermissions: PluginPermission[],
        grantedPermissions: PluginPermission[]
    ): { valid: boolean; missingPermissions?: PluginPermission[] } {
        const missingPermissions = requiredPermissions.filter(p => !grantedPermissions.includes(p))

        return {
            valid: missingPermissions.length === 0,
            missingPermissions: missingPermissions.length > 0 ? missingPermissions : undefined,
        }
    }

    /**
     * 执行插件代码
     */
    private async executePluginCode(resource: PluginResource, sandbox: SandboxContext): Promise<Map<string, PluginNodeExecutor>> {
        try {
            // 创建模块执行环境
            const moduleExports: Record<string, unknown> = {}
            const moduleContext = {
                exports: moduleExports,
                module: { exports: moduleExports },
                // 提供沙箱化的服务
                services: sandbox.getServices(),
                console: sandbox.getConsole(),
            }

            // 使用 Function 构造器执行代码（比 eval 更安全）
            // 注意：实际生产环境可能需要更严格的沙箱（如 vm2 或 Web Worker）
            const executorFunction = new Function(
                'exports',
                'module',
                'services',
                'console',
                `
                "use strict";
                ${resource.executorCode}
                `
            )

            executorFunction(moduleContext.exports, moduleContext.module, moduleContext.services, moduleContext.console)

            // 获取导出的执行器
            return this.resolvePluginExecutors(moduleContext.module.exports as Record<string, unknown>, resource.manifest)
        } catch (error) {
            throw new Error(`Failed to execute plugin code: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
    }

    /**
     * 解析插件导出的执行器
     */
    private resolvePluginExecutors(exportsObject: Record<string, unknown>, manifest: PluginManifest): Map<string, PluginNodeExecutor> {
        const executors = new Map<string, PluginNodeExecutor>()
        const defaultExport = this.isRecord(exportsObject.default) ? exportsObject.default : undefined
        const exportedExecutorLists = [exportsObject.executors, defaultExport?.executors]

        for (const nodeDecl of manifest.nodes) {
            const executorName = `${this.toPascalCase(nodeDecl.type)}Executor`
            const directExport = exportsObject[executorName]
            const defaultNamedExport = defaultExport?.[executorName]

            if (typeof directExport === 'function') {
                executors.set(nodeDecl.type, new (directExport as new () => PluginNodeExecutor)())
                continue
            }

            if (this.isPluginExecutor(directExport)) {
                executors.set(nodeDecl.type, directExport)
                continue
            }

            if (typeof defaultNamedExport === 'function') {
                executors.set(nodeDecl.type, new (defaultNamedExport as new () => PluginNodeExecutor)())
                continue
            }

            if (this.isPluginExecutor(defaultNamedExport)) {
                executors.set(nodeDecl.type, defaultNamedExport)
                continue
            }

            for (const list of exportedExecutorLists) {
                if (!Array.isArray(list)) {
                    continue
                }

                const matchedExecutor = list.find(item => this.isPluginExecutor(item) && item.type === nodeDecl.type)
                if (matchedExecutor && this.isPluginExecutor(matchedExecutor)) {
                    executors.set(nodeDecl.type, matchedExecutor)
                    break
                }
            }
        }

        return executors
    }

    /**
     * 转换为 PascalCase
     */
    private toPascalCase(str: string): string {
        return str
            .split(/[-_]/)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
            .join('')
    }

    private isPluginExecutor(value: unknown): value is PluginNodeExecutor {
        return this.isRecord(value) && typeof value.type === 'string' && typeof value.execute === 'function'
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    /**
     * 卸载所有插件
     */
    async unloadAll(): Promise<void> {
        for (const [key, module] of this.loadedPlugins) {
            module.sandbox.destroy()
            this.loadedPlugins.delete(key)
        }
        this.fetcher.clearCache()
    }
}
