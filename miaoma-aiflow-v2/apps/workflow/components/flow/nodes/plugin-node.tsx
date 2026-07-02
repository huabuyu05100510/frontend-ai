import type { NodeProps } from '@xyflow/react'
import { Position } from '@xyflow/react'
import clsx from 'clsx'

import { PluginIcon } from '@/components/plugin/plugin-icon'
import type { ExtendedJSONSchema7 } from '@/components/plugin/schema-form/types'

import { Handle } from '../handle'

interface PluginNodeOutput {
    name: string
    type: string
    description?: string
}

interface PluginFlowNodeData {
    label?: string
    pluginId?: string
    pluginType?: string
    icon?: string
    color?: string
    outputs?: PluginNodeOutput[]
    config?: Record<string, unknown>
    configSchema?: ExtendedJSONSchema7
}

export function PluginFlowNode({ data, selected }: NodeProps) {
    const nodeData = (data || {}) as PluginFlowNodeData
    const label = nodeData.label || nodeData.pluginType || '插件节点'
    const color = nodeData.color || '#4F46E5'
    const outputs = Array.isArray(nodeData.outputs) ? nodeData.outputs : []
    const summaryItems = getPluginSummaryItems(nodeData)

    return (
        <div
            className={clsx('rounded-xl border bg-white shadow-md p-3 w-64')}
            style={{
                borderColor: selected ? color : 'transparent',
            }}
        >
            <div className="flex items-center mb-3">
                <div
                    className="mr-3 text-white rounded-lg p-2 shadow-sm flex items-center justify-center"
                    style={{ backgroundColor: color }}
                >
                    <PluginIcon icon={nodeData.icon} size={14} className="text-white" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="font-bold truncate">{label}</div>
                    {nodeData.pluginId && <div className="text-xs text-gray-500 truncate">{nodeData.pluginId}</div>}
                </div>
            </div>

            <div className="space-y-2">
                {summaryItems.length > 0
                    ? summaryItems.map(item => (
                          <div key={item.label} className="flex items-center gap-2">
                              <span className="text-xs text-gray-600 w-12 shrink-0">{item.label}</span>
                              <span className="flex-1 rounded-md py-1 text-sm bg-[#f2f4f7] px-2 truncate">{item.value}</span>
                          </div>
                      ))
                    : outputs.length > 0 && (
                          <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-600 w-12">输出</span>
                              <span className="flex-1 rounded-md py-1 text-sm bg-[#f2f4f7] px-2">{outputs.length} 个字段</span>
                          </div>
                      )}
            </div>

            <Handle type="target" position={Position.Left} />
            <Handle type="source" position={Position.Right} />
        </div>
    )
}

interface SummaryItem {
    label: string
    value: string
}

function getPluginSummaryItems(nodeData: PluginFlowNodeData): SummaryItem[] {
    return getGenericConfigSummary(nodeData.config, nodeData.configSchema)
}

function getGenericConfigSummary(config?: Record<string, unknown>, schema?: ExtendedJSONSchema7): SummaryItem[] {
    const properties = schema?.properties
    if (!config || !properties) {
        return []
    }

    return Object.entries(properties)
        .map(([key, propertySchema]) => ({
            key,
            schema: propertySchema as ExtendedJSONSchema7,
            order: (propertySchema as ExtendedJSONSchema7)['x-order'] ?? Number.MAX_SAFE_INTEGER,
        }))
        .sort((left, right) => left.order - right.order)
        .map(item => {
            const formatted = formatSummaryValue(item.key, config[item.key])
            if (!formatted) {
                return null
            }

            return {
                label: typeof item.schema.title === 'string' && item.schema.title.trim() ? item.schema.title : item.key,
                value: formatted,
            }
        })
        .filter((item): item is SummaryItem => Boolean(item))
        .slice(0, 4)
}

function formatSummaryValue(key: string, value: unknown): string | null {
    if (value === null || value === undefined) {
        return null
    }

    if (typeof value === 'boolean') {
        return value ? '是' : '否'
    }

    if (typeof value === 'number') {
        return String(value)
    }

    if (typeof value === 'string') {
        const text = value.trim()
        if (!text) {
            return null
        }

        if (isRecipientField(key)) {
            return summarizeRecipientList(text)
        }

        if (isLongTextField(key)) {
            return '已填写'
        }

        return truncateText(text, 28)
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return null
        }

        return `${value.length} 项`
    }

    if (typeof value === 'object') {
        return '已配置'
    }

    return null
}

function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function summarizeRecipientList(value: unknown): string {
    const list = typeof value === 'string' ? value : ''
    const recipients = list
        .split(/[\n,;]+/g)
        .map(item => item.trim())
        .filter(Boolean)

    if (recipients.length === 0) {
        return ''
    }

    if (recipients.length === 1) {
        return truncateText(recipients[0], 24)
    }

    return `${truncateText(recipients[0], 18)} 等 ${recipients.length} 人`
}

function truncateText(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value
}

function isLongTextField(key: string): boolean {
    return ['text', 'html', 'content', 'body', 'template', 'prompt', 'message'].includes(key)
}

function isRecipientField(key: string): boolean {
    return ['to', 'cc', 'bcc', 'replyTo'].includes(key)
}
