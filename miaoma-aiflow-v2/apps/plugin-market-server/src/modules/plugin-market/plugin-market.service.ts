/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { Injectable, NotFoundException } from '@nestjs/common'

interface PluginManifestAuthor {
    name?: string
    email?: string
    url?: string
}

interface PluginManifestNodeOutput {
    name?: string
    type?: string
    description?: string
}

interface PluginManifestNode {
    type: string
    name?: string
    description?: string
    icon?: string
    color?: string
    category?: string
    configSchema?: Record<string, unknown>
    outputs?: PluginManifestNodeOutput[]
}

interface PluginManifest {
    id: string
    version: string
    name: string
    description: string
    icon?: string
    author?: PluginManifestAuthor
    homepage?: string
    keywords?: string[]
    permissions?: string[]
    nodes?: PluginManifestNode[]
}

interface RegistryPluginVersionDefinition {
    version: string
    status: 'APPROVED'
    changelog: string
    publishedAt: string
    createdAt: string
    packageRelativePath: string
}

interface RegistryPluginDefinition {
    pluginId: string
    packageRelativePath: string
    category: 'AI' | 'INTEGRATION' | 'DATA' | 'MEDIA' | 'UTILITY' | 'COMMUNICATION'
    status: 'PUBLISHED'
    isOfficial: boolean
    downloadCount: number
    installCount: number
    rating: number
    ratingCount: number
    author: {
        id: string
        name: string
    }
    createdAt: string
    updatedAt: string
    versions: RegistryPluginVersionDefinition[]
}

interface RawRegistryPluginVersionDefinition {
    version?: string
    status?: 'APPROVED'
    changelog?: string
    publishedAt?: string
    createdAt?: string
    packageRelativePath?: string
}

interface RawRegistryPluginDefinition {
    pluginId?: string
    packageRelativePath?: string
    category?: 'AI' | 'INTEGRATION' | 'DATA' | 'MEDIA' | 'UTILITY' | 'COMMUNICATION'
    status?: 'PUBLISHED'
    isOfficial?: boolean
    downloadCount?: number
    installCount?: number
    rating?: number
    ratingCount?: number
    author?: {
        id?: string
        name?: string
    }
    createdAt?: string
    updatedAt?: string
    versions?: RawRegistryPluginVersionDefinition[]
}

interface RegistryFileDefinition {
    plugins?: RawRegistryPluginDefinition[]
}

export interface PluginAssetResult {
    content: Buffer
    contentType: string
}

interface PublicPluginVersion {
    id: string
    version: string
    permissions: string[]
    nodes: PluginManifestNode[]
    manifestUrl: string
    executorUrl: string
    status: 'APPROVED'
    changelog: string
    publishedAt: string
    createdAt: string
}

export interface PublicPluginInfo {
    id: string
    pluginId: string
    name: string
    description: string
    icon?: string
    author: {
        id: string
        name: string
    }
    category: 'AI' | 'INTEGRATION' | 'DATA' | 'MEDIA' | 'UTILITY' | 'COMMUNICATION'
    tags: string[]
    downloadCount: number
    rating: number
    ratingCount: number
    status: 'PUBLISHED'
    isOfficial: boolean
    latestVersion: PublicPluginVersion
    versions: PublicPluginVersion[]
    homepage?: string
    installCount: number
    createdAt: string
    updatedAt: string
}

export interface PluginCatalogPage {
    items: Array<Omit<PublicPluginInfo, 'versions'> & { versions?: PublicPluginVersion[] }>
    meta: {
        page: number
        pageSize: number
        total: number
        totalPages: number
    }
}

const DEFAULT_PUBLISHED_AT = '2026-04-05T00:00:00.000Z'

@Injectable()
export class PluginMarketService {
    private readonly workspaceRoot = this.resolveWorkspaceRoot()
    private readonly registryFilePath = path.join(this.workspaceRoot, 'apps', 'plugin-market-server', 'registry', 'plugins.json')

