/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { useCallback, useMemo, useRef, useState } from 'react'

import { getAvailableNodeOutputs } from '@/components/flow/settings/node-outputs'
import type { NodeSettingsFormProps } from '@/components/flow/settings/types'

import { ComponentSandbox, createSandboxConfigFromPermissions, RemoteComponent } from '../component-loader'
import { SchemaForm } from '../schema-form'
import type { AvailableNodeOutput, ExtendedJSONSchema7 } from '../schema-form/types'

/**
 * 插件节点的配置数据
 */
interface PluginNodeData {
    /** 节点标签 */
    label: string
    /** 节点配置 */
    config?: Record<string, unknown>
    /** 插件 ID */
    pluginId: string
    /** 插件类型（节点类型） */
    pluginType: string
    /** 配置 Schema */
    configSchema?: ExtendedJSONSchema7
    /** 自定义组件 URL */
    customComponentUrl?: string
    /** 自定义组件名称 */
    customComponentName?: string
    /** 插件权限列表 */
    permissions?: string[]
}

interface PluginNodeSettingsContentProps {
    node: NodeSettingsFormProps['node']
    nodeData: PluginNodeData
    schema?: ExtendedJSONSchema7
    availableVariables: AvailableNodeOutput[]
    onSave?: NodeSettingsFormProps['onSave']
}

function PluginNodeSettingsContent({ node, nodeData, schema, availableVariables, onSave }: PluginNodeSettingsContentProps) {
    const [labelValue, setLabelValue] = useState(nodeData.label || '插件节点')
    const [formData, setFormData] = useState<Record<string, unknown>>(() => nodeData.config || {})
    const lastSavedRef = useRef(
        JSON.stringify({
            label: nodeData.label || '插件节点',
            config: nodeData.config || {},
        })
    )

    // 处理表单数据变化
    const handleFormChange = useCallback((data: Record<string, unknown>) => {
        setFormData(data)
    }, [])

    const commitDraft = useCallback(() => {
        const payload = {
            label: labelValue || nodeData.label || '插件节点',
            config: formData,
        }
        const serialized = JSON.stringify(payload)

        if (serialized === lastSavedRef.current) {
            return
        }

        lastSavedRef.current = serialized
        onSave?.(payload)
    }, [formData, labelValue, nodeData.label, onSave])

    const handleContainerBlur = useCallback(
        (event: React.FocusEvent<HTMLDivElement>) => {
            const nextTarget = event.relatedTarget

            if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
                return
            }

            commitDraft()
        },
        [commitDraft]
    )

    const hasCustomComponent = nodeData.customComponentUrl && nodeData.customComponentName
    const sandboxConfig = useMemo(() => {
        return createSandboxConfigFromPermissions(nodeData.permissions || [])
    }, [nodeData.permissions])

    if (!schema) {
        return (
            <div className="p-4" onBlurCapture={handleContainerBlur}>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">节点名称</label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 border rounded-md text-sm"
                            value={labelValue}
                            onChange={event => setLabelValue(event.target.value)}
                        />
                    </div>
                    <p className="text-sm text-muted-foreground">该插件节点没有可配置的参数。</p>
                </div>
            </div>
        )
    }

    if (hasCustomComponent) {
        return (
            <div className="p-4 space-y-4" onBlurCapture={handleContainerBlur}>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">节点名称</label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 border rounded-md text-sm"
                            value={labelValue}
                            onChange={event => setLabelValue(event.target.value)}
                        />
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-sm font-medium text-foreground">参数配置</h3>
                        <ComponentSandbox
                            pluginId={nodeData.pluginId}
                            nodeId={node.id}
                            config={sandboxConfig}
                            onError={error => {
                                // eslint-disable-next-line no-console
                                console.error('Plugin component error:', error)
                            }}
                        >
                            <RemoteComponent
                                url={nodeData.customComponentUrl!}
                                componentName={nodeData.customComponentName!}
                                componentProps={{
                                    value: formData,
                                    onChange: handleFormChange,
                                    schema,
                                    availableVariables,
                                    disabled: false,
                                }}
                            />
                        </ComponentSandbox>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="p-4 space-y-4" onBlurCapture={handleContainerBlur}>
            <div className="space-y-4">
                <div className="space-y-2">
                    <label className="text-sm font-medium">节点名称</label>
                    <input
                        type="text"
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        value={labelValue}
                        onChange={event => setLabelValue(event.target.value)}
                    />
                </div>

                <div className="space-y-4">
                    <h3 className="text-sm font-medium text-foreground">参数配置</h3>
                    <SchemaForm schema={schema} values={formData} onChange={handleFormChange} availableVariables={availableVariables} />
                </div>
            </div>
        </div>
    )
}

/**
 * PluginNodeSettings - 插件节点设置组件
 * 基于 JSON Schema 动态生成表单
 */
export function PluginNodeSettings({ node, onSave, flowContext }: NodeSettingsFormProps) {
    const nodeData = node.data as unknown as PluginNodeData
    const schema = nodeData.configSchema

    const availableVariables: AvailableNodeOutput[] = useMemo(() => {
        if (!flowContext) return []

        const outputs = getAvailableNodeOutputs(node.id, flowContext.nodes, flowContext.edges)
        return outputs.map(o => ({
            nodeId: o.nodeId,
            nodeTitle: o.nodeLabel,
            nodeType: o.nodeType,
            outputs: o.outputs.map(out => ({
                name: out.name,
                type: out.type,
                description: out.description,
            })),
        }))
    }, [node.id, flowContext])

    return (
        <PluginNodeSettingsContent
            key={node.id}
            node={node}
            nodeData={nodeData}
            schema={schema}
            availableVariables={availableVariables}
            onSave={onSave}
        />
    )
}

/**
 * 创建插件节点设置组件的选项
 */
interface CreatePluginNodeSettingsOptions {
    /** 插件 ID */
    pluginId: string
    /** 节点类型 */
    nodeType: string
    /** 配置 Schema */
    configSchema: ExtendedJSONSchema7
    /** 自定义组件 URL（可选） */
    customComponentUrl?: string
    /** 自定义组件名称（可选） */
    customComponentName?: string
    /** 插件权限列表 */
    permissions?: string[]
}

/**
 * 创建插件节点设置组件工厂
 * 用于为每个插件类型创建专属的设置组件
 *
 * @example
 * ```typescript
 * const EmailSettingsComponent = createPluginNodeSettingsComponent({
 *     pluginId: '@miaoma/email-sender',
 *     nodeType: 'email-send',
 *     configSchema: emailNodeSchema,
 *     customComponentUrl: 'https://cdn.example.com/email-plugin/components.umd.js',
 *     customComponentName: 'EmailSettings',
 *     permissions: ['network'],
 * })
 * ```
 */
export function createPluginNodeSettingsComponent(options: CreatePluginNodeSettingsOptions) {
    const { pluginId, nodeType, configSchema, customComponentUrl, customComponentName, permissions } = options

    return function PluginNodeSettingsWrapper(props: NodeSettingsFormProps) {
        // 确保 schema 和组件信息存在于 node.data 中
        const enhancedNode = {
            ...props.node,
            data: {
                ...props.node.data,
                pluginId,
                pluginType: nodeType,
                configSchema,
                customComponentUrl,
                customComponentName,
                permissions,
            },
        }

        return <PluginNodeSettings {...props} node={enhancedNode} />
    }
}
