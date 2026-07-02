/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { PackageIcon, SearchIcon } from 'lucide-react'

import { PluginCard, PluginCardSkeleton } from './plugin-card'
import type { PluginInfo } from './types'

interface PluginListProps {
    plugins: PluginInfo[]
    loading?: boolean
    installedPluginIds?: Set<string>
    emptyMessage?: string
}

/**
 * PluginList - 插件列表组件
 */
export function PluginList({ plugins, loading, installedPluginIds = new Set(), emptyMessage = '没有找到插件' }: PluginListProps) {
    // 加载状态
    if (loading) {
        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                    <PluginCardSkeleton key={i} />
                ))}
            </div>
        )
    }

    // 空状态
    if (plugins.length === 0) {
        return (
            <div className="text-center py-16">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                    <SearchIcon size={24} className="text-muted-foreground" />
                </div>
                <h3 className="font-medium mb-1">{emptyMessage}</h3>
                <p className="text-sm text-muted-foreground">尝试调整搜索条件或查看其他分类</p>
            </div>
        )
    }

    // 插件列表
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {plugins.map(plugin => (
                <PluginCard key={plugin.id} plugin={plugin} isInstalled={installedPluginIds.has(plugin.pluginId)} />
            ))}
        </div>
    )
}

/**
 * FeaturedPlugins - 精选插件组件
 */
interface FeaturedPluginsProps {
    plugins: PluginInfo[]
    title?: string
    loading?: boolean
}

export function FeaturedPlugins({ plugins, title = '精选插件', loading }: FeaturedPluginsProps) {
    if (loading) {
        return (
            <section className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                    <PackageIcon size={20} className="text-primary" />
                    <h2 className="text-lg font-semibold">{title}</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <PluginCardSkeleton key={i} />
                    ))}
                </div>
            </section>
        )
    }

    if (plugins.length === 0) {
        return null
    }

    return (
        <section className="mb-8">
            <div className="flex items-center gap-2 mb-4">
                <PackageIcon size={20} className="text-primary" />
                <h2 className="text-lg font-semibold">{title}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {plugins.slice(0, 4).map(plugin => (
                    <PluginCard key={plugin.id} plugin={plugin} />
                ))}
            </div>
        </section>
    )
}

/**
 * CategorySection - 分类展示区块
 */
interface CategorySectionProps {
    title: string
    icon: React.ReactNode
    plugins: PluginInfo[]
    loading?: boolean
    installedPluginIds?: Set<string>
}

export function CategorySection({ title, icon, plugins, loading, installedPluginIds = new Set() }: CategorySectionProps) {
    if (loading) {
        return (
            <section className="mb-8">
                <div className="flex items-center gap-2 mb-4">
                    {icon}
                    <h2 className="text-lg font-semibold">{title}</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <PluginCardSkeleton key={i} />
                    ))}
                </div>
            </section>
        )
    }

    if (plugins.length === 0) {
        return null
    }

    return (
        <section className="mb-8">
            <div className="flex items-center gap-2 mb-4">
                {icon}
                <h2 className="text-lg font-semibold">{title}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {plugins.map(plugin => (
                    <PluginCard key={plugin.id} plugin={plugin} isInstalled={installedPluginIds.has(plugin.pluginId)} />
                ))}
            </div>
        </section>
    )
}
