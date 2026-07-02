/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

const DEFAULT_PLUGIN_MARKET_BASE_URL = 'http://localhost:3101/api/plugin-market'

export function getPluginMarketBaseUrl(): string {
    const explicitRegistryBaseUrl = process.env.PLUGIN_REGISTRY_BASE_URL?.trim()
    if (explicitRegistryBaseUrl) {
        return explicitRegistryBaseUrl.replace(/\/$/, '')
    }

    const pluginMarketServerUrl = process.env.PLUGIN_MARKET_SERVER_URL?.trim() || process.env.NEXT_PUBLIC_PLUGIN_MARKET_SERVER_URL?.trim()

    if (pluginMarketServerUrl) {
        return `${pluginMarketServerUrl.replace(/\/$/, '')}/api/plugin-market`
    }

    return DEFAULT_PLUGIN_MARKET_BASE_URL
}

export function buildPluginMarketAssetUrl(
    baseUrl: string,
    options: {
        pluginId: string
        version: string
        file: string
    }
): string {
    const params = new URLSearchParams({
        pluginId: options.pluginId,
        version: options.version,
        file: options.file,
    })

    return `${baseUrl.replace(/\/$/, '')}/assets?${params.toString()}`
}
