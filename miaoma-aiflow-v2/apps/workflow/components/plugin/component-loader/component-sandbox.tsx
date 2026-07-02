/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { AlertCircle } from 'lucide-react'
import React, { Component, ErrorInfo, ReactNode } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

/**
 * 错误边界状态
 */
interface ErrorBoundaryState {
    hasError: boolean
    error: Error | null
    errorInfo: ErrorInfo | null
}

/**
 * 错误边界属性
 */
interface ErrorBoundaryProps {
    children: ReactNode
    /** 自定义错误显示 */
    fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
    /** 错误回调 */
    onError?: (error: Error, errorInfo: ErrorInfo) => void
    /** 组件标识（用于日志） */
    componentId?: string
}

/**
 * 错误边界组件 - 捕获子组件的 JavaScript 错误
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props)
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
        }
    }

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        this.setState({ errorInfo })
        this.props.onError?.(error, errorInfo)

        // 记录错误日志
        // eslint-disable-next-line no-console
        console.error(`[ComponentSandbox] 组件错误 ${this.props.componentId || ''}:`, error, errorInfo)
    }

    handleReset = () => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null,
        })
    }

    render(): React.ReactNode {
        if (this.state.hasError) {
            const { fallback } = this.props
            const { error } = this.state

            // 使用自定义 fallback
            if (fallback) {
                if (typeof fallback === 'function' && error) {
                    return fallback(error, this.handleReset) as React.ReactNode
                }
                return fallback as React.ReactNode
            }

            // 默认错误显示
            return (
                <Alert variant="destructive" className="m-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>组件运行错误</AlertTitle>
                    <AlertDescription className="mt-2 space-y-2">
                        <p className="text-sm">{error?.message || '组件发生未知错误'}</p>
                        <Button variant="outline" size="sm" onClick={this.handleReset}>
                            重试
                        </Button>
                    </AlertDescription>
                </Alert>
            )
        }

        return this.props.children
    }
}

/**
 * 沙箱配置
 */
interface SandboxConfig {
    /** 是否允许访问 localStorage */
    allowLocalStorage?: boolean
    /** 是否允许访问 sessionStorage */
    allowSessionStorage?: boolean
    /** 是否允许网络请求 */
    allowFetch?: boolean
    /** 允许的域名列表（用于网络请求） */
    allowedDomains?: string[]
    /** 超时时间（毫秒） */
    timeout?: number
}

/**
 * 沙箱上下文
 */
interface SandboxContext {
    /** 插件 ID */
    pluginId: string
    /** 节点 ID */
    nodeId?: string
    /** 沙箱配置 */
    config: SandboxConfig
    /** 安全的 API */
    api: {
        /** 受限的 fetch */
        fetch: typeof fetch
        /** 受限的 localStorage */
        localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
        /** 受限的 console */
        console: Pick<Console, 'log' | 'warn' | 'error' | 'info'>
    }
}

const SandboxReactContext = React.createContext<SandboxContext | null>(null)

/**
 * 获取沙箱上下文
 */
export function useSandboxContext(): SandboxContext | null {
    return React.useContext(SandboxReactContext)
}

/**
 * 创建受限的 fetch
 */
