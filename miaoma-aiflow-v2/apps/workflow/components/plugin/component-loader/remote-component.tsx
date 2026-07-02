/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { AlertCircle, Loader2 } from 'lucide-react'
import React, { useEffect, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/**
 * 远程组件加载状态
 */
type LoadingState = 'idle' | 'loading' | 'success' | 'error'

/**
 * 缓存已加载的组件
 */
const componentCache = new Map<string, React.ComponentType<Record<string, unknown>>>()

/**
 * 缓存正在加载的 Promise
 */
const loadingPromises = new Map<string, Promise<React.ComponentType<Record<string, unknown>>>>()

interface RemoteComponentProps {
    /** UMD bundle URL */
    url: string
    /** 组件名称（导出的组件名） */
    componentName: string
    /** 传递给组件的属性 */
    componentProps?: Record<string, unknown>
    /** 加载中显示的内容 */
    fallback?: React.ReactNode
    /** 错误时显示的内容 */
    errorFallback?: React.ReactNode
    /** 加载超时时间（毫秒） */
    timeout?: number
    /** 加载完成回调 */
    onLoad?: () => void
    /** 错误回调 */
    onError?: (error: Error) => void
}

/**
 * 从 UMD bundle 加载组件
 */
async function loadUMDComponent(
    url: string,
    componentName: string,
    timeout: number = 10000
): Promise<React.ComponentType<Record<string, unknown>>> {
    const cacheKey = `${url}:${componentName}`

    // 检查缓存
    if (componentCache.has(cacheKey)) {
        return componentCache.get(cacheKey)!
    }

    // 检查是否正在加载
    if (loadingPromises.has(cacheKey)) {
        return loadingPromises.get(cacheKey)!
    }

    // 创建加载 Promise
    const loadPromise = new Promise<React.ComponentType<Record<string, unknown>>>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`加载组件超时: ${url}`))
        }, timeout)

        // 创建 script 标签加载 UMD bundle
        const script = document.createElement('script')
        script.src = url
        script.async = true

        script.onload = () => {
            clearTimeout(timeoutId)

            // UMD 模块会将组件挂载到 window 对象上

            const windowWithModules = window as any

            // 尝试获取组件
            let Component: React.ComponentType<Record<string, unknown>> | undefined

            // 检查是否是命名空间导出 (如 window.PluginComponents.EmailPreview)
            if (componentName.includes('.')) {
                const parts = componentName.split('.')
                let current = windowWithModules
                for (const part of parts) {
                    current = current?.[part]
                }
                Component = current
            } else {
                // 直接从 window 获取
                Component = windowWithModules[componentName]
            }

            if (!Component) {
                reject(new Error(`组件 "${componentName}" 未找到，请检查组件名称是否正确`))
                return
            }

            // 缓存组件
            componentCache.set(cacheKey, Component)
            resolve(Component)
        }

        script.onerror = () => {
            clearTimeout(timeoutId)
            reject(new Error(`加载脚本失败: ${url}`))
        }

        document.head.appendChild(script)
    })

    // 缓存加载 Promise
    loadingPromises.set(cacheKey, loadPromise)

    try {
        const component = await loadPromise
        return component
    } finally {
        // 加载完成后删除 Promise 缓存
        loadingPromises.delete(cacheKey)
    }
}

/**
 * RemoteComponent - 动态加载远程 React 组件
 *
 * @example
 * ```tsx
 * <RemoteComponent
 *     url="https://cdn.example.com/plugin/components.umd.js"
 *     componentName="EmailPreview"
 *     componentProps={{ email: emailData }}
 *     fallback={<Skeleton />}
 * />
 * ```
 */
export function RemoteComponent({
    url,
    componentName,
    componentProps = {},
    fallback,
    errorFallback,
    timeout = 10000,
    onLoad,
    onError,
}: RemoteComponentProps) {
    const [state, setState] = useState<LoadingState>('idle')
    const [Component, setComponent] = useState<React.ComponentType<Record<string, unknown>> | null>(null)
    const [error, setError] = useState<Error | null>(null)

    useEffect(() => {
        let mounted = true

        async function load() {
            setState('loading')

            try {
                const LoadedComponent = await loadUMDComponent(url, componentName, timeout)

                if (mounted) {
                    setComponent(() => LoadedComponent)
                    setState('success')
                    onLoad?.()
                }
            } catch (err) {
                if (mounted) {
                    const loadError = err instanceof Error ? err : new Error(String(err))
                    setError(loadError)
                    setState('error')
                    onError?.(loadError)
                }
            }
        }

        load()

        return () => {
            mounted = false
        }
    }, [url, componentName, timeout, onLoad, onError])

    // 加载中
    if (state === 'loading' || state === 'idle') {
        return (
            fallback ?? (
                <div className="flex items-center justify-center p-4">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">加载组件中...</span>
                </div>
            )
        )
    }

    // 加载错误
    if (state === 'error') {
        return (
            errorFallback ?? (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>组件加载失败</AlertTitle>
                    <AlertDescription>{error?.message || '未知错误'}</AlertDescription>
                </Alert>
            )
        )
    }

    // 渲染组件
    if (Component) {
        return <Component {...componentProps} />
    }

    return null
}

/**
 * 预加载远程组件（不渲染）
 */
export async function preloadRemoteComponent(url: string, componentName: string, timeout?: number): Promise<void> {
    await loadUMDComponent(url, componentName, timeout)
}

/**
 * 清除组件缓存
 */
export function clearComponentCache(url?: string, componentName?: string): void {
    if (url && componentName) {
        const cacheKey = `${url}:${componentName}`
        componentCache.delete(cacheKey)
    } else {
        componentCache.clear()
    }
}

/**
 * 检查组件是否已缓存
 */
export function isComponentCached(url: string, componentName: string): boolean {
    const cacheKey = `${url}:${componentName}`
    return componentCache.has(cacheKey)
}