    async listPlugins(baseUrl: string, page: number, pageSize: number): Promise<PluginCatalogPage> {
        const registryPlugins = await this.ensureRegistryLoaded()
        const plugins = await Promise.all(
            registryPlugins.map(async definition => {
                const detail = await this.buildPluginDetail(definition, baseUrl)
                return {
                    ...detail,
                    versions: undefined,
                }
            })
        )

        const total = plugins.length
        const safePageSize = Math.max(1, pageSize)
        const safePage = Math.max(1, page)
        const startIndex = (safePage - 1) * safePageSize
        const totalPages = Math.max(1, Math.ceil(total / safePageSize))

        return {
            items: plugins.slice(startIndex, startIndex + safePageSize),
            meta: {
                page: safePage,
                pageSize: safePageSize,
                total,
                totalPages,
            },
        }
    }

    async getPluginDetail(pluginId: string, baseUrl: string): Promise<PublicPluginInfo> {
        const registryPlugins = await this.ensureRegistryLoaded()
        const definition = this.getPluginDefinition(registryPlugins, pluginId)
        return this.buildPluginDetail(definition, baseUrl)
    }

    async loadPluginAsset(pluginId: string, version: string, file: string): Promise<PluginAssetResult> {
        const registryPlugins = await this.ensureRegistryLoaded()
        const definition = this.getPluginDefinition(registryPlugins, pluginId)
        const versionDefinition = definition.versions.find(item => item.version === version)

        if (!versionDefinition) {
            throw new NotFoundException(`未找到插件版本: ${pluginId}@${version}`)
        }

        const pluginRoot = this.getPluginRoot(versionDefinition.packageRelativePath)
        const assetPath = path.resolve(pluginRoot, file)
        const normalizedPluginRoot = path.resolve(pluginRoot)

        if (!assetPath.startsWith(`${normalizedPluginRoot}${path.sep}`) && assetPath !== normalizedPluginRoot) {
            throw new NotFoundException('非法的插件资源路径')
        }

        const content = await readFile(assetPath)

        return {
            content,
            contentType: this.getContentType(file),
        }
    }

    private async buildPluginDetail(definition: RegistryPluginDefinition, baseUrl: string): Promise<PublicPluginInfo> {
        const versions = await Promise.all(
            definition.versions.map(async versionDefinition => {
                const manifest = await this.loadManifest(versionDefinition.packageRelativePath)
                return this.buildPluginVersion(versionDefinition, manifest, baseUrl)
            })
        )

        const latestVersion = versions[0]
        if (!latestVersion) {
            throw new NotFoundException(`插件 ${definition.pluginId} 没有可用版本`)
        }

        const latestManifest = await this.loadManifest(definition.versions[0].packageRelativePath)

        return {
            id: latestManifest.id,
            pluginId: latestManifest.id,
            name: latestManifest.name,
            description: latestManifest.description,
            icon: latestManifest.icon,
            author: definition.author,
            category: definition.category,
            tags: latestManifest.keywords || [],
            downloadCount: definition.downloadCount,
            rating: definition.rating,
            ratingCount: definition.ratingCount,
            status: definition.status,
            isOfficial: definition.isOfficial,
            latestVersion,
            versions,
            homepage: latestManifest.homepage,
            installCount: definition.installCount,
            createdAt: definition.createdAt,
            updatedAt: definition.updatedAt,
        }
    }

    private buildPluginVersion(
        versionDefinition: RegistryPluginVersionDefinition,
        manifest: PluginManifest,
        baseUrl: string
    ): PublicPluginVersion {
        const paramsFor = (file: string) => {
            const params = new URLSearchParams({
                pluginId: manifest.id,
                version: versionDefinition.version,
                file,
            })

            return `${baseUrl}/assets?${params.toString()}`
        }

        return {
            id: `${manifest.id}@${versionDefinition.version}`,
            version: versionDefinition.version,
            permissions: manifest.permissions || [],
            nodes: manifest.nodes || [],
            manifestUrl: paramsFor('plugin.json'),
            executorUrl: paramsFor('dist/executor.umd.js'),
            status: versionDefinition.status,
            changelog: versionDefinition.changelog,
            publishedAt: versionDefinition.publishedAt,
            createdAt: versionDefinition.createdAt,
        }
    }

    private async loadManifest(packageRelativePath: string): Promise<PluginManifest> {
        const manifestPath = path.join(this.getPluginRoot(packageRelativePath), 'plugin.json')
        const content = await readFile(manifestPath, 'utf8')
        return JSON.parse(content) as PluginManifest
    }

