/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

/**
 * 对插件 ID 进行 URL 编码，兼容 @scope/name 形式。
 */
export function encodePluginId(pluginId: string): string {
    return encodeURIComponent(pluginId)
}

/**
 * 对路由参数中的插件 ID 进行解码。
 */
export function decodePluginId(pluginId: string): string {
    try {
        return decodeURIComponent(pluginId)
    } catch {
        return pluginId
    }
}

/**
 * 构建插件详情页路径。
 */
export function buildPluginDetailPath(pluginId: string): string {
    return `/plugins/${encodePluginId(pluginId)}`
}

/**
 * 构建插件 API 路径。
 */
export function buildPluginApiPath(pluginId: string, suffix: string = ''): string {
    return `/api/plugins/${encodePluginId(pluginId)}${suffix}`
}
