/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import type { PluginManifest } from '@miaoma-aiflow/plugin-core'

/**
 * CDN 获取器配置
 */
export interface CDNFetcherConfig {
    /** CDN 基础 URL */
    baseUrl?: string
    /** 请求超时时间（毫秒） */
    timeout?: number
    /** 重试次数 */
    retryCount?: number
    /** 自定义请求头 */
    headers?: Record<string, string>
    /** 自定义 fetch 实现 */
    fetch?: typeof fetch
}

/**
 * 插件资源信息
 */
export interface PluginResource {
    /** 插件 ID */
    pluginId: string
    /** 版本号 */
    version: string
    /** 清单文件 */
    manifest: PluginManifest
    /** 执行器代码 */
    executorCode: string
    /** 组件代码（可选） */
    componentsCode?: string
}

/**
 * 远程插件资源地址
 */
export interface PluginRemoteAssetUrls {
    /** 插件 ID */
    pluginId: string
    /** 版本号 */
    version: string
    /** plugin.json 绝对 URL */
    manifestUrl: string
    /** 执行器 bundle 绝对 URL（可选，不传则基于 manifest.main.executor 推导） */
    executorUrl?: string
    /** 组件 bundle 绝对 URL（可选，不传则基于 manifest.main.components 推导） */
    componentsUrl?: string
}

/**
 * 获取结果
 */
export interface FetchResult<T> {
    success: boolean
    data?: T
    error?: string
}

/**
 * CDN 资源获取器
 * 负责从 CDN 获取插件资源
 */
export class CDNFetcher {
    private config: Required<CDNFetcherConfig>
    private fetcher: typeof fetch
    private cache: Map<string, PluginResource> = new Map()

    constructor(config: CDNFetcherConfig) {
        this.config = {
            baseUrl: (config.baseUrl ?? '').replace(/\/$/, ''),
            timeout: config.timeout ?? 30000,
            retryCount: config.retryCount ?? 3,
            headers: config.headers ?? {},
            fetch: config.fetch ?? fetch,
        }
        this.fetcher = this.config.fetch
    }

