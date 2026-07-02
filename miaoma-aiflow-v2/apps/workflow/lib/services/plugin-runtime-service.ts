/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import {
    createHybridRetriever,
    createOllamaEmbeddingService,
    createQdrantVectorStore,
    type FulltextSearchProvider,
    type RetrievalResult,
    type WorkflowDefinition,
} from '@miaoma-aiflow/ai-engine'
import type { PluginPermission } from '@miaoma-aiflow/plugin-core'
import {
    type AiEngineLike,
    parsePluginNodeType,
    type PluginInstallationRecord,
    PluginLoader,
    PluginRuntimeAiEngineError,
    registerPluginNodesForAiEngine,
} from '@miaoma-aiflow/plugin-runtime'

import { ApiError, ErrorCode } from '@/lib/api-response'
import { sendEmail as sendPlatformEmail } from '@/lib/email'
import { prisma } from '@/lib/prisma'

export type WorkflowEngineLike = AiEngineLike

export async function registerRemotePluginNodesForWorkflow(options: {
    engine: WorkflowEngineLike
    workflow: WorkflowDefinition
    userId: string
}): Promise<void> {
    const pluginIds = Array.from(
        new Set(
            options.workflow.nodes
                .map(node => parsePluginNodeType(node.type)?.pluginId)
                .filter((pluginId): pluginId is string => Boolean(pluginId))
        )
    )

    if (pluginIds.length === 0) {
        return
    }

    const installations = await loadPluginInstallations(options.userId, pluginIds)
    const loader = new PluginLoader({
        cdn: {
            baseUrl: '',
        },
        services: createWorkflowPluginHostServices(options.userId),
    })

    try {
        await registerPluginNodesForAiEngine({
            engine: options.engine,
            workflow: options.workflow,
            installations,
            loader,
        })
    } catch (error) {
        throw mapPluginRuntimeError(error)
    }
}

async function loadPluginInstallations(userId: string, pluginIds: string[]): Promise<PluginInstallationRecord[]> {
    const installations = await prisma.pluginInstallation.findMany({
        where: {
            userId,
            isEnabled: true,
            plugin: {
                pluginId: {
                    in: pluginIds,
                },
            },
        },
        include: {
            plugin: {
                select: {
                    pluginId: true,
                },
            },
            version: {
                select: {
                    version: true,
                    permissions: true,
                    manifestUrl: true,
                    executorUrl: true,
                },
            },
        },
    })

    return installations.map(installation => ({
        pluginId: installation.plugin.pluginId,
        version: installation.version.version,
        permissions: installation.version.permissions as PluginPermission[],
        manifestUrl: installation.version.manifestUrl,
        executorUrl: installation.version.executorUrl,
    }))
}

function mapPluginRuntimeError(error: unknown): Error {
    if (!(error instanceof PluginRuntimeAiEngineError)) {
        return error instanceof Error ? error : new Error(String(error))
    }

    switch (error.code) {
        case 'PLUGIN_NOT_INSTALLED':
            return new ApiError(ErrorCode.PLUGIN_NOT_INSTALLED, error.message)
        case 'PLUGIN_PERMISSION_DENIED':
            return new ApiError(ErrorCode.PLUGIN_PERMISSION_DENIED, error.message)
        case 'PLUGIN_EXECUTOR_NOT_FOUND':
            return new ApiError(ErrorCode.PLUGIN_VERSION_NOT_FOUND, error.message)
        case 'PLUGIN_LOAD_FAILED':
        default:
            return new Error(error.message)
    }
}

function createWorkflowPluginHostServices(userId: string) {
    return {
        fetch: globalThis.fetch,
        getEnv: (key: string) => {
            return process.env[key]
        },
        sendEmail: async (options: { to: string; subject: string; html: string }) => {
            return sendPlatformEmail(options)
        },
        invokeLLM: async (options: {
            model?: string
            systemPrompt?: string
            userMessage: string
            temperature?: number
            maxTokens?: number
        }) => {
            const response = await fetch(`${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: options.model || 'qwen3.5:9b',
                    stream: false,
                    messages: [
                        ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
                        { role: 'user', content: options.userMessage },
                    ],
                    options: {
                        temperature: options.temperature,
                        num_predict: options.maxTokens,
                    },
                }),
            })

            if (!response.ok) {
                throw new Error(`插件 LLM 调用失败: ${response.status} ${response.statusText}`)
            }

            const data = (await response.json()) as {
                message?: { content?: string }
                prompt_eval_count?: number
                eval_count?: number
            }

            const promptTokens = data.prompt_eval_count || 0
            const completionTokens = data.eval_count || 0

            return {
                text: data.message?.content || '',
                usage: {
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens,
                },
            }
        },
        searchKnowledge: async (options: { knowledgeBaseIds: string[]; query: string; topK?: number; threshold?: number }) => {
            const knowledgeBases = await prisma.knowledgeBase.findMany({
                where: {
                    id: {
                        in: options.knowledgeBaseIds,
                    },
                    userId,
                },
            })

            if (knowledgeBases.length !== options.knowledgeBaseIds.length) {
                throw new Error('插件无权访问部分知识库')
            }

            const primaryKnowledgeBase = knowledgeBases[0]
            if (!primaryKnowledgeBase) {
                return { documents: [] }
            }

            const embeddingService = createOllamaEmbeddingService({
                model: primaryKnowledgeBase.embeddingModel,
                dimensions: primaryKnowledgeBase.dimensions,
            })

            const vectorStore = createQdrantVectorStore({
                url: process.env.QDRANT_URL || 'http://localhost:6333',
                collectionName: 'knowledge_chunks',
            })

            const fulltextProvider: FulltextSearchProvider = {
                async search(searchOptions): Promise<RetrievalResult[]> {
                    const results = await (vectorStore as any).textSearch({
                        query: searchOptions.query,
                        knowledgeBaseIds: searchOptions.knowledgeBaseIds,
                        topK: searchOptions.topK,
                    })

                    return results.map((item: any) => ({
                        chunkId: item.chunkId,
                        content: item.content,
                        chunkIndex: item.chunkIndex,
                        documentId: item.documentId,
                        knowledgeBaseId: item.knowledgeBaseId,
                        score: item.score,
                        metadata: item.metadata,
                    }))
                },
            }

            const retriever = createHybridRetriever(embeddingService, vectorStore, fulltextProvider)
            const results = await retriever.retrieve({
                query: options.query,
                knowledgeBaseIds: options.knowledgeBaseIds,
                mode: 'hybrid',
                topK: options.topK || primaryKnowledgeBase.topK,
                threshold: options.threshold ?? primaryKnowledgeBase.threshold,
                vectorWeight: primaryKnowledgeBase.vectorWeight,
            })

            return {
                documents: results.map(result => ({
                    id: result.chunkId,
                    content: result.content,
                    score: result.score,
                    metadata: {
                        documentId: result.documentId,
                        knowledgeBaseId: result.knowledgeBaseId,
                        chunkIndex: result.chunkIndex,
                        ...result.metadata,
                    },
                })),
            }
        },
    }
}
