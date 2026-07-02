import { BookOpen, Brain, GitBranch, Globe, HomeIcon, type LucideIcon, Puzzle, Terminal } from 'lucide-react'

import type { BuiltInNodeKind } from './settings/types'

/**
 * 内置节点类型的图标映射
 */
export const ICON_MAP: Record<BuiltInNodeKind, LucideIcon> = {
    start: HomeIcon,
    llm: Brain,
    http: Globe,
    end: Terminal,
    condition: GitBranch,
    knowledge: BookOpen,
}

/**
 * 获取节点类型的图标组件
 * 如果是内置节点类型，返回对应图标；否则返回插件图标
 */
export function getIconComponent(type: string): LucideIcon {
    if (type in ICON_MAP) {
        return ICON_MAP[type as BuiltInNodeKind]
    }
    // 插件节点使用 Puzzle 图标作为默认
    return Puzzle
}

export function getIcon(type: string) {
    switch (type) {
        case 'start':
            return <HomeIcon size={14} />
        case 'llm':
            return <Brain size={14} />
        case 'http':
            return <Globe size={14} />
        case 'end':
            return <Terminal size={14} />
        case 'condition':
            return <GitBranch size={14} />
        case 'knowledge':
            return <BookOpen size={14} />
        default:
            // 插件节点使用 Puzzle 图标
            return <Puzzle size={14} />
    }
}

export const getColor = (type: string) => {
    switch (type) {
        case 'start':
            return 'bg-blue-700'
        case 'llm':
            return 'bg-purple-700'
        case 'http':
            return 'bg-green-700'
        case 'end':
            return 'bg-orange-700'
        case 'condition':
            return 'bg-purple-700'
        case 'knowledge':
            return 'bg-cyan-700'
        default:
            // 插件节点使用 indigo 色
            return 'bg-indigo-600'
    }
}
