/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import type {
    ExecutionContext,
    ExecutionLogger,
    NodeExecutionResult,
    NodeExecutor,
    NodeKind,
    WorkflowDefinition,
} from '@miaoma-aiflow/ai-engine'
import type { PluginNodeExecutor, PluginPermission } from '@miaoma-aiflow/plugin-core'

import type { PluginLoader, PluginModule } from '../loader'
import { parsePluginNodeType } from '../utils'

export type PluginRuntimeAiEngineErrorCode =
    | 'PLUGIN_NOT_INSTALLED'
    | 'PLUGIN_PERMISSION_DENIED'
    | 'PLUGIN_LOAD_FAILED'
    | 'PLUGIN_EXECUTOR_NOT_FOUND'

export class PluginRuntimeAiEngineError extends Error {
    readonly code: PluginRuntimeAiEngineErrorCode
    readonly details?: Record<string, unknown>

    constructor(code: PluginRuntimeAiEngineErrorCode, message: string, details?: Record<string, unknown>) {
        super(message)
        this.name = 'PluginRuntimeAiEngineError'
        this.code = code
        this.details = details
    }
}

export interface PluginInstallationRecord {
    pluginId: string
    version: string
    permissions: PluginPermission[]
    manifestUrl: string
    executorUrl: string
}

export interface AiEngineLike {
    getRegistry(): {
        register(type: NodeKind, executor: NodeExecutor): void
    }
    workflowValidator?: {
        registerValidator(validator: {
            type: string
            validate(config: Record<string, unknown>): { valid: boolean; errors?: string[] }
        }): void
    }
}

export interface RegisterPluginNodesForAiEngineOptions {
    engine: AiEngineLike
    workflow: WorkflowDefinition
    installations: PluginInstallationRecord[]
    loader: PluginLoader
}

export async function registerPluginNodesForAiEngine(options: RegisterPluginNodesForAiEngineOptions): Promise<void> {
    const pluginNodeEntries = options.workflow.nodes
        .map(node => ({
            node,
            parsed: parsePluginNodeType(node.type),
        }))
        .filter((entry): entry is { node: WorkflowDefinition['nodes'][number]; parsed: { pluginId: string; nodeType: string } } => {
            return Boolean(entry.parsed)
        })

    if (pluginNodeEntries.length === 0) {
        return
    }

    const installationMap = new Map(options.installations.map(item => [item.pluginId, item]))
    const loadedModules = new Map<string, PluginModule>()

    for (const entry of pluginNodeEntries) {
        const installation = installationMap.get(entry.parsed.pluginId)
        if (!installation) {
            throw new PluginRuntimeAiEngineError('PLUGIN_NOT_INSTALLED', `插件未安装或未启用: ${entry.parsed.pluginId}`, {
                pluginId: entry.parsed.pluginId,
            })
        }

        let loadedModule = loadedModules.get(installation.pluginId)
        if (!loadedModule) {
            loadedModule = await loadInstalledPluginModule(options.loader, installation)
            loadedModules.set(installation.pluginId, loadedModule)
        }

        const pluginExecutor = loadedModule.executors.get(entry.parsed.nodeType)
        if (!pluginExecutor) {
            throw new PluginRuntimeAiEngineError(
                'PLUGIN_EXECUTOR_NOT_FOUND',
                `插件 ${installation.pluginId} 中未找到节点执行器: ${entry.parsed.nodeType}`,
                {
                    pluginId: installation.pluginId,
                    version: installation.version,
                    nodeType: entry.parsed.nodeType,
                }
            )
        }

        const fullNodeType = entry.node.type as NodeKind
        options.engine.getRegistry().register(
            fullNodeType,
            createAiEnginePluginExecutor({
                fullNodeType,
                pluginId: installation.pluginId,
                runtimeNodeType: entry.parsed.nodeType,
                pluginExecutor,
                pluginModule: loadedModule,
            })
        )

        options.engine.workflowValidator?.registerValidator({
            type: fullNodeType,
            validate(config: Record<string, unknown>) {
                return pluginExecutor.validate?.(config) || { valid: true }
            },
        })
    }
}

