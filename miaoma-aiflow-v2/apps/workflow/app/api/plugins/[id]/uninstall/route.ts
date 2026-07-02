/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { NextRequest } from 'next/server'

import { apiError, apiSuccess, ErrorCode, handleApiError } from '@/lib/api-response'
import { getCurrentUserId } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decodePluginId } from '@/lib/utils/plugin-id'

interface RouteParams {
    params: Promise<{ id: string }>
}

/**
 * POST /api/plugins/[id]/uninstall - 卸载插件
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        void request
        const userId = await getCurrentUserId()
        if (!userId) {
            return apiError(ErrorCode.UNAUTHORIZED)
        }

        const { id } = await params
        const pluginId = decodePluginId(id)

        const plugin = await prisma.plugin.findUnique({
            where: {
                pluginId,
            },
            select: {
                id: true,
            },
        })

        if (!plugin) {
            return apiError(ErrorCode.PLUGIN_NOT_INSTALLED)
        }

        const installation = await prisma.pluginInstallation.findUnique({
            where: {
                pluginId_userId: {
                    pluginId: plugin.id,
                    userId,
                },
            },
            include: {
                plugin: {
                    select: {
                        pluginId: true,
                        name: true,
                    },
                },
            },
        })

        if (!installation) {
            return apiError(ErrorCode.PLUGIN_NOT_INSTALLED)
        }

        await prisma.pluginInstallation.delete({
            where: { id: installation.id },
        })

        return apiSuccess(
            {
                pluginId: installation.plugin.pluginId,
                name: installation.plugin.name,
            },
            '插件卸载成功'
        )
    } catch (error) {
        return handleApiError(error)
    }
}
