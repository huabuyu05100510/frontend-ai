'use client'

import { Edge, Node } from '@xyflow/react'
import clsx from 'clsx'
import { X } from 'lucide-react'

import { PluginIcon } from '@/components/plugin/plugin-icon'
import { Button } from '@/components/ui/button'

import { NodeTitleEditor } from '../editor/node-title-editor'
import { getColor, getIcon } from '../icon-map'
import { isPluginNodeType, parsePluginNodeType } from '../plugin-node-utils'
import { DynamicFormRenderer } from './dynamic-form-renderer'
import { FlowContext } from './types'

interface SettingsProps {
    node?: Node | null
    onUpdateNode?: (nodeId: string, data: any) => void
    onUpdateNodeLabel?: (nodeId: string, label: string) => void
    onClose?: () => void
    /** 所有节点 */
    nodes?: Node[]
    /** 所有边 */
    edges?: Edge[]
}

export function Settings({ node, onUpdateNode, onUpdateNodeLabel, onClose, nodes = [], edges = [] }: SettingsProps) {
    const isPlugin = node?.type ? isPluginNodeType(node.type) : false
    const pluginColor = typeof (node?.data as any)?.color === 'string' ? ((node?.data as any)?.color as string) : '#4F46E5'
    const NodeIcon = isPlugin ? (
        <PluginIcon icon={(node?.data as any)?.icon} size={14} className="text-white" />
    ) : (
        node?.type && getIcon(node.type)
    )

    const handleSave = (data: any) => {
        if (node && onUpdateNode) {
            const isPluginNodePayload =
                data &&
                typeof data === 'object' &&
                !Array.isArray(data) &&
                ('config' in data || 'label' in data || 'pluginId' in data || 'pluginType' in data)

            onUpdateNode(node.id, {
                ...node.data,
                ...(isPluginNodePayload ? data : { config: data }),
            })
        }
    }

    const flowContext: FlowContext = {
        nodes,
        edges,
    }

    // 获取节点标题
    const nodeTitle = ((node?.data as any)?.label as string) || getDefaultNodeTitle(node?.type)

    return (
        <div className="w-[400px] flex flex-col items-end max-h-screen">
            {node && (
                <div className="w-full bg-white py-4 rounded-md shadow-md">
                    <div className="flex items-center justify-between px-4 mb-6">
                        <div className="flex items-center gap-2">
                            {node?.type && (
                                <div
                                    className={clsx('text-white rounded-lg p-2 shadow-sm', !isPlugin && node.type && getColor(node.type))}
                                    style={isPlugin ? { backgroundColor: pluginColor } : undefined}
                                >
                                    {NodeIcon}
                                </div>
                            )}
                            <NodeTitleEditor
                                title={nodeTitle}
                                onTitleChange={(newLabel: string) => onUpdateNodeLabel?.(node.id, newLabel)}
                            />
                        </div>
                        <Button variant="ghost" size="icon-sm" onClick={onClose}>
                            <X />
                        </Button>
                    </div>
                    <div className="space-y-4 px-4 overflow-y-auto h-[calc(100vh-190px)]">
                        {node && <DynamicFormRenderer node={node} onSave={handleSave} flowContext={flowContext} />}
                    </div>
                </div>
            )}
        </div>
    )
}

// 默认节点标题
function getDefaultNodeTitle(type?: string): string {
    if (type && isPluginNodeType(type)) {
        const parsed = parsePluginNodeType(type)
        return parsed?.nodeType || '插件节点'
    }

    const titles: Record<string, string> = {
        start: '开始',
        llm: '大模型',
        http: 'HTTP 请求',
        condition: '条件分支',
        end: '结束',
    }
    return titles[type || ''] || '节点'
}
