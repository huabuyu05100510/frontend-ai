/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { NextRequest } from 'next/server'

import { PluginCategory, PluginStatus } from '@/app/generated/prisma/enums'
import { apiError, apiPaginated, ErrorCode, handleApiError } from '@/lib/api-response'
import { fetchRegistryPluginCatalog, serializeRegistryPlugin } from '@/lib/services/plugin-market-service'

/**
 * GET /api/plugins - 获取插件市场列表
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const origin = new URL(request.url).origin

        const search = searchParams.get('search') || undefined
        const tag = searchParams.get('tag') || undefined
        const category = searchParams.get('category') as PluginCategory | null
        const status = searchParams.get('status') as PluginStatus | null
        const isOfficial = searchParams.get('isOfficial')
        const sortBy = searchParams.get('sortBy') || 'downloadCount'
        const sortOrder = searchParams.get('sortOrder') || 'desc'
        const page = parseInt(searchParams.get('page') || '1')
        const pageSize = parseInt(searchParams.get('pageSize') || '20')

        let items = (await fetchRegistryPluginCatalog({ origin })).map(serializeRegistryPlugin)

        const targetStatus = status || PluginStatus.PUBLISHED
        items = items.filter(item => item.status === targetStatus)

        if (category) {
            items = items.filter(item => item.category === category)
        }

        if (isOfficial !== null) {
            const officialOnly = isOfficial === 'true'
            items = items.filter(item => item.isOfficial === officialOnly)
        }

        if (search) {
            const keyword = search.toLowerCase()
            items = items.filter(item => {
                return item.name.toLowerCase().includes(keyword) || item.description.toLowerCase().includes(keyword)
            })
        }

        if (tag) {
            items = items.filter(item => item.tags.includes(tag))
        }

        items.sort((left, right) => {
            const direction = sortOrder === 'asc' ? 1 : -1

            switch (sortBy) {
                case 'rating':
                    return ((left.rating || 0) - (right.rating || 0)) * direction
                case 'createdAt':
                    return (Date.parse(left.createdAt) - Date.parse(right.createdAt)) * direction
                case 'updatedAt':
                    return (Date.parse(left.updatedAt) - Date.parse(right.updatedAt)) * direction
                case 'downloadCount':
                default:
                    return (left.downloadCount - right.downloadCount) * direction
            }
        })

        const total = items.length
        const totalPages = Math.ceil(total / pageSize)
        const pagedItems = items.slice((page - 1) * pageSize, page * pageSize)

        return apiPaginated(pagedItems, { page, pageSize, total, totalPages })
    } catch (error) {
        return handleApiError(error)
    }
}

/**
 * POST /api/plugins - 发布新插件
 */
export async function POST(request: NextRequest) {
    try {
        void request
        return apiError(ErrorCode.INVALID_OPERATION, '远程插件市场暂不支持在当前应用内发布插件')
    } catch (error) {
        return handleApiError(error)
    }
}
