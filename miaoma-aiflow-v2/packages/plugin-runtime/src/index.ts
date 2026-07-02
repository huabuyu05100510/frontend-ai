/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

/**
 * @miaoma-aiflow/plugin-runtime
 *
 * 妙码 AI Flow 插件运行时包
 *
 * 提供插件加载、执行和沙箱隔离功能：
 * - CDN 资源获取器
 * - 插件加载器
 * - 权限代理
 * - 沙箱上下文
 */

// Loader
export { CDNFetcher, PluginLoader } from './loader'
export type {
    CDNFetcherConfig,
    PluginResource,
    PluginRemoteAssetUrls,
    FetchResult,
    PluginModule,
    PluginLoaderConfig,
    PluginLoaderServices,
    PluginLoaderRemoteLoadOptions,
    LoadResult,
} from './loader'

// Sandbox
export { createPermissionProxy, PermissionChecker, PermissionDeniedError, createSandboxContext, createEmptySandboxContext } from './sandbox'
export type { PermissionProxyConfig, SandboxContext, SandboxContextConfig } from './sandbox'

// Adapters
export { PluginRuntimeAiEngineError, registerPluginNodesForAiEngine } from './adapters'
export type {
    AiEngineLike,
    PluginInstallationRecord,
    PluginRuntimeAiEngineErrorCode,
    RegisterPluginNodesForAiEngineOptions,
} from './adapters'

// Utils
export { buildPluginNodeType, isPluginNodeType, parsePluginNodeType, PLUGIN_NODE_PREFIX } from './utils'
export type { ParsedPluginNodeType } from './utils'

// Version
export const PLUGIN_RUNTIME_VERSION = '1.0.0'
