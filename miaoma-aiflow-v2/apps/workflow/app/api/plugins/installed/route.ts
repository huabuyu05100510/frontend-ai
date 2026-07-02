/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { NextRequest } from 'next/server'

import { PluginVersionStatus } from '@/app/generated/prisma/enums'
import { apiError, apiPaginated, ErrorCode, handleApiError } from '@/lib/api-response'
import { getCurrentUserId } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
    fetchRegistryPluginCatalog,
    serializePlugin,
    serializePluginVersion,
    serializeRegistryPlugin,
} from '@/lib/services/plugin-market-service'

/**
 * GET /api/plugins/installed - 获取已安装的插件列表
 */
export async function GET(request: NextRequest) {
    try {
        const userId = await getCurrentUserId()
        if (!userId) {
            return apiError(ErrorCode.UNAUTHORIZED)
        }

        const { searchParams } = new URL(request.url)
        const isEnabled = searchParams.get('isEnabled')
        const page = parseInt(searchParams.get('page') || '1')
        const pageSize = parseInt(searchParams.get('pageSize') || '50')

        const where: { userId: string; isEnabled?: boolean } = {
            userId,
        }

        if (isEnabled !== null) {
            where.isEnabled = isEnabled === 'true'
        }

        const origin = new URL(request.url).origin
        const registryPlugins = await fetchRegistryPluginCatalog({ origin }).catch(error => {
            // eslint-disable-next-line no-console
            console.error('[PluginMarket] 加载注册表插件目录失败:', error)
            return []
        })
        const registryPluginMap = new Map(registryPlugins.map(item => [item.pluginId, serializeRegistryPlugin(item)]))

        const [installations, total] = await Promise.all([
            prisma.pluginInstallation.findMany({
                where,
                orderBy: { installedAt: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
                include: {
                    plugin: {
                        include: {
                            author: {
                                select: {
                                    id: true,
                                    name: true,
                                    avatar: true,
                                },
                            },
                            versions: {
                                where: {
                                    status: PluginVersionStatus.APPROVED,
                                },
                                orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
                                take: 1,
                            },
                        },
                    },
                    version: true,
                },
            }),
            prisma.pluginInstallation.count({ where }),
        ])

        const totalPages = Math.ceil(total / pageSize)

        const items = installations.map(installation => {
            const plugin = registryPluginMap.get(installation.plugin.pluginId) || serializePlugin(installation.plugin)
            const version =
                plugin.latestVersion?.version === installation.version.version
                    ? plugin.latestVersion
                    : serializePluginVersion(installation.version)

            return {
                id: installation.id,
                pluginId: installation.plugin.pluginId,
                isEnabled: installation.isEnabled,
                config: installation.config,
                plugin,
                version,
                hasUpdate: plugin.latestVersion?.version !== undefined && plugin.latestVersion.version !== version.version,
                installedAt: installation.installedAt.toISOString(),
                updatedAt: installation.updatedAt.toISOString(),
            }
        })

        return apiPaginated(items, { page, pageSize, total, totalPages })
    } catch (error) {
        return handleApiError(error)
    }
}
