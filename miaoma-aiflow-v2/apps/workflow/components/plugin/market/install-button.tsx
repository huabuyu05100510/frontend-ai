/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { CheckIcon, DownloadIcon, Loader2Icon, TrashIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

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
import { Button } from '@/components/ui/button'
import { buildPluginApiPath } from '@/lib/utils/plugin-id'

import { PERMISSION_LABELS } from './types'

interface InstallButtonProps {
    pluginId: string
    version: string
    isInstalled: boolean
    permissions?: string[]
    onInstalled?: () => void
    onUninstalled?: () => void
    size?: 'default' | 'sm' | 'lg'
    className?: string
}

/**
 * InstallButton - 插件安装/卸载按钮
 */
export function InstallButton({
    pluginId,
    version,
    isInstalled,
    permissions = [],
    onInstalled,
    onUninstalled,
    size = 'default',
    className,
}: InstallButtonProps) {
    const [loading, setLoading] = useState(false)
    const [showPermissionDialog, setShowPermissionDialog] = useState(false)

    // 安装插件
    const handleInstall = async () => {
        setLoading(true)
        try {
            const response = await fetch(buildPluginApiPath(pluginId, '/install'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ version }),
            })

            if (!response.ok) {
                const data = await response.json()
                throw new Error(data.message || '安装失败')
            }

            toast.success('插件安装成功')
            onInstalled?.()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '安装失败')
        } finally {
            setLoading(false)
            setShowPermissionDialog(false)
        }
    }

    // 卸载插件
    const handleUninstall = async () => {
        setLoading(true)
        try {
            const response = await fetch(buildPluginApiPath(pluginId, '/uninstall'), {
                method: 'POST',
            })

            if (!response.ok) {
                const data = await response.json()
                throw new Error(data.message || '卸载失败')
            }

            toast.success('插件已卸载')
            onUninstalled?.()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : '卸载失败')
        } finally {
            setLoading(false)
        }
    }

    // 点击安装按钮
    const handleInstallClick = () => {
        if (permissions.length > 0) {
            setShowPermissionDialog(true)
        } else {
            handleInstall()
        }
    }

    if (isInstalled) {
        return (
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="outline" size={size} className={className} disabled={loading}>
                        {loading ? (
                            <Loader2Icon size={16} className="mr-1 animate-spin" />
                        ) : (
                            <CheckIcon size={16} className="mr-1 text-green-600" />
                        )}
                        已安装
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>确认卸载</AlertDialogTitle>
                        <AlertDialogDescription>卸载后，使用此插件的工作流可能无法正常运行。确定要卸载吗？</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={handleUninstall} className="bg-red-600 hover:bg-red-700">
                            <TrashIcon size={16} className="mr-1" />
                            确认卸载
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        )
    }

    return (
        <>
            <Button size={size} className={className} disabled={loading} onClick={handleInstallClick}>
                {loading ? <Loader2Icon size={16} className="mr-1 animate-spin" /> : <DownloadIcon size={16} className="mr-1" />}
                安装
            </Button>

            {/* 权限确认弹窗 */}
            <AlertDialog open={showPermissionDialog} onOpenChange={setShowPermissionDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>安装插件</AlertDialogTitle>
                        <AlertDialogDescription>此插件需要以下权限：</AlertDialogDescription>
                    </AlertDialogHeader>

                    <div className="space-y-3 my-4">
                        {permissions.map(perm => {
                            const info = PERMISSION_LABELS[perm]
                            return (
                                <div key={perm} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                                    <div
                                        className={`w-2 h-2 rounded-full mt-1.5 ${
                                            info?.risk === 'high'
                                                ? 'bg-red-500'
                                                : info?.risk === 'medium'
                                                  ? 'bg-yellow-500'
                                                  : 'bg-green-500'
                                        }`}
                                    />
                                    <div>
                                        <p className="font-medium text-sm">{info?.label || perm}</p>
                                        <p className="text-xs text-muted-foreground">{info?.description || '未知权限'}</p>
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={handleInstall}>
                            <DownloadIcon size={16} className="mr-1" />
                            确认安装
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
