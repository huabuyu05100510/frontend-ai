/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import {
    ArrowLeftIcon,
    BrainIcon,
    CalendarIcon,
    DatabaseIcon,
    DownloadIcon,
    ExternalLinkIcon,
    ImageIcon,
    MailIcon,
    PlugIcon,
    TagIcon,
    UserIcon,
    WrenchIcon,
} from 'lucide-react'
import Link from 'next/link'

import { PluginIcon } from '@/components/plugin/plugin-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

import { InstallButton } from '../install-button'
import type { PluginCategory, PluginInfo } from '../types'
import { PLUGIN_CATEGORIES } from '../types'
import { Permissions } from './permissions'
import { VersionsList } from './versions'

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

/**
 * 格式化日期
 */
function formatDate(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    })
}

/**
 * 格式化下载数
 */
function formatDownloadCount(count: number): string {
    if (count >= 10000) {
        return `${(count / 10000).toFixed(1)} 万`
    }
    if (count >= 1000) {
        return `${(count / 1000).toFixed(1)} 千`
    }
    return count.toString()
}

interface PluginDetailProps {
    plugin: PluginInfo
    isInstalled: boolean
    installedVersion?: string
    onInstalled?: () => void
    onUninstalled?: () => void
}

/**
 * PluginDetail - 插件详情组件
 */
export function PluginDetail({ plugin, isInstalled, installedVersion, onInstalled, onUninstalled }: PluginDetailProps) {
    const CategoryIcon = categoryIcons[plugin.category] || PlugIcon
    const categoryColor = categoryColors[plugin.category] || '#6B7280'
    const categoryInfo = PLUGIN_CATEGORIES.find(c => c.value === plugin.category)

    return (
        <div className="max-w-5xl mx-auto">
            {/* 返回按钮 */}
            <Link href="/plugins" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
                <ArrowLeftIcon size={16} />
                返回插件市场
            </Link>

            {/* 头部信息 */}
            <div className="flex items-start gap-6 mb-8">
                {/* 图标 */}
                <div
                    className="w-20 h-20 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${categoryColor}20` }}
                >
                    <PluginIcon
                        icon={plugin.icon}
                        alt={plugin.name}
                        size={36}
                        className="rounded-lg"
                        color={categoryColor}
                        fallback={CategoryIcon}
                    />
                </div>

                {/* 基本信息 */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                        <h1 className="text-2xl font-bold">{plugin.name}</h1>
                        {plugin.isOfficial && (
                            <Badge variant="secondary" className="bg-blue-50 text-blue-600">
                                官方出品
                            </Badge>
                        )}
                    </div>

                    <p className="text-muted-foreground mb-3">{plugin.description}</p>

                    {/* 元信息 */}
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        {plugin.author && (
                            <div className="flex items-center gap-1">
                                <UserIcon size={14} />
                                <span>{plugin.author.name}</span>
                            </div>
                        )}
                        <div className="flex items-center gap-1">
                            <TagIcon size={14} />
                            <span>v{plugin.latestVersion?.version || '1.0.0'}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <DownloadIcon size={14} />
                            <span>{formatDownloadCount(plugin.downloadCount)} 次安装</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <CalendarIcon size={14} />
                            <span>更新于 {formatDate(plugin.updatedAt)}</span>
                        </div>
                    </div>
                </div>

                {/* 安装按钮 */}
                <div className="shrink-0">
                    <InstallButton
                        pluginId={plugin.pluginId}
                        version={plugin.latestVersion?.version || '1.0.0'}
                        isInstalled={isInstalled}
                        permissions={plugin.latestVersion?.permissions || []}
                        onInstalled={onInstalled}
                        onUninstalled={onUninstalled}
                        size="lg"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 左侧：详情 */}
                <div className="lg:col-span-2 space-y-6">
                    {/* 分类和标签 */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">分类与标签</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center gap-2 mb-4">
                                <Badge variant="outline" className="px-3 py-1" style={{ borderColor: categoryColor }}>
                                    <CategoryIcon size={14} className="mr-1" style={{ color: categoryColor }} />
                                    {categoryInfo?.label || plugin.category}
                                </Badge>
                            </div>
                            {plugin.tags.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {plugin.tags.map(tag => (
                                        <Badge key={tag} variant="secondary">
                                            {tag}
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* 节点列表 */}
                    {plugin.latestVersion?.nodes && plugin.latestVersion.nodes.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">提供的节点</CardTitle>
                                <CardDescription>此插件安装后将添加以下节点类型到您的工作流编辑器</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {plugin.latestVersion.nodes.map(node => (
                                        <div key={node.type} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                            <div
                                                className="w-10 h-10 rounded-lg flex items-center justify-center"
                                                style={{ backgroundColor: `${node.color}20` }}
                                            >
                                                <PlugIcon size={20} style={{ color: node.color }} />
                                            </div>
                                            <div>
                                                <p className="font-medium text-sm">{node.name}</p>
                                                <p className="text-xs text-muted-foreground">{node.description || node.type}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* 权限说明 */}
                    <Permissions permissions={plugin.latestVersion?.permissions || []} />
                </div>

                {/* 右侧：版本和信息 */}
                <div className="space-y-6">
                    {/* 版本历史 */}
                    {plugin.versions && plugin.versions.length > 0 && (
                        <VersionsList versions={plugin.versions} currentVersion={installedVersion} />
                    )}

                    {/* 插件信息 */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">插件信息</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">插件 ID</span>
                                <span className="font-mono text-xs">{plugin.pluginId}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">创建时间</span>
                                <span>{formatDate(plugin.createdAt)}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">最后更新</span>
                                <span>{formatDate(plugin.updatedAt)}</span>
                            </div>
                            {plugin.latestVersion?.manifestUrl && (
                                <>
                                    <Separator />
                                    <div className="flex justify-between items-center">
                                        <span className="text-muted-foreground">源码</span>
                                        <Button variant="ghost" size="sm" className="h-6 px-2" asChild>
                                            <a href={plugin.latestVersion.manifestUrl} target="_blank" rel="noopener noreferrer">
                                                查看 <ExternalLinkIcon size={12} className="ml-1" />
                                            </a>
                                        </Button>
                                    </div>
                                </>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}

/**
 * PluginDetailSkeleton - 插件详情骨架屏
 */
export function PluginDetailSkeleton() {
    return (
        <div className="max-w-5xl mx-auto">
            <div className="h-4 w-24 bg-muted rounded animate-pulse mb-6" />

            <div className="flex items-start gap-6 mb-8">
                <div className="w-20 h-20 rounded-xl bg-muted animate-pulse" />
                <div className="flex-1">
                    <div className="h-8 w-48 bg-muted rounded animate-pulse mb-2" />
                    <div className="h-4 w-full max-w-md bg-muted rounded animate-pulse mb-3" />
                    <div className="h-4 w-64 bg-muted rounded animate-pulse" />
                </div>
                <div className="w-24 h-10 bg-muted rounded animate-pulse" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <CardContent className="pt-6">
                            <div className="h-40 bg-muted rounded animate-pulse" />
                        </CardContent>
                    </Card>
                </div>
                <div className="space-y-6">
                    <Card>
                        <CardContent className="pt-6">
                            <div className="h-32 bg-muted rounded animate-pulse" />
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
