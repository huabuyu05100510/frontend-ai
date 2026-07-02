/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { NextRequest } from 'next/server'

import { getPluginMarketBaseUrl } from '@/lib/services/plugin-market-registry'

export async function GET(request: NextRequest) {
    const targetUrl = new URL(`${getPluginMarketBaseUrl()}/v1/plugins`)
    const incomingUrl = new URL(request.url)
    incomingUrl.searchParams.forEach((value, key) => {
        targetUrl.searchParams.set(key, value)
    })

    const response = await fetch(targetUrl.toString(), {
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
