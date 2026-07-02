/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { NextRequest } from 'next/server'

import { getPluginMarketBaseUrl } from '@/lib/services/plugin-market-registry'

interface RouteParams {
    params: Promise<{ id: string[] }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    void request
    const { id } = await params
    const pluginId = decodeURIComponent(id.join('/'))
    const targetUrl = `${getPluginMarketBaseUrl()}/v1/plugins/${encodeURIComponent(pluginId)}`

    const response = await fetch(targetUrl, {
        headers: {
            Accept: 'application/json',
        },
        cache: 'no-store',
    })

    return new Response(await response.text(), {
        status: response.status,
        headers: {
            'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
        },
    })
}
