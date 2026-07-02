/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { DownloadIcon, PackageIcon } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { PluginFilters } from '@/components/plugin/market/plugin-filters'
import { FeaturedPlugins, PluginList } from '@/components/plugin/market/plugin-list'
import type { PluginFilters as Filters, PluginInfo } from '@/components/plugin/market/types'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

function dedupePluginsById(items: PluginInfo[]): PluginInfo[] {
    const pluginMap = new Map<string, PluginInfo>()

    items.forEach(item => {
        if (!pluginMap.has(item.pluginId)) {
            pluginMap.set(item.pluginId, item)
        }
    })

    return Array.from(pluginMap.values())
}

export default function PluginsPage() {
    const [filters, setFilters] = useState<Filters>({})
    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [featuredPlugins, setFeaturedPlugins] = useState<PluginInfo[]>([])
    const [installedPluginIds, setInstalledPluginIds] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(true)
    const [activeTab, setActiveTab] = useState<'all' | 'installed'>('all')

    // 热门标签
    const popularTags = ['AI', 'API', '数据处理', '自动化', '通知', '文档']

    // 加载插件列表
    const loadPlugins = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            if (filters.category) params.append('category', filters.category)
            if (filters.search) params.append('search', filters.search)
            if (filters.tag) params.append('tag', filters.tag)
            if (filters.isOfficial) params.append('isOfficial', 'true')

            const response = await fetch(`/api/plugins?${params.toString()}`)
            if (!response.ok) throw new Error('加载失败')

            const data = await response.json()
            if (data.success) {
                const dedupedPlugins = dedupePluginsById(data.data.items || [])
                setPlugins(dedupedPlugins)
                // 设置精选插件（官方出品）
                setFeaturedPlugins(dedupedPlugins.filter((p: PluginInfo) => p.isOfficial).slice(0, 4))
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '加载插件列表失败')
        } finally {
            setLoading(false)
        }
    }, [filters])

    // 加载已安装插件
    const loadInstalledPlugins = useCallback(async () => {
        try {
            const response = await fetch('/api/plugins/installed')
            if (!response.ok) throw new Error('加载失败')

            const data = await response.json()
            if (data.success) {
                const ids = new Set<string>(data.data.items?.map((item: { pluginId: string }) => item.pluginId) || [])
                setInstalledPluginIds(ids)
            }
        } catch {
            // 静默处理
        }
    }, [])

    useEffect(() => {
        loadPlugins()
        loadInstalledPlugins()
    }, [loadPlugins, loadInstalledPlugins])

    // 获取已安装的插件列表
    const installedPlugins = plugins.filter(p => installedPluginIds.has(p.pluginId))
    const shouldShowFeatured = !filters.category && !filters.search && !filters.tag && !filters.isOfficial

    const visiblePlugins = useMemo(() => {
        if (!shouldShowFeatured) {
            return plugins
        }

        const featuredPluginIds = new Set(featuredPlugins.map(plugin => plugin.pluginId))
        return plugins.filter(plugin => !featuredPluginIds.has(plugin.pluginId))
    }, [featuredPlugins, plugins, shouldShowFeatured])

    return (
        <div className="px-6 lg:px-12 py-6">
            {/* 页面头部 */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                        <PackageIcon size={24} className="text-emerald-600" />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold">插件市场</h1>
                        <p className="text-sm text-muted-foreground">发现并安装插件，扩展工作流能力</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Link href="/plugins/installed">
                        <Button variant="outline" size="sm">
                            <DownloadIcon size={16} className="mr-1" />
                            已安装 ({installedPluginIds.size})
                        </Button>
                    </Link>
                </div>
            </div>

            <div className="flex gap-6">
                {/* 左侧筛选器 */}
                <aside className="w-64 shrink-0 hidden lg:block">
                    <div className="sticky top-6">
                        <PluginFilters filters={filters} onChange={setFilters} popularTags={popularTags} />
                    </div>
                </aside>

                {/* 右侧内容 */}
                <main className="flex-1 min-w-0">
                    {/* 标签页切换 */}
                    <Tabs value={activeTab} onValueChange={v => setActiveTab(v as 'all' | 'installed')} className="mb-6">
                        <TabsList>
                            <TabsTrigger value="all">全部插件 ({plugins.length})</TabsTrigger>
                            <TabsTrigger value="installed">已安装 ({installedPluginIds.size})</TabsTrigger>
                        </TabsList>
                    </Tabs>

                    {activeTab === 'all' ? (
                        <>
                            {/* 精选插件（无筛选时显示） */}
                            {shouldShowFeatured && <FeaturedPlugins plugins={featuredPlugins} loading={loading} />}

                            {/* 插件列表 */}
                            {(loading || plugins.length === 0 || visiblePlugins.length > 0 || !shouldShowFeatured) && (
                                <PluginList
                                    plugins={visiblePlugins}
                                    loading={loading}
                                    installedPluginIds={installedPluginIds}
                                    emptyMessage={filters.search ? '没有找到匹配的插件' : '暂无插件'}
                                />
                            )}
                        </>
                    ) : (
                        <PluginList
                            plugins={installedPlugins}
                            loading={loading}
                            installedPluginIds={installedPluginIds}
                            emptyMessage="还没有安装任何插件"
                        />
                    )}
                </main>
            </div>
        </div>
    )
}
