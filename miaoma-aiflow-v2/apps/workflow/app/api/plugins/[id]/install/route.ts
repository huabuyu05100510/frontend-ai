/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'

import { PluginStatus, PluginVersionStatus } from '@/app/generated/prisma/enums'
import { apiError, apiSuccess, ErrorCode, handleApiError } from '@/lib/api-response'
import { getCurrentUserId } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { serializePluginVersion, syncPluginDetailIfNeeded } from '@/lib/services/plugin-market-service'
import { decodePluginId } from '@/lib/utils/plugin-id'

interface RouteParams {
    params: Promise<{ id: string }>
}

/**
 * POST /api/plugins/[id]/install - 安装插件
 */
const installPluginSchema = z.object({
    version: z.string().optional(),
    versionId: z.string().optional(),
})

export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        const userId = await getCurrentUserId()
        if (!userId) {
            return apiError(ErrorCode.UNAUTHORIZED)
        }

        const { id } = await params
        const pluginId = decodePluginId(id)

        const body = await request.json().catch(() => ({}))
        const result = installPluginSchema.safeParse(body)

        if (!result.success) {
            return apiError(ErrorCode.VALIDATION_ERROR, result.error.issues[0]?.message)
        }

        const { version: versionName, versionId } = result.data

        await syncPluginDetailIfNeeded(pluginId, { force: true, origin: new URL(request.url).origin }).catch(error => {
            // eslint-disable-next-line no-console
            console.error(`[PluginMarket] 安装前同步插件失败: ${pluginId}`, error)
        })

        const plugin = await prisma.plugin.findUnique({
            where: { pluginId },
        })

        if (!plugin || plugin.status !== PluginStatus.PUBLISHED) {
            return apiError(ErrorCode.PLUGIN_NOT_FOUND)
        }

        const existingInstallation = await prisma.pluginInstallation.findUnique({
            where: {
                pluginId_userId: {
                    pluginId: plugin.id,
                    userId,
                },
            },
        })

        if (existingInstallation) {
            return apiError(ErrorCode.PLUGIN_ALREADY_INSTALLED)
        }

        const version = versionId
            ? await prisma.pluginVersion.findUnique({
                  where: { id: versionId },
              })
            : versionName
              ? await prisma.pluginVersion.findUnique({
                    where: {
                        pluginId_version: {
                            pluginId: plugin.id,
                            version: versionName,
                        },
                    },
                })
              : await prisma.pluginVersion.findFirst({
                    where: {
                        pluginId: plugin.id,
                        status: PluginVersionStatus.APPROVED,
                    },
                    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
                })

        if (!version || version.pluginId !== plugin.id) {
            return apiError(ErrorCode.PLUGIN_VERSION_NOT_FOUND, '没有可用的插件版本')
        }

        if (version.status !== PluginVersionStatus.APPROVED) {
            return apiError(ErrorCode.PLUGIN_VERSION_NOT_FOUND, '该版本尚未通过审核')
        }

        const installation = await prisma.pluginInstallation.create({
            data: {
                pluginId: plugin.id,
                versionId: version.id,
                userId,
                isEnabled: true,
            },
            include: {
                plugin: {
                    select: {
                        pluginId: true,
                        name: true,
                        icon: true,
                    },
                },
                version: true,
            },
        })

        await prisma.plugin.update({
            where: { id: plugin.id },
            data: {
                downloadCount: {
                    increment: 1,
                },
            },
        })

        return apiSuccess(
            {
                id: installation.id,
                pluginId: installation.plugin.pluginId,
                name: installation.plugin.name,
                icon: installation.plugin.icon,
                version: serializePluginVersion(installation.version),
                isEnabled: installation.isEnabled,
                installedAt: installation.installedAt.toISOString(),
            },
            '插件安装成功'
        )
    } catch (error) {
        return handleApiError(error)
    }
}
