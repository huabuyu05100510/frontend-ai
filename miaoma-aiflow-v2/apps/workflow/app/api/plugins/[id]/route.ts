/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { NextRequest } from 'next/server'

import { apiError, apiSuccess, ErrorCode, handleApiError } from '@/lib/api-response'
import { fetchRegistryPluginDetail, serializeRegistryPlugin } from '@/lib/services/plugin-market-service'
import { decodePluginId } from '@/lib/utils/plugin-id'

interface RouteParams {
    params: Promise<{ id: string }>
}

/**
 * GET /api/plugins/[id] - 获取插件详情
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params
        const pluginId = decodePluginId(id)
        const plugin = await fetchRegistryPluginDetail(pluginId, { origin: new URL(request.url).origin })

        if (!plugin) {
            return apiError(ErrorCode.PLUGIN_NOT_FOUND)
        }

        return apiSuccess(serializeRegistryPlugin(plugin))
    } catch (error) {
        return handleApiError(error)
    }
}

/**
 * PATCH /api/plugins/[id] - 更新插件信息
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        void request
        void params
        return apiError(ErrorCode.INVALID_OPERATION, '远程插件市场暂不支持在当前应用内修改插件')
    } catch (error) {
        return handleApiError(error)
    }
}

/**
 * DELETE /api/plugins/[id] - 删除插件
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    try {
        void request
        void params
        return apiError(ErrorCode.INVALID_OPERATION, '远程插件市场暂不支持在当前应用内删除插件')
    } catch (error) {
        return handleApiError(error)
    }
}
