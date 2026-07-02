/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { z } from 'zod'

import type { Prisma } from '@/app/generated/prisma/client'
import { PluginCategory, PluginStatus, PluginVersionStatus } from '@/app/generated/prisma/enums'
import { prisma } from '@/lib/prisma'
import { getPluginMarketBaseUrl } from '@/lib/services/plugin-market-registry'
import { encodePluginId } from '@/lib/utils/plugin-id'

const PLUGIN_CATEGORY_VALUES = Object.values(PluginCategory) as [PluginCategory, ...PluginCategory[]]
const PLUGIN_STATUS_VALUES = Object.values(PluginStatus) as [PluginStatus, ...PluginStatus[]]
const PLUGIN_VERSION_STATUS_VALUES = Object.values(PluginVersionStatus) as [PluginVersionStatus, ...PluginVersionStatus[]]
const DEFAULT_SYNC_TTL_MS = 10 * 60 * 1000
const DEFAULT_SYNC_PAGE_SIZE = 100
interface DbPluginVersionLike {
    id: string
    version: string
    permissions: string[]
    nodes: unknown
    manifestUrl: string
    executorUrl: string
    componentsUrl: string | null
    changelog: string | null
    status: PluginVersionStatus
    publishedAt: Date | null
    createdAt: Date
}

interface DbPluginLike {
    pluginId: string
    name: string
    description: string
    icon: string | null
    category: PluginCategory
    tags: string[]
    downloadCount: number
    rating: number | null
    ratingCount: number
    status: PluginStatus
    isOfficial: boolean
    homepage?: string | null
    repository?: string | null
    createdAt: Date
    updatedAt: Date
    author?: {
        id: string
        name: string | null
        avatar: string | null
    } | null
    versions?: DbPluginVersionLike[]
    _count?: {
        installations: number
    }
}

interface RegistrySyncState {
    catalogSyncedAt?: number
    catalogSyncPromise?: Promise<void>
    pluginSyncedAt: Map<string, number>
    pluginSyncPromises: Map<string, Promise<void>>
}

interface RegistrySource {
    listPlugins(): Promise<RemoteRegistryPlugin[]>
    getPluginDetail(pluginId: string): Promise<RemoteRegistryPlugin>
}

interface RemoteRegistryPluginVersion {
    version: string
    permissions: string[]
    nodes: unknown[]
    manifestUrl: string
    executorUrl: string
    componentsUrl?: string | null
    status: PluginVersionStatus
    changelog?: string | null
    publishedAt?: string | null
    createdAt?: string
}

interface RemoteRegistryPlugin {
    pluginId: string
    name: string
    description: string
    icon?: string | null
    category: PluginCategory
    tags: string[]
    downloadCount: number
    rating?: number | null
    ratingCount: number
    installCount: number
    status: PluginStatus
    isOfficial: boolean
    homepage?: string | null
    repository?: string | null
    author?: {
        id?: string
        name?: string
        avatar?: string | null
    } | null
    latestVersion?: RemoteRegistryPluginVersion | null
    versions?: RemoteRegistryPluginVersion[]
    createdAt?: string
    updatedAt?: string
}

export interface PublicPluginVersion {
    id: string
    version: string
    permissions: string[]
    nodes: unknown[]
    manifestUrl: string
    executorUrl: string
    componentsUrl?: string
    status: PluginVersionStatus
    changelog?: string
    publishedAt?: string
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
        name?: string
        avatar?: string
    } | null
    category: PluginCategory
    tags: string[]
    downloadCount: number
    rating?: number
    ratingCount: number
    status: PluginStatus
    isOfficial: boolean
    latestVersion?: PublicPluginVersion
    versions?: PublicPluginVersion[]
    homepage?: string
    repository?: string
    installCount: number
    createdAt: string
    updatedAt: string
}

const remotePluginVersionSchema = z.object({
    version: z.string().min(1),
    permissions: z.array(z.string()).default([]),
    nodes: z.array(z.unknown()).default([]),
    manifestUrl: z.string().url(),
    executorUrl: z.string().url(),
    componentsUrl: z.string().url().nullable().optional(),
    status: z.enum(PLUGIN_VERSION_STATUS_VALUES).default(PluginVersionStatus.APPROVED),
    changelog: z.string().nullable().optional(),
    publishedAt: z.string().nullable().optional(),
    createdAt: z.string().optional(),
})