function createRestrictedFetch(config: SandboxConfig, pluginId: string): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!config.allowFetch) {
            throw new Error(`插件 ${pluginId} 没有网络请求权限`)
        }

        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const urlObj = new URL(url)

        // 检查域名是否在允许列表中
        if (config.allowedDomains && config.allowedDomains.length > 0) {
            const isAllowed = config.allowedDomains.some(domain => urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`))
            if (!isAllowed) {
                throw new Error(`插件 ${pluginId} 不允许访问域名: ${urlObj.hostname}`)
            }
        }

        // 添加超时
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), config.timeout || 30000)

        try {
            return await fetch(input, {
                ...init,
                signal: controller.signal,
            })
        } finally {
            clearTimeout(timeoutId)
        }
    }
}

/**
 * 创建受限的 localStorage
 */
function createRestrictedStorage(config: SandboxConfig, pluginId: string): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
    const prefix = `plugin:${pluginId}:`

    return {
        getItem: (key: string) => {
            if (!config.allowLocalStorage) {
                throw new Error(`插件 ${pluginId} 没有本地存储读取权限`)
            }
            return localStorage.getItem(prefix + key)
        },
        setItem: (key: string, value: string) => {
            if (!config.allowLocalStorage) {
                throw new Error(`插件 ${pluginId} 没有本地存储写入权限`)
            }
            localStorage.setItem(prefix + key, value)
        },
        removeItem: (key: string) => {
            if (!config.allowLocalStorage) {
                throw new Error(`插件 ${pluginId} 没有本地存储删除权限`)
            }
            localStorage.removeItem(prefix + key)
        },
    }
}

/**
 * 创建受限的 console
 */
function createRestrictedConsole(pluginId: string): Pick<Console, 'log' | 'warn' | 'error' | 'info'> {
    const prefix = `[Plugin:${pluginId}]`

    return {
        // eslint-disable-next-line no-console
        log: (...args: unknown[]) => console.log(prefix, ...args),
        // eslint-disable-next-line no-console
        warn: (...args: unknown[]) => console.warn(prefix, ...args),
        // eslint-disable-next-line no-console
        error: (...args: unknown[]) => console.error(prefix, ...args),
        // eslint-disable-next-line no-console
        info: (...args: unknown[]) => console.info(prefix, ...args),
    }
}

interface ComponentSandboxProps {
    /** 子组件 */
    children: ReactNode
    /** 插件 ID */
    pluginId: string
    /** 节点 ID */
    nodeId?: string
    /** 沙箱配置 */
    config?: SandboxConfig
    /** 自定义错误显示 */
    errorFallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
    /** 错误回调 */
    onError?: (error: Error, errorInfo: ErrorInfo) => void
}

/**
 * ComponentSandbox - 组件沙箱容器
 *
 * 提供：
 * 1. 错误边界 - 捕获组件错误，防止影响整个应用
 * 2. 受限 API - 提供安全的、受控的 API 访问
 * 3. 隔离上下文 - 每个插件有独立的上下文
 *
 * @example
 * ```tsx
 * <ComponentSandbox
 *     pluginId="@miaoma/email-sender"
 *     nodeId="email-1"
 *     config={{ allowFetch: true, allowedDomains: ['api.example.com'] }}
 * >
 *     <RemoteComponent url="..." componentName="EmailPreview" />
 * </ComponentSandbox>
 * ```
 */
export function ComponentSandbox({ children, pluginId, nodeId, config = {}, errorFallback, onError }: ComponentSandboxProps) {
    // 创建沙箱上下文
    const sandboxContext: SandboxContext = React.useMemo(
        () => ({
            pluginId,
            nodeId,
            config,
            api: {
                fetch: createRestrictedFetch(config, pluginId),
                localStorage: createRestrictedStorage(config, pluginId),
                console: createRestrictedConsole(pluginId),
            },
        }),
        [pluginId, nodeId, config]
    )

    return (
        <ErrorBoundary fallback={errorFallback} onError={onError} componentId={`${pluginId}:${nodeId || 'unknown'}`}>
            <SandboxReactContext.Provider value={sandboxContext}>{children}</SandboxReactContext.Provider>
        </ErrorBoundary>
    )
}

/**
 * 默认沙箱配置
 */
export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
    allowLocalStorage: false,
    allowSessionStorage: false,
    allowFetch: false,
    allowedDomains: [],
    timeout: 30000,
}

/**
 * 根据插件权限创建沙箱配置
 */
export function createSandboxConfigFromPermissions(permissions: string[]): SandboxConfig {
    return {
        allowLocalStorage: permissions.includes('storage'),
        allowSessionStorage: permissions.includes('storage'),
        allowFetch: permissions.includes('network'),
        allowedDomains: [], // 可以从插件 manifest 中获取
        timeout: 30000,
    }
}
