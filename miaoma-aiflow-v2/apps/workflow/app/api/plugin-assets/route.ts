/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { NextRequest } from 'next/server'

import { buildPluginMarketAssetUrl, getPluginMarketBaseUrl } from '@/lib/services/plugin-market-registry'

export async function GET(request: NextRequest) {
    const url = new URL(request.url)
    const { searchParams } = url
    const pluginId = searchParams.get('pluginId')
    const version = searchParams.get('version')
    const file = searchParams.get('file')

    if (!pluginId || !version || !file) {
        return new Response('Not Found', { status: 404 })
    }

    try {
        const assetUrl = buildPluginMarketAssetUrl(getPluginMarketBaseUrl(), {
            pluginId,
            version,
            file,
        })
        const response = await fetch(assetUrl, {
            cache: 'no-store',
        })

        return new Response(await response.arrayBuffer(), {
            status: response.status,
            headers: {
                'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
                'Cache-Control': response.headers.get('cache-control') || 'public, max-age=300',
            },
        })
    } catch {
        return new Response('Not Found', { status: 404 })
    }
}
