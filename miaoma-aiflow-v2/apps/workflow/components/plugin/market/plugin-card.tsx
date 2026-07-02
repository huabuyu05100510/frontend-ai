/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { BrainIcon, CheckCircleIcon, DatabaseIcon, DownloadIcon, ImageIcon, MailIcon, PlugIcon, StarIcon, WrenchIcon } from 'lucide-react'
import Link from 'next/link'

import { PluginIcon } from '@/components/plugin/plugin-icon'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { buildPluginDetailPath } from '@/lib/utils/plugin-id'

import type { PluginCategory, PluginInfo } from './types'

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

interface PluginCardProps {
    plugin: PluginInfo
    isInstalled?: boolean
}

/**
 * 格式化下载数
 */
function formatDownloadCount(count: number): string {
    if (count >= 10000) {
        return `${(count / 10000).toFixed(1)}w`
    }
    if (count >= 1000) {
        return `${(count / 1000).toFixed(1)}k`
    }
    return count.toString()
}

/**
 * PluginCard - 插件卡片组件
 */
export function PluginCard({ plugin, isInstalled }: PluginCardProps) {
    const CategoryIcon = categoryIcons[plugin.category] || PlugIcon
    const categoryColor = categoryColors[plugin.category] || '#6B7280'

    return (
        <Link href={buildPluginDetailPath(plugin.pluginId)}>
            <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer h-full flex flex-col">
                {/* 头部：图标和标题 */}
                <div className="flex items-start gap-3 mb-3">
                    {/* 图标 */}
                    <div
                        className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${categoryColor}20` }}
                    >
                        <PluginIcon
                            icon={plugin.icon}
                            alt={plugin.name}
                            size={24}
                            className="rounded"
                            color={categoryColor}
                            fallback={CategoryIcon}
                        />
                    </div>

                    {/* 标题和作者 */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <h3 className="font-medium text-sm truncate">{plugin.name}</h3>
                            {plugin.isOfficial && (
                                <Badge variant="secondary" className="text-xs px-1.5 py-0 bg-blue-50 text-blue-600 shrink-0">
                                    官方
                                </Badge>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                            {plugin.author?.name || '未知作者'}
                            {plugin.latestVersion && ` · v${plugin.latestVersion.version}`}
                        </p>
                    </div>
                </div>

                {/* 描述 */}
                <p className="text-sm text-muted-foreground line-clamp-2 flex-1 mb-3">{plugin.description}</p>

                {/* 底部：标签和统计 */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                    {/* 标签 */}
                    <div className="flex items-center gap-1">
                        {plugin.tags.slice(0, 2).map(tag => (
                            <Badge key={tag} variant="outline" className="text-xs px-1.5 py-0">
                                {tag}
                            </Badge>
                        ))}
                    </div>

                    {/* 统计 */}
                    <div className="flex items-center gap-3">
                        {isInstalled && (
                            <div className="flex items-center gap-1 text-green-600">
                                <CheckCircleIcon size={12} />
                                <span>已安装</span>
                            </div>
                        )}
                        <div className="flex items-center gap-1">
                            <DownloadIcon size={12} />
                            <span>{formatDownloadCount(plugin.downloadCount)}</span>
                        </div>
                    </div>
                </div>
            </Card>
        </Link>
    )
}

/**
 * PluginCardSkeleton - 插件卡片骨架屏
 */
export function PluginCardSkeleton() {
    return (
        <Card className="p-4 h-full">
            <div className="flex items-start gap-3 mb-3">
                <div className="w-12 h-12 rounded-lg bg-muted animate-pulse" />
                <div className="flex-1">
                    <div className="h-4 w-24 bg-muted rounded animate-pulse mb-2" />
                    <div className="h-3 w-32 bg-muted rounded animate-pulse" />
                </div>
            </div>
            <div className="h-4 w-full bg-muted rounded animate-pulse mb-2" />
            <div className="h-4 w-3/4 bg-muted rounded animate-pulse mb-3" />
            <div className="flex justify-between">
                <div className="h-4 w-16 bg-muted rounded animate-pulse" />
                <div className="h-4 w-12 bg-muted rounded animate-pulse" />
            </div>
        </Card>
    )
}
