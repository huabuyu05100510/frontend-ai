/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { ArrowLeftIcon, BrainIcon, DatabaseIcon, DownloadIcon, ImageIcon, MailIcon, PlugIcon, TrashIcon, WrenchIcon } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import type { InstalledPlugin, PluginCategory } from '@/components/plugin/market/types'
import { PluginIcon } from '@/components/plugin/plugin-icon'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { buildPluginApiPath, buildPluginDetailPath } from '@/lib/utils/plugin-id'

/**
 * 分类图标映射
 */
const categoryIcons: Record<PluginCategory, React.ElementType> = {
    AI: BrainIcon,
    INTEGRATION: PlugIcon,
    DATA: DatabaseIcon,
    MEDIA: ImageIcon,
    UTILITY: WrenchIcon,
    COMMUNICATION: MailIcon,
}

/**
 * 分类颜色映射
 */
const categoryColors: Record<PluginCategory, string> = {
    AI: '#8B5CF6',
    INTEGRATION: '#3B82F6',
    DATA: '#10B981',
    MEDIA: '#F59E0B',
    UTILITY: '#6B7280',
    COMMUNICATION: '#EF4444',
}

export default function InstalledPluginsPage() {
    const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([])
    const [loading, setLoading] = useState(true)

    // 加载已安装插件
    const loadInstalledPlugins = useCallback(async () => {
        setLoading(true)
        try {
            const response = await fetch('/api/plugins/installed')
            if (!response.ok) throw new Error('加载失败')

            const data = await response.json()
            if (data.success) {
                setInstalledPlugins(data.data.items || [])
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '加载已安装插件失败')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        loadInstalledPlugins()
    }, [loadInstalledPlugins])

    // 卸载插件
    const handleUninstall = async (pluginId: string) => {
        try {
            const response = await fetch(buildPluginApiPath(pluginId, '/uninstall'), {
                method: 'POST',
            })

            if (!response.ok) {
                const data = await response.json()
                throw new Error(data.message || '卸载失败')
            }

            toast.success('插件已卸载')
            loadInstalledPlugins()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '卸载失败')
        }
    }

    // 切换启用状态
    const handleToggleEnabled = async (installation: InstalledPlugin) => {
        // TODO: 实现启用/禁用功能
        toast.info('此功能正在开发中')
    }

    return (
        <div className="px-6 lg:px-12 py-6">
            {/* 返回按钮 */}
            <Link href="/plugins" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
                <ArrowLeftIcon size={16} />
                返回插件市场
            </Link>

            {/* 页面头部 */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                        <DownloadIcon size={24} className="text-blue-600" />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold">已安装插件</h1>
                        <p className="text-sm text-muted-foreground">管理您已安装的插件</p>
                    </div>
                </div>
            </div>

            {/* 插件列表 */}
            {loading ? (
                <div className="space-y-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Card key={i}>
                            <CardContent className="pt-6">
                                <div className="h-20 bg-muted rounded animate-pulse" />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : installedPlugins.length === 0 ? (
                <Card>
                    <CardContent className="pt-6">
                        <div className="text-center py-12">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                                <PlugIcon size={24} className="text-muted-foreground" />
                            </div>
                            <h3 className="font-medium mb-1">还没有安装任何插件</h3>
                            <p className="text-sm text-muted-foreground mb-4">前往插件市场发现并安装插件</p>
                            <Link href="/plugins">
                                <Button>浏览插件市场</Button>
                            </Link>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-4">
                    {installedPlugins.map(installation => {
                        const plugin = installation.plugin
                        const CategoryIcon = categoryIcons[plugin.category] || PlugIcon
                        const categoryColor = categoryColors[plugin.category] || '#6B7280'

                        return (
                            <Card key={installation.id}>
                                <CardContent className="pt-6">
                                    <div className="flex items-start gap-4">
                                        {/* 图标 */}
                                        <div
                                            className="w-14 h-14 rounded-lg flex items-center justify-center shrink-0"
                                            style={{ backgroundColor: `${categoryColor}20` }}
                                        >
                                            <PluginIcon
                                                icon={plugin.icon}
                                                alt={plugin.name}
                                                size={28}
                                                className="rounded"
                                                color={categoryColor}
                                                fallback={CategoryIcon}
                                            />
                                        </div>

                                        {/* 信息 */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Link
                                                    href={buildPluginDetailPath(plugin.pluginId)}
                                                    className="font-medium hover:text-primary transition-colors"
                                                >
                                                    {plugin.name}
                                                </Link>
                                                {plugin.isOfficial && (
                                                    <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-600">
                                                        官方
                                                    </Badge>
                                                )}
                                                <Badge variant="outline" className="text-xs">
                                                    v{installation.version.version}
                                                </Badge>
                                                {installation.hasUpdate && (
                                                    <Badge variant="outline" className="text-xs text-amber-600 border-amber-200">
                                                        有更新
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-sm text-muted-foreground line-clamp-1">{plugin.description}</p>

                                            {/* 节点数量 */}
                                            {installation.version.nodes && installation.version.nodes.length > 0 && (
                                                <p className="text-xs text-muted-foreground mt-2">
                                                    提供 {installation.version.nodes.length} 个节点类型
                                                </p>
                                            )}
                                        </div>

                                        {/* 操作 */}
                                        <div className="flex items-center gap-3 shrink-0">
                                            {/* 启用/禁用开关 */}
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-muted-foreground">
                                                    {installation.isEnabled ? '已启用' : '已禁用'}
                                                </span>
                                                <Switch
                                                    checked={installation.isEnabled}
                                                    onCheckedChange={() => handleToggleEnabled(installation)}
                                                />
                                            </div>

                                            {/* 卸载按钮 */}
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="text-muted-foreground hover:text-red-600"
                                                    >
                                                        <TrashIcon size={18} />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>确认卸载</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            卸载 "{plugin.name}" 后，使用此插件的工作流可能无法正常运行。确定要卸载吗？
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>取消</AlertDialogCancel>
                                                        <AlertDialogAction
                                                            onClick={() => handleUninstall(plugin.pluginId)}
                                                            className="bg-red-600 hover:bg-red-700"
                                                        >
                                                            确认卸载
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
