/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { useMemo } from 'react'

import { ArrayField } from './fields/array-field'
import { BooleanField } from './fields/boolean-field'
import { NumberField } from './fields/number-field'
import { SelectField } from './fields/select-field'
import { StringField } from './fields/string-field'
import { VariableField } from './fields/variable-field'
import type { ExtendedJSONSchema7, FieldRendererProps } from './types'

/**
 * FieldRenderer - 根据 Schema 类型渲染对应字段组件
 */
export function FieldRenderer({ name, schema, value, onChange, availableVariables, disabled, required, parentPath }: FieldRendererProps) {
    // 计算完整路径
    const fullPath = parentPath ? `${parentPath}.${name}` : name

    // 获取字段标签
    const label = schema.title || formatFieldName(name)

    // 获取描述
    const description = schema.description

    // 获取占位符
    const placeholder = schema['x-placeholder'] || ''

    // 获取帮助文本
    const help = schema['x-help']

    // 基础属性
    const baseProps = {
        name: fullPath,
        label,
        description,
        placeholder,
        help,
        value,
        onChange,
        disabled,
        required,
    }

    // 检查是否使用变量字段
    if (schema['x-variable'] && availableVariables) {
        return <VariableField {...baseProps} availableVariables={availableVariables} multiline={schema['x-component'] === 'textarea'} />
    }

    // 检查是否有自定义组件
    if (schema['x-component']) {
        return renderCustomComponent(schema['x-component'], baseProps, schema, availableVariables)
    }

    // 检查是否有枚举（选择字段）
    if (schema.enum) {
        const options = schema.enum.map(val => ({
            label: String(val),
            value: val as string | number,
        }))
        return <SelectField {...baseProps} options={options} />
    }

    // 根据类型渲染
    switch (schema.type) {
        case 'string':
            return (
                <StringField
                    {...baseProps}
                    multiline={schema.maxLength ? schema.maxLength > 100 : false}
                    minLength={schema.minLength}
                    maxLength={schema.maxLength}
                    pattern={schema.pattern}
                />
            )

        case 'number':
        case 'integer':
            return <NumberField {...baseProps} min={schema.minimum} max={schema.maximum} step={schema.type === 'integer' ? 1 : 0.1} />

        case 'boolean':
            return <BooleanField {...baseProps} />

        case 'array':
            return (
                <ArrayField
                    {...baseProps}
                    itemSchema={(schema.items as ExtendedJSONSchema7) || { type: 'string' }}
                    availableVariables={availableVariables}
                    minItems={schema.minItems}
                    maxItems={schema.maxItems}
                />
            )

        case 'object':
            return <ObjectField {...baseProps} schema={schema} availableVariables={availableVariables} />

        default:
            // 默认作为字符串处理
            return <StringField {...baseProps} />
    }
}

/**
 * ObjectField - 嵌套对象字段
 */
function ObjectField({
    name,
    schema,
    value,
    onChange,
    availableVariables,
    disabled,
}: {
    name: string
    schema: ExtendedJSONSchema7
    value: unknown
    onChange: (value: unknown) => void
    availableVariables?: FieldRendererProps['availableVariables']
    disabled?: boolean
}) {
    const objectValue = (value as Record<string, unknown>) || {}

    // 获取排序后的字段
    const sortedFields = useMemo(() => {
        if (!schema.properties) return []

        return Object.entries(schema.properties)
            .map(([fieldName, fieldSchema]) => ({
                name: fieldName,
                schema: fieldSchema as ExtendedJSONSchema7,
                order: (fieldSchema as ExtendedJSONSchema7)['x-order'] ?? 999,
            }))
            .sort((a, b) => a.order - b.order)
    }, [schema.properties])

    const handleFieldChange = (fieldName: string, fieldValue: unknown) => {
        onChange({ ...objectValue, [fieldName]: fieldValue })
    }

    const isRequired = (fieldName: string) => {
        return Array.isArray(schema.required) && schema.required.includes(fieldName)
    }

    return (
        <div className="space-y-3 pl-3 border-l-2 border-muted">
            {sortedFields.map(field => {
                if (field.schema['x-hidden']) return null

                return (
                    <FieldRenderer
                        key={field.name}
                        name={field.name}
                        schema={field.schema}
                        value={objectValue[field.name]}
                        onChange={val => handleFieldChange(field.name, val)}
                        availableVariables={availableVariables}
                        disabled={disabled}
                        required={isRequired(field.name)}
                        parentPath={name}
                    />
                )
            })}
        </div>
    )
}

/**
 * 渲染自定义组件
 */
function renderCustomComponent(
    componentName: string,
    baseProps: {
        name: string
        label?: string
        description?: string
        placeholder: string
        help?: string
        value: unknown
        onChange: (value: unknown) => void
        disabled?: boolean
        required?: boolean
    },
    schema: ExtendedJSONSchema7,
    availableVariables?: FieldRendererProps['availableVariables']
) {
    const componentProps = schema['x-component-props'] || {}

    switch (componentName) {
        case 'textarea':
            return <StringField {...baseProps} multiline minLength={schema.minLength} maxLength={schema.maxLength} />

        case 'password':
            return <StringField {...baseProps} type="password" />

        case 'email':
            return <StringField {...baseProps} type="email" />

        case 'url':
            return <StringField {...baseProps} type="url" />

        case 'variable':
            return <VariableField {...baseProps} availableVariables={availableVariables} {...componentProps} />

        case 'slider':
            return (
                <NumberField
                    {...baseProps}
                    min={schema.minimum ?? 0}
                    max={schema.maximum ?? 100}
                    step={(componentProps.step as number) ?? 1}
                    showSlider
                />
            )

        default:
            // 未知组件，回退到字符串字段
            return <StringField {...baseProps} />
    }
}

/**
 * 格式化字段名为标签
 */
function formatFieldName(name: string): string {
    return name
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_-]/g, ' ')
        .replace(/^\s/, '')
        .replace(/\b\w/g, c => c.toUpperCase())
}
