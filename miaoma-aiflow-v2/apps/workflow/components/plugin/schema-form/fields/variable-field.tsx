/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { useMemo } from 'react'

import type { AvailableNodeOutput as FlowAvailableNodeOutput } from '@/components/flow/settings/node-outputs'
import { VariableEditor } from '@/components/flow/settings/variable-editor'
import { Label } from '@/components/ui/label'

import type { VariableFieldProps } from '../types'

/**
 * VariableField - 变量引用字段
 * 支持在文本中插入变量引用，如 ${nodeId.outputName}
 */
export function VariableField({
    name,
    label,
    description,
    placeholder,
    help,
    value,
    onChange,
    disabled,
    required,
    error,
    availableVariables,
    multiline = false,
    minHeight,
}: VariableFieldProps) {
    const stringValue = (value as string) ?? ''

    // 转换变量格式：从插件类型转换为流程编辑器类型
    const availableOutputs: FlowAvailableNodeOutput[] = useMemo(() => {
        if (!availableVariables) return []

        return availableVariables.map(v => ({
            nodeId: v.nodeId,
            nodeType: v.nodeType as FlowAvailableNodeOutput['nodeType'],
            nodeLabel: v.nodeTitle,
            outputs: v.outputs.map(o => ({
                name: o.name,
                label: o.description || o.name,
                type: o.type as FlowAvailableNodeOutput['outputs'][number]['type'],
            })),
        }))
    }, [availableVariables])

    const handleChange = (newValue: string) => {
        onChange(newValue)
    }

    return (
        <div className="space-y-2">
            {label && (
                <Label htmlFor={name} className="text-sm font-medium">
                    {label}
                    {required && <span className="text-destructive ml-1">*</span>}
                </Label>
            )}

            {description && <p className="text-xs text-muted-foreground">{description}</p>}

            <VariableEditor
                value={stringValue}
                onChange={handleChange}
                availableOutputs={availableOutputs}
                placeholder={placeholder || '输入内容，使用 / 插入变量...'}
                minHeight={minHeight || (multiline ? '100px' : '36px')}
                disabled={disabled}
                singleLine={!multiline}
            />

            {help && <p className="text-xs text-muted-foreground">{help}</p>}

            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    )
}
