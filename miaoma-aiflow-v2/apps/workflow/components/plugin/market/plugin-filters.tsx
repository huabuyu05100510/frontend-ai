/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { BrainIcon, DatabaseIcon, ImageIcon, MailIcon, PlugIcon, SearchIcon, WrenchIcon, XIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import type { PluginCategory, PluginFilters as Filters } from './types'
import { PLUGIN_CATEGORIES } from './types'

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

interface PluginFiltersProps {
    filters: Filters
    onChange: (filters: Filters) => void
    /** 热门标签 */
    popularTags?: string[]
}

/**
 * PluginFilters - 插件筛选器组件
 */
export function PluginFilters({ filters, onChange, popularTags = [] }: PluginFiltersProps) {
    const handleCategoryChange = (category: PluginCategory | undefined) => {
        onChange({ ...filters, category })
    }

    const handleSearchChange = (search: string) => {
        onChange({ ...filters, search: search || undefined })
    }

    const handleTagChange = (tag: string | undefined) => {
        onChange({ ...filters, tag })
    }

    const handleOfficialToggle = () => {
        onChange({ ...filters, isOfficial: filters.isOfficial ? undefined : true })
    }

    const clearFilters = () => {
        onChange({})
    }

    const hasActiveFilters = filters.category || filters.search || filters.tag || filters.isOfficial

    return (
        <div className="space-y-4">
            {/* 搜索框 */}
            <div className="relative">
                <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                    placeholder="搜索插件..."
                    value={filters.search || ''}
                    onChange={e => handleSearchChange(e.target.value)}
                    className="pl-9 h-10"
                />
            </div>

            {/* 分类筛选 */}
            <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">分类</h4>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant={!filters.category ? 'default' : 'outline'}
                        size="sm"
                        className="h-8"
                        onClick={() => handleCategoryChange(undefined)}
                    >
                        全部
                    </Button>
                    {PLUGIN_CATEGORIES.map(cat => {
                        const Icon = categoryIcons[cat.value]
                        const isActive = filters.category === cat.value
                        return (
                            <Button
                                key={cat.value}
                                variant={isActive ? 'default' : 'outline'}
                                size="sm"
                                className="h-8"
                                onClick={() => handleCategoryChange(cat.value)}
                            >
                                <Icon size={14} className="mr-1" />
                                {cat.label}
                            </Button>
                        )
                    })}
                </div>
            </div>

            {/* 快速筛选 */}
            <div className="flex items-center gap-2">
                <Button
                    variant={filters.isOfficial ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={handleOfficialToggle}
                >
                    官方出品
                </Button>
            </div>

            {/* 热门标签 */}
            {popularTags.length > 0 && (
                <div className="space-y-2">
                    <h4 className="text-sm font-medium text-foreground">热门标签</h4>
                    <div className="flex flex-wrap gap-1.5">
                        {popularTags.map(tag => (
                            <Badge
                                key={tag}
                                variant={filters.tag === tag ? 'default' : 'outline'}
                                className="cursor-pointer hover:bg-muted"
                                onClick={() => handleTagChange(filters.tag === tag ? undefined : tag)}
                            >
                                {tag}
                            </Badge>
                        ))}
                    </div>
                </div>
            )}

            {/* 清除筛选 */}
            {hasActiveFilters && (
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clearFilters}>
                    <XIcon size={14} className="mr-1" />
                    清除筛选
                </Button>
            )}
        </div>
    )
}

/**
 * PluginFiltersCompact - 紧凑版筛选器（用于移动端或小屏幕）
 */
export function PluginFiltersCompact({ filters, onChange }: PluginFiltersProps) {
    const handleSearchChange = (search: string) => {
        onChange({ ...filters, search: search || undefined })
    }

    return (
        <div className="flex items-center gap-2">
            <div className="relative flex-1">
                <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                    placeholder="搜索插件..."
                    value={filters.search || ''}
                    onChange={e => handleSearchChange(e.target.value)}
                    className="pl-9 h-9"
                />
            </div>
        </div>
    )
}
