/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { CheckCircleIcon, ClockIcon, TagIcon, XCircleIcon } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import type { PluginVersion } from '../types'

interface VersionsListProps {
    versions: PluginVersion[]
    currentVersion?: string
    onSelectVersion?: (version: string) => void
}

/**
 * 格式化日期
 */
function formatDate(dateString: string): string {
    const date = new Date(dateString)
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    })
}

/**
 * VersionsList - 版本列表组件
 */
export function VersionsList({ versions, currentVersion, onSelectVersion }: VersionsListProps) {
    const [showAll, setShowAll] = useState(false)

    // 只显示已批准的版本
    const approvedVersions = versions.filter(v => v.status === 'APPROVED')
    const displayVersions = showAll ? approvedVersions : approvedVersions.slice(0, 5)

    if (approvedVersions.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">版本历史</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">暂无可用版本</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">版本历史</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {displayVersions.map((version, index) => {
                    const isLatest = index === 0
                    const isCurrent = version.version === currentVersion

                    return (
                        <div
                            key={version.id}
                            className={`flex items-start justify-between p-3 rounded-lg border ${
                                isCurrent ? 'border-primary bg-primary/5' : 'border-border'
                            }`}
                        >
                            <div className="flex items-start gap-3">
                                <TagIcon size={16} className="mt-0.5 text-muted-foreground" />
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm">v{version.version}</span>
                                        {isLatest && (
                                            <Badge variant="default" className="text-xs">
                                                最新
                                            </Badge>
                                        )}
                                        {isCurrent && (
                                            <Badge variant="outline" className="text-xs">
                                                当前
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                        <ClockIcon size={12} />
                                        <span>{formatDate(version.createdAt)}</span>
                                    </div>
                                    {version.changelog && <p className="text-xs text-muted-foreground mt-2">{version.changelog}</p>}
                                </div>
                            </div>

                            {onSelectVersion && !isCurrent && (
                                <Button variant="outline" size="sm" onClick={() => onSelectVersion(version.version)}>
                                    选择
                                </Button>
                            )}
                        </div>
                    )
                })}

                {approvedVersions.length > 5 && (
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowAll(!showAll)}>
                        {showAll ? '收起' : `查看全部 ${approvedVersions.length} 个版本`}
                    </Button>
                )}
            </CardContent>
        </Card>
    )
}

/**
 * VersionBadge - 版本状态徽章
 */
interface VersionBadgeProps {
    status: PluginVersion['status']
}

export function VersionBadge({ status }: VersionBadgeProps) {
    switch (status) {
        case 'APPROVED':
            return (
                <Badge variant="default" className="bg-green-500">
                    <CheckCircleIcon size={12} className="mr-1" />
                    已通过
                </Badge>
            )
        case 'PENDING':
            return (
                <Badge variant="secondary">
                    <ClockIcon size={12} className="mr-1" />
                    审核中
                </Badge>
            )
        case 'REJECTED':
            return (
                <Badge variant="destructive">
                    <XCircleIcon size={12} className="mr-1" />
                    已拒绝
                </Badge>
            )
    }
}
