/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { PluginDetail, PluginDetailSkeleton } from '@/components/plugin/market/plugin-detail'
import type { InstalledPlugin, PluginInfo } from '@/components/plugin/market/types'
import { buildPluginApiPath, decodePluginId } from '@/lib/utils/plugin-id'

export default function PluginDetailPage() {
    const params = useParams()
    const router = useRouter()
    const pluginId = decodePluginId(params.id as string)

    const [plugin, setPlugin] = useState<PluginInfo | null>(null)
    const [installation, setInstallation] = useState<InstalledPlugin | null>(null)
    const [loading, setLoading] = useState(true)

    // 加载插件详情
    const loadPlugin = useCallback(async () => {
        setLoading(true)
        try {
            const response = await fetch(buildPluginApiPath(pluginId))
            if (!response.ok) {
                if (response.status === 404) {
                    toast.error('插件不存在')
                    router.push('/plugins')
                    return
                }
                throw new Error('加载失败')
            }

            const data = await response.json()
            if (data.success) {
                setPlugin(data.data)
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '加载插件详情失败')
        } finally {
            setLoading(false)
        }
    }, [pluginId, router])

    // 检查安装状态
    const checkInstallation = useCallback(async () => {
        try {
            const response = await fetch('/api/plugins/installed')
            if (!response.ok) return

            const data = await response.json()
            if (data.success) {
                const found = data.data.items?.find((item: InstalledPlugin) => item.pluginId === pluginId)
                setInstallation(found || null)
            }
        } catch {
            // 静默处理
        }
    }, [pluginId])

    useEffect(() => {
        loadPlugin()
        checkInstallation()
    }, [loadPlugin, checkInstallation])

    // 安装成功
    const handleInstalled = () => {
        checkInstallation()
        loadPlugin()
    }

    // 卸载成功
    const handleUninstalled = () => {
        setInstallation(null)
        loadPlugin()
    }

    if (loading) {
        return (
            <div className="px-6 lg:px-12 py-6">
                <PluginDetailSkeleton />
            </div>
        )
    }

    if (!plugin) {
        return null
    }

    return (
        <div className="px-6 lg:px-12 py-6">
            <PluginDetail
                plugin={plugin}
                isInstalled={!!installation}
                installedVersion={installation?.version.version}
                onInstalled={handleInstalled}
                onUninstalled={handleUninstalled}
            />
        </div>
    )
}
