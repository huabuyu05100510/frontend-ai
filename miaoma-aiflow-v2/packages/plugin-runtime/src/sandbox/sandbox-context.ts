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
    PluginLogger,
    PluginPermission,
    PluginServices,
} from '@miaoma-aiflow/plugin-core'

import { createPermissionProxy, PermissionChecker } from './permission-proxy'

/**
 * 沙箱上下文配置
 */
export interface SandboxContextConfig {
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
    /** 日志级别 */
    logLevel?: 'debug' | 'info' | 'warn' | 'error'
    /** 自定义日志处理器 */
    logHandler?: (level: string, pluginId: string, message: string, ...args: unknown[]) => void
}

/**
 * 沙箱上下文
 * 为插件提供隔离的执行环境
 */
export interface SandboxContext {
    /** 获取沙箱化的服务 */
    getServices(): PluginServices
    /** 获取沙箱化的 console */
    getConsole(): PluginLogger
    /** 获取权限检查器 */
    getPermissionChecker(): PermissionChecker
    /** 销毁沙箱 */
    destroy(): void
    /** 检查沙箱是否已销毁 */
    isDestroyed(): boolean
}

/**
 * 创建沙箱上下文
 */
export function createSandboxContext(config: SandboxContextConfig): SandboxContext {
    const { pluginId, grantedPermissions, services, envAllowlistPrefixes, logLevel = 'info', logHandler } = config

    let destroyed = false

    // 创建权限代理服务
    const proxiedServices = createPermissionProxy({
        pluginId,
        grantedPermissions,
        services,
        envAllowlistPrefixes,
        onPermissionDenied: (permission, action) => {
            sandboxConsole.warn(`Permission denied: ${permission} for action: ${action}`)
        },
    })

    // 创建权限检查器
    const permissionChecker = new PermissionChecker(grantedPermissions)

    // 日志级别优先级
    const logLevels: Record<string, number> = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3,
    }

    const currentLogLevel = logLevels[logLevel] ?? 1

    /**
     * 创建日志方法
     */
    function createLogMethod(level: 'debug' | 'info' | 'warn' | 'error') {
        return (message: string, ...args: unknown[]) => {
            if (destroyed) return
            if (logLevels[level] < currentLogLevel) return

            const prefix = `[Plugin:${pluginId}]`
            const formattedMessage = `${prefix} ${message}`

            if (logHandler) {
                logHandler(level, pluginId, message, ...args)
            } else {
                // 默认使用 console 输出
                switch (level) {
                    case 'debug':
                        console.debug(formattedMessage, ...args)
                        break
                    case 'info':
                        console.info(formattedMessage, ...args)
                        break
                    case 'warn':
                        console.warn(formattedMessage, ...args)
                        break
                    case 'error':
                        console.error(formattedMessage, ...args)
                        break
                }
            }
        }
    }

    // 创建沙箱化的 console
    const sandboxConsole: PluginLogger = {
        debug: createLogMethod('debug'),
        info: createLogMethod('info'),
        warn: createLogMethod('warn'),
        error: createLogMethod('error'),
    }

    // 创建受保护的服务包装器
    const protectedServices: PluginServices = {
        fetch: (...args: Parameters<typeof fetch>) => {
            if (destroyed) {
                return Promise.reject(new Error('Sandbox has been destroyed'))
            }
            return proxiedServices.fetch(...args)
        },
        getEnv: (key: string) => {
            if (destroyed) return undefined
            return proxiedServices.getEnv(key)
        },
        sendEmail: options => {
            if (destroyed) {
                return Promise.reject(new Error('Sandbox has been destroyed'))
            }
            return proxiedServices.sendEmail(options)
        },
        invokeLLM: (options: LLMInvokeOptions) => {
            if (destroyed) {
                return Promise.reject(new Error('Sandbox has been destroyed'))
            }
            return proxiedServices.invokeLLM(options)
        },
        searchKnowledge: (options: KnowledgeSearchOptions) => {
            if (destroyed) {
                return Promise.reject(new Error('Sandbox has been destroyed'))
            }
            return proxiedServices.searchKnowledge(options)
        },
    }

    return {
        getServices(): PluginServices {
            return protectedServices
        },

        getConsole(): PluginLogger {
            return sandboxConsole
        },

        getPermissionChecker(): PermissionChecker {
            return permissionChecker
        },

        destroy(): void {
            if (!destroyed) {
                destroyed = true
                sandboxConsole.info('Sandbox destroyed')
            }
        },

        isDestroyed(): boolean {
            return destroyed
        },
    }
}

/**
 * 创建空的沙箱上下文（用于测试）
 */
export function createEmptySandboxContext(pluginId: string): SandboxContext {
    return createSandboxContext({
        pluginId,
        grantedPermissions: [],
        services: {
            fetch: () => Promise.reject(new Error('fetch not available')),
            getEnv: () => undefined,
            sendEmail: () => Promise.reject(new Error('sendEmail not available')),
            invokeLLM: () => Promise.reject(new Error('invokeLLM not available')),
            searchKnowledge: () => Promise.reject(new Error('searchKnowledge not available')),
        },
    })
}
