/* eslint-disable no-console */
/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import type {
    KnowledgeSearchOptions,
    KnowledgeSearchResult,
    LLMInvokeOptions,
    LLMInvokeResult,
    PluginPermission,
    PluginServices,
} from '@miaoma-aiflow/plugin-core'

/**
 * 权限拒绝错误
 */
export class PermissionDeniedError extends Error {
    constructor(
        public readonly permission: PluginPermission,
        public readonly action: string
    ) {
        super(`Permission denied: '${permission}' is required for action '${action}'`)
        this.name = 'PermissionDeniedError'
    }
}

/**
 * 权限代理配置
 */
export interface PermissionProxyConfig {
    /** 插件 ID */
    pluginId: string
    /** 已授权的权限 */
    grantedPermissions: PluginPermission[]
    /** 原始服务 */
    services: {
        fetch: typeof fetch
        getEnv: (key: string) => string | undefined
        sendEmail: PluginServices['sendEmail']
        invokeLLM: (options: LLMInvokeOptions) => Promise<LLMInvokeResult>
        searchKnowledge: (options: KnowledgeSearchOptions) => Promise<KnowledgeSearchResult>
    }
    /** 环境变量白名单前缀（为空时表示不限制前缀，仅校验权限） */
    envAllowlistPrefixes?: string[]
    /** 权限拒绝回调 */
    onPermissionDenied?: (permission: PluginPermission, action: string) => void
}

/**
 * 创建权限代理服务
 * 包装原始服务，添加权限检查
 */
export function createPermissionProxy(config: PermissionProxyConfig): PluginServices {
    const { pluginId, grantedPermissions, services, envAllowlistPrefixes, onPermissionDenied } = config

    /**
     * 检查权限
     */
    function checkPermission(permission: PluginPermission, action: string): void {
        if (!grantedPermissions.includes(permission)) {
            onPermissionDenied?.(permission, action)
            throw new PermissionDeniedError(permission, action)
        }
    }

    /**
     * 代理 fetch - 需要 network 权限
     */
    const proxiedFetch: typeof fetch = async (input, init) => {
        checkPermission('network', 'fetch')

        // 添加插件标识头
        const headers = new Headers(init?.headers)
        headers.set('X-Plugin-Id', pluginId)

        return services.fetch(input, { ...init, headers })
    }

    /**
     * 代理 getEnv - 需要 env:read 权限
     */
    const proxiedGetEnv = (key: string): string | undefined => {
        checkPermission('env:read', `getEnv(${key})`)

        if (Array.isArray(envAllowlistPrefixes) && envAllowlistPrefixes.length > 0) {
            const isAllowed = envAllowlistPrefixes.some(prefix => key.startsWith(prefix))
            if (!isAllowed) {
                console.warn(`[Plugin ${pluginId}] Access to env '${key}' is restricted`)
                return undefined
            }
        }

        return services.getEnv(key)
    }

    /**
     * 代理 sendEmail - 需要 email:send 权限
     */
    const proxiedSendEmail: PluginServices['sendEmail'] = async options => {
        checkPermission('email:send', 'sendEmail')

        console.log(`[Plugin ${pluginId}] Email send: to=${options.to}`)

        return services.sendEmail(options)
    }

    /**
     * 代理 invokeLLM - 需要 llm:invoke 权限
     */
    const proxiedInvokeLLM = async (options: LLMInvokeOptions): Promise<LLMInvokeResult> => {
        checkPermission('llm:invoke', 'invokeLLM')

        // 记录调用日志
        console.log(`[Plugin ${pluginId}] LLM invocation: model=${options.model || 'default'}`)

        return services.invokeLLM(options)
    }

    /**
     * 代理 searchKnowledge - 需要 knowledge:read 权限
     */
    const proxiedSearchKnowledge = async (options: KnowledgeSearchOptions): Promise<KnowledgeSearchResult> => {
        checkPermission('knowledge:read', 'searchKnowledge')

        // 记录调用日志
        console.log(`[Plugin ${pluginId}] Knowledge search: bases=${options.knowledgeBaseIds.join(',')}`)

        return services.searchKnowledge(options)
    }

    return {
        fetch: proxiedFetch,
        getEnv: proxiedGetEnv,
        sendEmail: proxiedSendEmail,
        invokeLLM: proxiedInvokeLLM,
        searchKnowledge: proxiedSearchKnowledge,
    }
}

/**
 * 权限检查工具类
 */
export class PermissionChecker {
    constructor(private grantedPermissions: PluginPermission[]) {}

    /**
     * 检查是否有权限
     */
    has(permission: PluginPermission): boolean {
        return this.grantedPermissions.includes(permission)
    }

    /**
     * 检查是否有所有权限
     */
    hasAll(permissions: PluginPermission[]): boolean {
        return permissions.every(p => this.has(p))
    }

    /**
     * 检查是否有任一权限
     */
    hasAny(permissions: PluginPermission[]): boolean {
        return permissions.some(p => this.has(p))
    }

    /**
     * 获取缺失的权限
     */
    getMissing(requiredPermissions: PluginPermission[]): PluginPermission[] {
        return requiredPermissions.filter(p => !this.has(p))
    }

    /**
     * 断言有权限，否则抛出错误
     */
    assert(permission: PluginPermission, action: string): void {
        if (!this.has(permission)) {
            throw new PermissionDeniedError(permission, action)
        }
    }
}
