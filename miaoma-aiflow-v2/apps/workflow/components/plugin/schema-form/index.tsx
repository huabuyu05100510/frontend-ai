/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { useCallback, useMemo } from 'react'

import { cn } from '@/lib/utils'

import { FieldRenderer } from './field-renderer'
import type { ExtendedJSONSchema7, SchemaFormProps } from './types'

/**
 * SchemaForm - 基于 JSON Schema 自动生成表单
 *
 * 支持特性：
 * - 基础类型：string, number, boolean, integer
 * - 复杂类型：object, array
 * - 枚举选择：enum
 * - 变量引用：x-variable
 * - 自定义组件：x-component
 * - 字段分组：x-group
 * - 字段排序：x-order
 */
export function SchemaForm({
    schema,
    values,
    defaultValues = {},
    onChange,
    availableVariables,
    disabled = false,
    className,
}: SchemaFormProps) {
    const formData = useMemo(() => {
        return initializeFormData(schema, values ?? defaultValues)
    }, [defaultValues, schema, values])

    // 处理字段值变化
    const handleFieldChange = useCallback(
        (name: string, value: unknown) => {
            const newData = { ...formData, [name]: value }
            onChange?.(newData)
        },
        [formData, onChange]
    )

    // 获取排序后的字段列表
    const sortedFields = useMemo(() => {
        if (!schema.properties) return []

        const fields = Object.entries(schema.properties).map(([name, fieldSchema]) => ({
            name,
            schema: fieldSchema as ExtendedJSONSchema7,
            order: (fieldSchema as ExtendedJSONSchema7)['x-order'] ?? 999,
            group: (fieldSchema as ExtendedJSONSchema7)['x-group'],
        }))

        // 按 order 排序
        return fields.sort((a, b) => a.order - b.order)
    }, [schema.properties])

    // 按分组组织字段
    const groupedFields = useMemo(() => {
        const groups: Record<string, typeof sortedFields> = {}
        const ungrouped: typeof sortedFields = []

        for (const field of sortedFields) {
            if (field.group) {
                if (!groups[field.group]) {
                    groups[field.group] = []
                }
                groups[field.group].push(field)
            } else {
                ungrouped.push(field)
            }
        }

        return { groups, ungrouped }
    }, [sortedFields])

    // 检查字段是否必填
    const isRequired = useCallback(
        (fieldName: string) => {
            return Array.isArray(schema.required) && schema.required.includes(fieldName)
        },
        [schema.required]
    )

    return (
        <div className={cn('space-y-4', className)}>
            {/* 渲染未分组的字段 */}
            {groupedFields.ungrouped.map(field => {
                if (field.schema['x-hidden']) return null

                return (
                    <FieldRenderer
                        key={field.name}
                        name={field.name}
                        schema={field.schema}
                        value={formData[field.name]}
                        onChange={value => handleFieldChange(field.name, value)}
                        availableVariables={availableVariables}
                        disabled={disabled}
                        required={isRequired(field.name)}
                    />
                )
            })}

            {/* 渲染分组的字段 */}
            {Object.entries(groupedFields.groups).map(([groupName, fields]) => (
                <div key={groupName} className="space-y-3">
                    <h4 className="text-sm font-medium text-muted-foreground">{groupName}</h4>
                    <div className="space-y-4 pl-2 border-l-2 border-muted">
                        {fields.map(field => {
                            if (field.schema['x-hidden']) return null

                            return (
                                <FieldRenderer
                                    key={field.name}
                                    name={field.name}
                                    schema={field.schema}
                                    value={formData[field.name]}
                                    onChange={value => handleFieldChange(field.name, value)}
                                    availableVariables={availableVariables}
                                    disabled={disabled}
                                    required={isRequired(field.name)}
                                />
                            )
                        })}
                    </div>
                </div>
            ))}
        </div>
    )
}

/**
 * 初始化表单数据
 */
function initializeFormData(schema: ExtendedJSONSchema7, defaultValues: Record<string, unknown>): Record<string, unknown> {
    const data: Record<string, unknown> = {}

    if (!schema.properties) return data

    for (const [name, fieldSchema] of Object.entries(schema.properties)) {
        const fs = fieldSchema as ExtendedJSONSchema7

        // 优先使用传入的默认值
        if (name in defaultValues) {
            data[name] = defaultValues[name]
            continue
        }

        // 使用 schema 中的默认值
        if (fs.default !== undefined) {
            data[name] = fs.default
            continue
        }

        // 根据类型设置初始值
        switch (fs.type) {
            case 'string':
                data[name] = ''
                break
            case 'number':
            case 'integer':
                data[name] = fs.minimum ?? 0
                break
            case 'boolean':
                data[name] = false
                break
            case 'array':
                data[name] = []
                break
            case 'object':
                data[name] = {}
                break
            default:
                data[name] = null
        }
    }

    return data
}

// 导出类型
export type { ExtendedJSONSchema7, SchemaFormProps, AvailableNodeOutput } from './types'