    private getPluginDefinition(registryPlugins: RegistryPluginDefinition[], pluginId: string): RegistryPluginDefinition {
        const definition = registryPlugins.find(item => item.pluginId === pluginId)
        if (!definition) {
            throw new NotFoundException(`未找到插件: ${pluginId}`)
        }

        return definition
    }

    private getPluginRoot(packageRelativePath: string): string {
        return path.join(this.workspaceRoot, packageRelativePath)
    }

    private async ensureRegistryLoaded(): Promise<RegistryPluginDefinition[]> {
        const content = await readFile(this.registryFilePath, 'utf8')
        const parsed = JSON.parse(content) as RegistryFileDefinition
        return Array.isArray(parsed.plugins) ? parsed.plugins.map(item => this.normalizeRegistryPlugin(item)) : []
    }

    private normalizeRegistryPlugin(value: RawRegistryPluginDefinition): RegistryPluginDefinition {
        const packageRelativePath = value.packageRelativePath?.trim()
        const pluginId = value.pluginId?.trim()

        if (!packageRelativePath || !pluginId) {
            throw new Error('插件注册表格式无效，缺少 pluginId 或 packageRelativePath')
        }

        const versions = Array.isArray(value.versions)
            ? value.versions
                  .map(version => this.normalizeRegistryPluginVersion(packageRelativePath, version))
                  .sort((left, right) => Date.parse(right.publishedAt || right.createdAt) - Date.parse(left.publishedAt || left.createdAt))
            : []

        if (versions.length === 0) {
            throw new Error(`插件注册表格式无效，插件 ${pluginId} 缺少 versions`)
        }

        return {
            pluginId,
            packageRelativePath,
            category: value.category || 'UTILITY',
            status: value.status || 'PUBLISHED',
            isOfficial: value.isOfficial !== false,
            downloadCount: Number.isFinite(value.downloadCount) ? (value.downloadCount ?? 0) : 0,
            installCount: Number.isFinite(value.installCount) ? (value.installCount ?? 0) : 0,
            rating: Number.isFinite(value.rating) ? (value.rating ?? 0) : 0,
            ratingCount: Number.isFinite(value.ratingCount) ? (value.ratingCount ?? 0) : 0,
            author: {
                id: value.author?.id || 'unknown-author',
                name: value.author?.name || '未知作者',
            },
            createdAt: value.createdAt || DEFAULT_PUBLISHED_AT,
            updatedAt: value.updatedAt || value.createdAt || DEFAULT_PUBLISHED_AT,
            versions,
        }
    }

    private normalizeRegistryPluginVersion(
        defaultPackageRelativePath: string,
        value: RawRegistryPluginVersionDefinition
    ): RegistryPluginVersionDefinition {
        const version = value.version?.trim()
        if (!version) {
            throw new Error('插件注册表格式无效，存在缺少 version 的版本定义')
        }

        return {
            version,
            status: value.status || 'APPROVED',
            changelog: value.changelog || '',
            publishedAt: value.publishedAt || value.createdAt || DEFAULT_PUBLISHED_AT,
            createdAt: value.createdAt || DEFAULT_PUBLISHED_AT,
            packageRelativePath: value.packageRelativePath?.trim() || defaultPackageRelativePath,
        }
    }

    private resolveWorkspaceRoot(): string {
        const candidates = [process.cwd(), __dirname, path.resolve(__dirname, '../../../../../')]

        for (const candidate of candidates) {
            const resolved = this.findWorkspaceRoot(candidate)
            if (resolved) {
                return resolved
            }
        }

        throw new Error('未找到工作区根目录，无法加载插件包')
    }

    private findWorkspaceRoot(startPath: string): string | null {
        let currentPath = path.resolve(startPath)

        while (true) {
            const workspaceFile = path.join(currentPath, 'pnpm-workspace.yaml')
            if (existsSync(workspaceFile)) {
                return currentPath
            }

            const parentPath = path.dirname(currentPath)
            if (parentPath === currentPath) {
                return null
            }

            currentPath = parentPath
        }
    }

    private getContentType(file: string): string {
        if (file.endsWith('.json')) {
            return 'application/json; charset=utf-8'
        }

        if (file.endsWith('.js')) {
            return 'application/javascript; charset=utf-8'
        }

        if (file.endsWith('.md')) {
            return 'text/markdown; charset=utf-8'
        }

        return 'application/octet-stream'
    }
}
