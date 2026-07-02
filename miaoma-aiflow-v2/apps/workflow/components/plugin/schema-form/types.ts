/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import type { JSONSchema7 } from 'json-schema'

/**
 * 扩展的 JSON Schema 属性
 */
export interface ExtendedJSONSchema7 extends JSONSchema7 {
    /** 是否支持变量引用 */
    'x-variable'?: boolean
    /** 组件类型提示 */
    'x-component'?: string
    /** 组件属性 */
    'x-component-props'?: Record<string, unknown>
    /** 字段分组 */
    'x-group'?: string
    /** 字段顺序 */
    'x-order'?: number
    /** 占位符文本 */
    'x-placeholder'?: string
    /** 帮助文本 */
    'x-help'?: string
    /** 是否隐藏 */
    'x-hidden'?: boolean
    /** 嵌套属性 */
    properties?: Record<string, ExtendedJSONSchema7>
    items?: ExtendedJSONSchema7 | ExtendedJSONSchema7[]
}

/**
 * 可用的上游节点输出（用于变量引用）
 */
export interface AvailableNodeOutput {
    /** 节点 ID */
    nodeId: string
    /** 节点标题 */
    nodeTitle: string
    /** 节点类型 */
    nodeType: string
    /** 输出变量列表 */
    outputs: Array<{
        /** 变量名 */
        name: string
        /** 变量类型 */
        type: string
        /** 变量描述 */
        description?: string
    }>
}

/**
 * Schema 表单属性
 */
export interface SchemaFormProps {
    /** JSON Schema 定义 */
    schema: ExtendedJSONSchema7
    /** 当前值（受控模式） */
    values?: Record<string, unknown>
    /** 默认值 */
    defaultValues?: Record<string, unknown>
    /** 值变化回调 */
    onChange?: (data: Record<string, unknown>) => void
    /** 可用的变量（用于变量引用字段） */
    availableVariables?: AvailableNodeOutput[]
    /** 是否禁用 */
    disabled?: boolean
    /** 自定义类名 */
    className?: string
}

/**
 * 字段渲染器属性
 */
export interface FieldRendererProps {
    /** 字段名 */
    name: string
    /** 字段 Schema */
    schema: ExtendedJSONSchema7
    /** 当前值 */
    value: unknown
    /** 值变化回调 */
    onChange: (value: unknown) => void
    /** 可用的变量 */
    availableVariables?: AvailableNodeOutput[]
    /** 是否禁用 */
    disabled?: boolean
    /** 是否必填 */
    required?: boolean
    /** 父级路径 */
    parentPath?: string
}

/**
 * 基础字段组件属性
 */
export interface BaseFieldProps {
    /** 字段名 */
    name: string
    /** 字段标签 */
    label?: string
    /** 描述 */
    description?: string
    /** 占位符 */
    placeholder?: string
    /** 帮助文本 */
    help?: string
    /** 当前值 */
    value: unknown
    /** 值变化回调 */
    onChange: (value: unknown) => void
    /** 是否禁用 */
    disabled?: boolean
    /** 是否必填 */
    required?: boolean
    /** 错误信息 */
    error?: string
}

/**
 * 变量字段组件属性
 */
export interface VariableFieldProps extends BaseFieldProps {
    /** 可用的变量 */
    availableVariables?: AvailableNodeOutput[]
    /** 是否支持多行 */
    multiline?: boolean
    /** 最小高度 */
    minHeight?: string
}

/**
 * 选择字段组件属性
 */
export interface SelectFieldProps extends BaseFieldProps {
    /** 选项列表 */
    options: Array<{ label: string; value: string | number }>
    /** 是否支持多选 */
    multiple?: boolean
}

/**
 * 数组字段组件属性
 */
export interface ArrayFieldProps extends BaseFieldProps {
    /** 数组项 Schema */
    itemSchema: ExtendedJSONSchema7
    /** 可用的变量 */
    availableVariables?: AvailableNodeOutput[]
    /** 最小项数 */
    minItems?: number
    /** 最大项数 */
    maxItems?: number
}