const remotePluginSchema = z.object({
    pluginId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(''),
    icon: z.string().nullable().optional(),
    category: z.enum(PLUGIN_CATEGORY_VALUES).default(PluginCategory.INTEGRATION),
    tags: z.array(z.string()).default([]),
    downloadCount: z.number().int().nonnegative().default(0),
    rating: z.number().nullable().optional(),
    ratingCount: z.number().int().nonnegative().default(0),
    installCount: z.number().int().nonnegative().default(0),
    status: z.enum(PLUGIN_STATUS_VALUES).default(PluginStatus.PUBLISHED),
    isOfficial: z.boolean().default(false),
    homepage: z.string().url().nullable().optional(),
    repository: z.string().url().nullable().optional(),
    author: z
        .object({
            id: z.string().optional(),
            name: z.string().optional(),
            avatar: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
    latestVersion: remotePluginVersionSchema.nullable().optional(),
    versions: z.array(remotePluginVersionSchema).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
})

const globalForPluginRegistry = globalThis as unknown as {
    pluginRegistrySyncState?: RegistrySyncState
}

function getRegistrySyncState(): RegistrySyncState {
    if (!globalForPluginRegistry.pluginRegistrySyncState) {
        globalForPluginRegistry.pluginRegistrySyncState = {
            pluginSyncedAt: new Map(),
            pluginSyncPromises: new Map(),
        }
    }

    return globalForPluginRegistry.pluginRegistrySyncState
}

function getRegistryBaseUrl(origin?: string): string | null {
    void origin
    return getPluginMarketBaseUrl()
}

function getSyncTtlMs(): number {
    const raw = process.env.PLUGIN_REGISTRY_SYNC_TTL_MS
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SYNC_TTL_MS
}

function unwrapRegistryPayload(payload: unknown): unknown {
    if (!payload || typeof payload !== 'object') {
        return payload
    }

    if ('success' in payload && (payload as { success?: boolean }).success === true && 'data' in payload) {
        return (payload as { data: unknown }).data
    }

    return payload
}

function parseRemotePluginList(payload: unknown): { items: RemoteRegistryPlugin[]; totalPages: number } {
    const unwrapped = unwrapRegistryPayload(payload)

    if (Array.isArray(unwrapped)) {
        return {
            items: z.array(remotePluginSchema).parse(unwrapped),
            totalPages: 1,
        }
    }

    if (!unwrapped || typeof unwrapped !== 'object' || !('items' in unwrapped)) {
        throw new Error('远程插件列表响应格式无效')
    }

    const items = z.array(remotePluginSchema).parse((unwrapped as { items: unknown }).items)
    const meta = (unwrapped as { meta?: { totalPages?: unknown } }).meta
    const totalPages = typeof meta?.totalPages === 'number' && meta.totalPages > 0 ? meta.totalPages : 1

    return { items, totalPages }
}

function parseRemotePlugin(payload: unknown): RemoteRegistryPlugin {
    return remotePluginSchema.parse(unwrapRegistryPayload(payload))
}

function getVersionTimestamp(version: { publishedAt?: string | null; createdAt?: string }): number {
    const timestamp = Date.parse(version.publishedAt || version.createdAt || '')
    return Number.isNaN(timestamp) ? 0 : timestamp
}

function sortRemoteVersions(versions: RemoteRegistryPluginVersion[]): RemoteRegistryPluginVersion[] {
    return [...versions].sort((left, right) => getVersionTimestamp(right) - getVersionTimestamp(left))
}

function getPublishedRemoteVersions(plugin: RemoteRegistryPlugin): RemoteRegistryPluginVersion[] {
    const versions = plugin.versions?.length ? plugin.versions : plugin.latestVersion ? [plugin.latestVersion] : []

    return sortRemoteVersions(versions.filter(version => version.status === PluginVersionStatus.APPROVED))
}

function normalizeNodes(nodes: unknown): unknown[] {
    return Array.isArray(nodes) ? nodes : []
}

function serializeRemotePluginVersion(version: RemoteRegistryPluginVersion): PublicPluginVersion {
    return {
        id: `${version.version}-${version.createdAt || version.publishedAt || 'registry'}`,
        version: version.version,
        permissions: version.permissions,
        nodes: normalizeNodes(version.nodes),
        manifestUrl: version.manifestUrl,
        executorUrl: version.executorUrl,
        componentsUrl: version.componentsUrl || undefined,
        status: version.status,
        changelog: version.changelog || undefined,
        publishedAt: version.publishedAt || undefined,
        createdAt: version.createdAt || version.publishedAt || new Date().toISOString(),
    }
}

function normalizeRemoteAuthor(plugin: RemoteRegistryPlugin): PublicPluginInfo['author'] {
    if (!plugin.author) {
        return null
    }

    return {
        id: plugin.author.id || plugin.pluginId,
        name: plugin.author.name || undefined,
        avatar: plugin.author.avatar || undefined,
    }
}

export function serializeRegistryPlugin(plugin: RemoteRegistryPlugin): PublicPluginInfo {
    const versions = getPublishedRemoteVersions(plugin).map(serializeRemotePluginVersion)
    const latestVersion = versions[0]
    const fallbackTimestamp = latestVersion?.createdAt || new Date().toISOString()

    return {
        id: plugin.pluginId,
        pluginId: plugin.pluginId,
        name: plugin.name,
        description: plugin.description,
        icon: plugin.icon || undefined,
        author: normalizeRemoteAuthor(plugin),
        category: plugin.category,
        tags: plugin.tags,
        downloadCount: plugin.downloadCount,
        rating: plugin.rating ?? undefined,
        ratingCount: plugin.ratingCount,
        status: plugin.status,
        isOfficial: plugin.isOfficial,
        latestVersion,
        versions: versions.length > 0 ? versions : undefined,
        homepage: plugin.homepage || undefined,
        repository: plugin.repository || undefined,
        installCount: plugin.installCount,
        createdAt: plugin.createdAt || fallbackTimestamp,
        updatedAt: plugin.updatedAt || plugin.createdAt || fallbackTimestamp,
    }
}

class OfficialRegistrySource implements RegistrySource {
    constructor(private readonly baseUrl: string) {}

    async listPlugins(): Promise<RemoteRegistryPlugin[]> {
        const items: RemoteRegistryPlugin[] = []
        let currentPage = 1
        let totalPages = 1

        do {
            const url = new URL(`${this.baseUrl}/v1/plugins`)
            url.searchParams.set('page', currentPage.toString())
            url.searchParams.set('pageSize', DEFAULT_SYNC_PAGE_SIZE.toString())

            const payload = await this.fetchJson(url.toString())
            const pageData = parseRemotePluginList(payload)

            items.push(...pageData.items)
            totalPages = pageData.totalPages
            currentPage += 1
        } while (currentPage <= totalPages)

        return items
    }

    async getPluginDetail(pluginId: string): Promise<RemoteRegistryPlugin> {
        const url = `${this.baseUrl}/v1/plugins/${encodePluginId(pluginId)}`
        const payload = await this.fetchJson(url)
        return parseRemotePlugin(payload)
    }

    private async fetchJson(url: string): Promise<unknown> {
        const response = await fetch(url, {
            headers: {
                Accept: 'application/json',
            },
            cache: 'no-store',
        })

        if (!response.ok) {
            throw new Error(`远程插件市场请求失败: ${response.status} ${response.statusText}`)
        }

        return response.json()
    }
}

function getRegistrySource(origin?: string): RegistrySource | null {
    const baseUrl = getRegistryBaseUrl(origin)
    return baseUrl ? new OfficialRegistrySource(baseUrl) : null
}

export async function fetchRegistryPluginCatalog(options: { origin?: string } = {}): Promise<RemoteRegistryPlugin[]> {
    const source = getRegistrySource(options.origin)
    if (!source) {
        return []
    }

    const plugins = await source.listPlugins()
    return plugins.filter(plugin => plugin.status === PluginStatus.PUBLISHED)
}

export async function fetchRegistryPluginDetail(pluginId: string, options: { origin?: string } = {}): Promise<RemoteRegistryPlugin | null> {
    const source = getRegistrySource(options.origin)
    if (!source) {
        return null
    }

    const plugin = await source.getPluginDetail(pluginId)
    if (plugin.status !== PluginStatus.PUBLISHED) {
        return null
    }

    return plugin
}

async function persistRemotePlugin(plugin: RemoteRegistryPlugin): Promise<void> {
    const versions = getPublishedRemoteVersions(plugin)
    const latestVersion = versions[0]?.version || plugin.latestVersion?.version || null

    await prisma.$transaction(async tx => {
        const localPlugin = await tx.plugin.upsert({
            where: {
                pluginId: plugin.pluginId,
            },
            create: {
                pluginId: plugin.pluginId,
                name: plugin.name,
                description: plugin.description,
                icon: plugin.icon || undefined,
                category: plugin.category,
                tags: plugin.tags,
                downloadCount: plugin.downloadCount,
                rating: plugin.rating ?? undefined,
                ratingCount: plugin.ratingCount,
                status: plugin.status,
                isOfficial: plugin.isOfficial,
                homepage: plugin.homepage || undefined,
                repository: plugin.repository || undefined,
                latestVersion,
            },
            update: {
                name: plugin.name,
                description: plugin.description,
                icon: plugin.icon || undefined,
                category: plugin.category,
                tags: plugin.tags,
                downloadCount: plugin.downloadCount,
                rating: plugin.rating ?? undefined,
                ratingCount: plugin.ratingCount,
                status: plugin.status,
                isOfficial: plugin.isOfficial,
                homepage: plugin.homepage || null,
                repository: plugin.repository || null,
                authorId: null,
                latestVersion,
            },
        })

        for (const version of versions) {
            await tx.pluginVersion.upsert({
                where: {
                    pluginId_version: {
                        pluginId: localPlugin.id,
                        version: version.version,
                    },
                },
                create: {
                    pluginId: localPlugin.id,
                    version: version.version,
                    permissions: version.permissions,
                    nodes: version.nodes as Prisma.InputJsonValue,
                    manifestUrl: version.manifestUrl,
                    executorUrl: version.executorUrl,
                    componentsUrl: version.componentsUrl || undefined,
                    changelog: version.changelog || undefined,
                    status: version.status,
                    publishedAt: version.publishedAt ? new Date(version.publishedAt) : undefined,
                },
                update: {
                    permissions: version.permissions,
                    nodes: version.nodes as Prisma.InputJsonValue,
                    manifestUrl: version.manifestUrl,
                    executorUrl: version.executorUrl,
                    componentsUrl: version.componentsUrl || null,
                    changelog: version.changelog || null,
                    status: version.status,
                    publishedAt: version.publishedAt ? new Date(version.publishedAt) : null,
                },
            })
        }
    })
}

export function isPluginRegistryConfigured(): boolean {
    return Boolean(getRegistryBaseUrl())
}

export async function syncPluginCatalogIfNeeded(options: { force?: boolean; origin?: string } = {}): Promise<void> {
    const source = getRegistrySource(options.origin)
    if (!source) {
        return
    }

    const state = getRegistrySyncState()
    const ttlMs = getSyncTtlMs()
    const now = Date.now()

    if (!options.force && state.catalogSyncedAt && now - state.catalogSyncedAt < ttlMs) {
        return
    }

    if (state.catalogSyncPromise) {
        await state.catalogSyncPromise
        return
    }

    state.catalogSyncPromise = (async () => {
        const plugins = await source.listPlugins()

        for (const plugin of plugins.filter(item => item.status === PluginStatus.PUBLISHED)) {
            await persistRemotePlugin(plugin)
        }

        state.catalogSyncedAt = Date.now()
    })()

    try {
        await state.catalogSyncPromise
    } finally {
        state.catalogSyncPromise = undefined
    }
}

export async function syncPluginDetailIfNeeded(pluginId: string, options: { force?: boolean; origin?: string } = {}): Promise<void> {
    const source = getRegistrySource(options.origin)
    if (!source) {
        return
    }

    const state = getRegistrySyncState()
    const ttlMs = getSyncTtlMs()
    const now = Date.now()
    const lastSyncedAt = state.pluginSyncedAt.get(pluginId)

    if (!options.force && lastSyncedAt && now - lastSyncedAt < ttlMs) {
        return
    }

    const pendingPromise = state.pluginSyncPromises.get(pluginId)
    if (pendingPromise) {
        await pendingPromise
        return
    }

    const syncPromise = (async () => {
        const plugin = await source.getPluginDetail(pluginId)
        if (plugin.status !== PluginStatus.PUBLISHED) {
            return
        }

        await persistRemotePlugin(plugin)
        state.pluginSyncedAt.set(pluginId, Date.now())
    })()

    state.pluginSyncPromises.set(pluginId, syncPromise)

    try {
        await syncPromise
    } finally {
        state.pluginSyncPromises.delete(pluginId)
    }
}

export function serializePluginVersion(version: DbPluginVersionLike): PublicPluginVersion {
    return {
        id: version.id,
        version: version.version,
        permissions: version.permissions,
        nodes: normalizeNodes(version.nodes),
        manifestUrl: version.manifestUrl,
        executorUrl: version.executorUrl,
        componentsUrl: version.componentsUrl || undefined,
        status: version.status,
        changelog: version.changelog || undefined,
        publishedAt: version.publishedAt?.toISOString(),
        createdAt: version.createdAt.toISOString(),
    }
}

export function serializePlugin(plugin: DbPluginLike): PublicPluginInfo {
    const versions = plugin.versions?.map(serializePluginVersion) || []
    const latestVersion = versions[0]

    return {
        id: plugin.pluginId,
        pluginId: plugin.pluginId,
        name: plugin.name,
        description: plugin.description,
        icon: plugin.icon || undefined,
        author: plugin.author
            ? {
                  id: plugin.author.id,
                  name: plugin.author.name || undefined,
                  avatar: plugin.author.avatar || undefined,
              }
            : null,
        category: plugin.category,
        tags: plugin.tags,
        downloadCount: plugin.downloadCount,
        rating: plugin.rating ?? undefined,
        ratingCount: plugin.ratingCount,
        status: plugin.status,
        isOfficial: plugin.isOfficial,
        latestVersion,
        versions: versions.length > 0 ? versions : undefined,
        homepage: plugin.homepage || undefined,
        repository: plugin.repository || undefined,
        installCount: plugin._count?.installations ?? 0,
        createdAt: plugin.createdAt.toISOString(),
        updatedAt: plugin.updatedAt.toISOString(),
    }
}