    /**
     * 获取插件资源
     */
    async fetchPlugin(pluginId: string, version: string): Promise<FetchResult<PluginResource>> {
        if (!this.config.baseUrl) {
            return { success: false, error: 'CDN baseUrl is not configured' }
        }

        const cacheKey = `${pluginId}@${version}`

        // 检查缓存
        if (this.cache.has(cacheKey)) {
            return { success: true, data: this.cache.get(cacheKey) }
        }

        try {
            // 获取清单文件
            const manifestResult = await this.fetchManifest(pluginId, version)
            if (!manifestResult.success || !manifestResult.data) {
                return { success: false, error: manifestResult.error }
            }

            const manifest = manifestResult.data

            // 获取执行器代码
            const executorResult = await this.fetchExecutor(pluginId, version, manifest.main.executor)
            if (!executorResult.success || !executorResult.data) {
                return { success: false, error: executorResult.error }
            }

            // 获取组件代码（可选）
            let componentsCode: string | undefined
            if (manifest.main.components) {
                const componentsResult = await this.fetchComponents(pluginId, version, manifest.main.components)
                if (componentsResult.success && componentsResult.data) {
                    componentsCode = componentsResult.data
                }
            }

            const resource: PluginResource = {
                pluginId,
                version,
                manifest,
                executorCode: executorResult.data,
                componentsCode,
            }

            // 缓存资源
            this.cache.set(cacheKey, resource)

            return { success: true, data: resource }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            }
        }
    }

    /**
     * 根据显式 URL 获取插件资源
     */
    async fetchPluginByUrls(source: PluginRemoteAssetUrls): Promise<FetchResult<PluginResource>> {
        const cacheKey = `${source.pluginId}@${source.version}`

        if (this.cache.has(cacheKey)) {
            return { success: true, data: this.cache.get(cacheKey) }
        }

        try {
            const manifestResult = await this.fetchWithRetry<PluginManifest>(source.manifestUrl, 'json')
            if (!manifestResult.success || !manifestResult.data) {
                return { success: false, error: manifestResult.error }
            }

            const manifest = manifestResult.data
            const executorUrl = source.executorUrl ?? this.resolveAssetUrl(source.manifestUrl, manifest.main.executor)
            const executorResult = await this.fetchWithRetry<string>(executorUrl, 'text')
            if (!executorResult.success || !executorResult.data) {
                return { success: false, error: executorResult.error }
            }

            let componentsCode: string | undefined
            const componentsUrl =
                source.componentsUrl ??
                (manifest.main.components ? this.resolveAssetUrl(source.manifestUrl, manifest.main.components) : undefined)
            if (componentsUrl) {
                const componentsResult = await this.fetchWithRetry<string>(componentsUrl, 'text')
                if (componentsResult.success && componentsResult.data) {
                    componentsCode = componentsResult.data
                }
            }

            const resource: PluginResource = {
                pluginId: source.pluginId,
                version: source.version,
                manifest,
                executorCode: executorResult.data,
                componentsCode,
            }

            this.cache.set(cacheKey, resource)

            return { success: true, data: resource }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            }
        }
    }

    /**
     * 获取插件清单
     */
    async fetchManifest(pluginId: string, version: string): Promise<FetchResult<PluginManifest>> {
        const url = this.buildUrl(pluginId, version, 'plugin.json')
        return this.fetchWithRetry<PluginManifest>(url, 'json')
    }

    /**
     * 获取执行器代码
     */
    async fetchExecutor(pluginId: string, version: string, executorPath: string): Promise<FetchResult<string>> {
        const url = this.buildUrl(pluginId, version, executorPath)
        return this.fetchWithRetry<string>(url, 'text')
    }

    /**
     * 获取组件代码
     */
    async fetchComponents(pluginId: string, version: string, componentsPath: string): Promise<FetchResult<string>> {
        const url = this.buildUrl(pluginId, version, componentsPath)
        return this.fetchWithRetry<string>(url, 'text')
    }

    /**
     * 构建资源 URL
     */
    private buildUrl(pluginId: string, version: string, path: string): string {
        // 将 @scope/name 转换为 scope/name
        const normalizedId = pluginId.replace(/^@/, '')
        return `${this.config.baseUrl}/${normalizedId}/${version}/${path}`
    }

    /**
     * 基于参考 URL 解析资源地址
     */
    private resolveAssetUrl(referenceUrl: string, assetPath: string): string {
        return new URL(assetPath, referenceUrl).toString()
    }

    /**
     * 带重试的获取请求
     */
    private async fetchWithRetry<T>(url: string, responseType: 'json' | 'text'): Promise<FetchResult<T>> {
        let lastError: string = 'Unknown error'

        for (let attempt = 0; attempt < this.config.retryCount; attempt++) {
            try {
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

                const response = await this.fetcher(url, {
                    headers: this.config.headers,
                    signal: controller.signal,
                })

                clearTimeout(timeoutId)

                if (!response.ok) {
                    lastError = `HTTP ${response.status}: ${response.statusText}`
                    continue
                }

                const data = responseType === 'json' ? await response.json() : await response.text()

                return { success: true, data: data as T }
            } catch (error) {
                if (error instanceof Error) {
                    if (error.name === 'AbortError') {
                        lastError = 'Request timeout'
                    } else {
                        lastError = error.message
                    }
                }

                // 在重试之前等待
                if (attempt < this.config.retryCount - 1) {
                    await this.delay(Math.pow(2, attempt) * 1000)
                }
            }
        }

        return { success: false, error: lastError }
    }

    /**
     * 延迟
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    /**
     * 清除缓存
     */
    clearCache(pluginId?: string, version?: string): void {
        if (pluginId && version) {
            this.cache.delete(`${pluginId}@${version}`)
        } else if (pluginId) {
            for (const key of this.cache.keys()) {
                if (key.startsWith(`${pluginId}@`)) {
                    this.cache.delete(key)
                }
            }
        } else {
            this.cache.clear()
        }
    }

    /**
     * 获取缓存大小
     */
    getCacheSize(): number {
        return this.cache.size
    }
}
