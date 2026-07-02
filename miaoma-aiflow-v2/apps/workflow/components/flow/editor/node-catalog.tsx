/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */
'use client'

import { BookOpen, Brain, GitBranch, Globe, HomeIcon, Terminal } from 'lucide-react'

import type { NodeKind } from '@/components/flow/settings/types'
import { PluginIcon } from '@/components/plugin/plugin-icon'
import type { RegisteredPluginNode } from '@/components/plugin/plugin-registry-client'

export interface EditorNodeItem {
    type: NodeKind
    label: string
    description: string
    icon: React.ReactNode
    disabled?: boolean
    color?: string
}

export const builtInNodeItems: EditorNodeItem[] = [
    {
        type: 'start',
        label: '开始',
        description: '工作流入口，定义输入参数',
        icon: <HomeIcon size={14} />,
        disabled: true,
    },
    {
        type: 'llm',
        label: '大模型',
        description: '调用 LLM 进行文本处理',
        icon: <Brain size={14} />,
    },
    {
        type: 'knowledge',
        label: '知识库',
        description: '从知识库检索相关内容',
        icon: <BookOpen size={14} />,
    },
    {
        type: 'http',
        label: 'HTTP 请求',
        description: '发送 HTTP 请求',
        icon: <Globe size={14} />,
    },
    {
        type: 'condition',
        label: '条件分支',
        description: '基于 LLM 判断分支',
        icon: <GitBranch size={14} />,
    },
    {
        type: 'end',
        label: '结束',
        description: '工作流出口，返回结果',
        icon: <Terminal size={14} />,
    },
]

export function createPluginNodeItems(pluginNodes: RegisteredPluginNode[]): EditorNodeItem[] {
    return pluginNodes.map(node => ({
        type: `plugin:${node.pluginId}:${node.nodeType}` as NodeKind,
        label: node.name,
        description: node.description || `${node.pluginId} · ${node.nodeType}`,
        icon: <PluginIcon icon={node.icon} size={14} color={node.color} />,
        color: node.color,
    }))
}
