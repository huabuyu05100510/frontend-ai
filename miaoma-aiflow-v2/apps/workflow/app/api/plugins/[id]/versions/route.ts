/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { NextRequest } from 'next/server'

import { PluginVersionStatus } from '@/app/generated/prisma/enums'
import { apiError, apiPaginated, ErrorCode, handleApiError } from '@/lib/api-response'
import { fetchRegistryPluginDetail, serializeRegistryPlugin } from '@/lib/services/plugin-market-service'
import { decodePluginId } from '@/lib/utils/plugin-id'

interface RouteParams {
    params: Promise<{ id: string }>
}

/**
 * GET /api/plugins/[id]/versions - 获取插件版本列表
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params
        const pluginId = decodePluginId(id)
        const { searchParams } = new URL(request.url)

        const page = parseInt(searchParams.get('page') || '1')
        const pageSize = parseInt(searchParams.get('pageSize') || '20')
        const status = (searchParams.get('status') as PluginVersionStatus | null) || PluginVersionStatus.APPROVED

        const plugin = await fetchRegistryPluginDetail(pluginId, { origin: new URL(request.url).origin })
        if (!plugin) {
            return apiError(ErrorCode.PLUGIN_NOT_FOUND)
        }

        const allVersions = serializeRegistryPlugin(plugin).versions || []
        const versions = status === PluginVersionStatus.APPROVED ? allVersions : []
        const total = versions.length

        const totalPages = Math.ceil(total / pageSize)
        const items = versions.slice((page - 1) * pageSize, page * pageSize)

        return apiPaginated(items, { page, pageSize, total, totalPages })
    } catch (error) {
        return handleApiError(error)
    }
}

/**
 * POST /api/plugins/[id]/versions - 发布新版本
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
    try {
        void request
        void params
        return apiError(ErrorCode.INVALID_OPERATION, '远程插件市场暂不支持在当前应用内发布插件版本')
    } catch (error) {
        return handleApiError(error)
    }
}