async function loadInstalledPluginModule(loader: PluginLoader, installation: PluginInstallationRecord): Promise<PluginModule> {
    const loadResult = await loader.loadFromUrls({
        pluginId: installation.pluginId,
        version: installation.version,
        manifestUrl: installation.manifestUrl,
        executorUrl: installation.executorUrl,
        grantedPermissions: installation.permissions,
    })

    if (loadResult.success && loadResult.module) {
        return loadResult.module
    }

    if (loadResult.error?.startsWith('Permission denied:')) {
        throw new PluginRuntimeAiEngineError('PLUGIN_PERMISSION_DENIED', loadResult.error, {
            pluginId: installation.pluginId,
            version: installation.version,
        })
    }

    throw new PluginRuntimeAiEngineError(
        'PLUGIN_LOAD_FAILED',
        `加载插件执行器失败: ${installation.pluginId}@${installation.version}${loadResult.error ? ` - ${loadResult.error}` : ''}`,
        {
            pluginId: installation.pluginId,
            version: installation.version,
            error: loadResult.error,
        }
    )
}

function createAiEnginePluginExecutor(options: {
    fullNodeType: NodeKind
    pluginId: string
    runtimeNodeType: string
    pluginExecutor: PluginNodeExecutor
    pluginModule: PluginModule
}): NodeExecutor<Record<string, unknown>> {
    return {
        type: options.fullNodeType,
        async execute(nodeId, config, context, logger): Promise<NodeExecutionResult> {
            const startedAt = Date.now()
            logger.nodeStart(nodeId, options.fullNodeType, config)

            try {
                const resolvedConfig = resolveConfigVariables(config, context, logger)
                const nodeInputs = collectNodeInputs(nodeId, context)
                const pluginLogger = createPluginLogger(options.pluginId, logger)

                const result = await options.pluginExecutor.execute({
                    nodeId,
                    nodeType: options.runtimeNodeType,
                    workflowId: context.workflow.id,
                    executionId: context.executionId,
                    inputs: nodeInputs,
                    config: resolvedConfig,
                    logger: pluginLogger,
                    services: options.pluginModule.sandbox.getServices(),
                })

                const outputs = isRecord(result.outputs) ? result.outputs : {}
                const finalResult: NodeExecutionResult = {
                    success: result.success,
                    outputs,
                    error: result.success ? undefined : new Error(result.error || '插件执行失败'),
                    duration: Date.now() - startedAt,
                }

                if (finalResult.success) {
                    context.variables.setNodeOutputs(nodeId, outputs)
                }

                logger.nodeEnd(nodeId, finalResult)
                return finalResult
            } catch (error) {
                const finalResult: NodeExecutionResult = {
                    success: false,
                    outputs: {},
                    error: error instanceof Error ? error : new Error(String(error)),
                    duration: Date.now() - startedAt,
                }

                logger.nodeEnd(nodeId, finalResult)
                return finalResult
            }
        },
        validate(config) {
            return options.pluginExecutor.validate?.(config) || { valid: true }
        },
    }
}

function createPluginLogger(pluginId: string, logger: ExecutionLogger) {
    return {
        debug(message: string, ...args: unknown[]) {
            logger.debug(`[Plugin:${pluginId}] ${message}`, toLogData(args))
        },
        info(message: string, ...args: unknown[]) {
            logger.info(`[Plugin:${pluginId}] ${message}`, toLogData(args))
        },
        warn(message: string, ...args: unknown[]) {
            logger.warn(`[Plugin:${pluginId}] ${message}`, toLogData(args))
        },
        error(message: string, ...args: unknown[]) {
            logger.error(`[Plugin:${pluginId}] ${message}`, toLogData(args))
        },
    }
}

function collectNodeInputs(nodeId: string, context: ExecutionContext): Record<string, unknown> {
    const nodeInputs: Record<string, unknown> = {}

    for (const upstreamNodeId of context.getUpstreamNodes(nodeId)) {
        const outputs = context.variables.getNodeOutputs(upstreamNodeId)
        if (outputs) {
            Object.assign(nodeInputs, outputs)
        }
    }

    return nodeInputs
}

function resolveConfigVariables(
    config: Record<string, unknown>,
    context: ExecutionContext,
    logger: ExecutionLogger
): Record<string, unknown> {
    return deepResolve(config, context, logger) as Record<string, unknown>
}

function deepResolve(value: unknown, context: ExecutionContext, logger: ExecutionLogger): unknown {
    if (typeof value === 'string') {
        const resolved = context.resolveText(value)
        if (resolved !== value) {
            logger.variableResolve(value, value, resolved)
        }
        return resolved
    }

    if (Array.isArray(value)) {
        return value.map(item => deepResolve(item, context, logger))
    }

    if (isRecord(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepResolve(item, context, logger)]))
    }

    return value
}

function toLogData(args: unknown[]): Record<string, unknown> | undefined {
    if (args.length === 0) {
        return undefined
    }

    return {
        args,
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
