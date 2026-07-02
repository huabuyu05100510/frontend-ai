/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { AlertTriangleIcon, CheckCircleIcon, InfoIcon, ShieldIcon } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import { PERMISSION_LABELS } from '../types'

interface PermissionsProps {
    permissions: string[]
}

/**
 * 风险等级图标
 */
function getRiskIcon(risk: 'low' | 'medium' | 'high') {
    switch (risk) {
        case 'high':
            return <AlertTriangleIcon size={16} className="text-red-500" />
        case 'medium':
            return <InfoIcon size={16} className="text-yellow-500" />
        case 'low':
            return <CheckCircleIcon size={16} className="text-green-500" />
    }
}

/**
 * 风险等级颜色
 */
function getRiskColor(risk: 'low' | 'medium' | 'high') {
    switch (risk) {
        case 'high':
            return 'border-red-200 bg-red-50'
        case 'medium':
            return 'border-yellow-200 bg-yellow-50'
        case 'low':
            return 'border-green-200 bg-green-50'
    }
}

/**
 * Permissions - 权限说明组件
 */
export function Permissions({ permissions }: PermissionsProps) {
    if (permissions.length === 0) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <ShieldIcon size={18} />
                        权限说明
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center gap-2 text-green-600">
                        <CheckCircleIcon size={16} />
                        <span className="text-sm">此插件不需要任何特殊权限</span>
                    </div>
                </CardContent>
            </Card>
        )
    }

    // 按风险等级排序
    const sortedPermissions = [...permissions].sort((a, b) => {
        const riskOrder = { high: 0, medium: 1, low: 2 }
        const riskA = PERMISSION_LABELS[a]?.risk || 'low'
        const riskB = PERMISSION_LABELS[b]?.risk || 'low'
        return riskOrder[riskA] - riskOrder[riskB]
    })

    // 统计风险
    const riskStats = {
        high: permissions.filter(p => PERMISSION_LABELS[p]?.risk === 'high').length,
        medium: permissions.filter(p => PERMISSION_LABELS[p]?.risk === 'medium').length,
        low: permissions.filter(p => PERMISSION_LABELS[p]?.risk === 'low' || !PERMISSION_LABELS[p]).length,
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                    <ShieldIcon size={18} />
                    权限说明
                </CardTitle>
                <CardDescription>此插件需要以下权限才能正常运行</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* 风险摘要 */}
                <div className="flex items-center gap-4 text-sm">
                    {riskStats.high > 0 && (
                        <div className="flex items-center gap-1 text-red-600">
                            <AlertTriangleIcon size={14} />
                            <span>{riskStats.high} 个高风险</span>
                        </div>
                    )}
                    {riskStats.medium > 0 && (
                        <div className="flex items-center gap-1 text-yellow-600">
                            <InfoIcon size={14} />
                            <span>{riskStats.medium} 个中风险</span>
                        </div>
                    )}
                    {riskStats.low > 0 && (
                        <div className="flex items-center gap-1 text-green-600">
                            <CheckCircleIcon size={14} />
                            <span>{riskStats.low} 个低风险</span>
                        </div>
                    )}
                </div>

                {/* 权限列表 */}
                <div className="space-y-2">
                    {sortedPermissions.map(perm => {
                        const info = PERMISSION_LABELS[perm]
                        const risk = info?.risk || 'low'

                        return (
                            <div key={perm} className={`flex items-start gap-3 p-3 rounded-lg border ${getRiskColor(risk)}`}>
                                {getRiskIcon(risk)}
                                <div className="flex-1">
                                    <p className="font-medium text-sm">{info?.label || perm}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {info?.description || '此权限用途未知，请谨慎授权'}
                                    </p>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </CardContent>
        </Card>
    )
}

/**
 * PermissionsSummary - 权限摘要（用于卡片展示）
 */
interface PermissionsSummaryProps {
    permissions: string[]
}

export function PermissionsSummary({ permissions }: PermissionsSummaryProps) {
    if (permissions.length === 0) {
        return (
            <div className="flex items-center gap-1 text-xs text-green-600">
                <ShieldIcon size={12} />
                <span>无需特殊权限</span>
            </div>
        )
    }

    const hasHighRisk = permissions.some(p => PERMISSION_LABELS[p]?.risk === 'high')
    const hasMediumRisk = permissions.some(p => PERMISSION_LABELS[p]?.risk === 'medium')

    if (hasHighRisk) {
        return (
            <div className="flex items-center gap-1 text-xs text-red-600">
                <AlertTriangleIcon size={12} />
                <span>需要高风险权限</span>
            </div>
        )
    }

    if (hasMediumRisk) {
        return (
            <div className="flex items-center gap-1 text-xs text-yellow-600">
                <InfoIcon size={12} />
                <span>需要 {permissions.length} 项权限</span>
            </div>
        )
    }

    return (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldIcon size={12} />
            <span>需要 {permissions.length} 项权限</span>
        </div>
    )
}
