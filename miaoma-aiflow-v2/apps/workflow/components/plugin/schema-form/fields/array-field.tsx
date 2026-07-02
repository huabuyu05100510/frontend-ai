/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { useCallback } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import { FieldRenderer } from '../field-renderer'
import type { ArrayFieldProps, ExtendedJSONSchema7 } from '../types'

/**
 * ArrayField - 数组字段
 */
export function ArrayField({
    name,
    label,
    description,
    help,
    value,
    onChange,
    disabled,
    required,
    error,
    itemSchema,
    availableVariables,
    minItems = 0,
    maxItems,
}: ArrayFieldProps) {
    const arrayValue = Array.isArray(value) ? value : []

    // 添加新项
    const handleAdd = useCallback(() => {
        if (maxItems !== undefined && arrayValue.length >= maxItems) return

        const newItem = getDefaultValue(itemSchema)
        onChange([...arrayValue, newItem])
    }, [arrayValue, itemSchema, maxItems, onChange])

    // 删除项
    const handleRemove = useCallback(
        (index: number) => {
            if (arrayValue.length <= minItems) return

            const newArray = [...arrayValue]
            newArray.splice(index, 1)
            onChange(newArray)
        },
        [arrayValue, minItems, onChange]
    )

    // 更新项
    const handleItemChange = useCallback(
        (index: number, newValue: unknown) => {
            const newArray = [...arrayValue]
            newArray[index] = newValue
            onChange(newArray)
        },
        [arrayValue, onChange]
    )

    // 移动项
    const handleMove = useCallback(
        (fromIndex: number, toIndex: number) => {
            if (toIndex < 0 || toIndex >= arrayValue.length) return

            const newArray = [...arrayValue]
            const [removed] = newArray.splice(fromIndex, 1)
            newArray.splice(toIndex, 0, removed)
            onChange(newArray)
        },
        [arrayValue, onChange]
    )

    const canAdd = maxItems === undefined || arrayValue.length < maxItems
    const canRemove = arrayValue.length > minItems

    return (
        <div className="space-y-3">
            {label && (
                <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">
                        {label}
                        {required && <span className="text-destructive ml-1">*</span>}
                    </Label>
                    <span className="text-xs text-muted-foreground">
                        {arrayValue.length}
                        {maxItems !== undefined && ` / ${maxItems}`} 项
                    </span>
                </div>
            )}

            {description && <p className="text-xs text-muted-foreground">{description}</p>}

            <div className={cn('space-y-2', error && 'border-l-2 border-destructive pl-2')}>
                {arrayValue.map((item, index) => (
                    <div key={index} className="group flex items-start gap-2 p-2 rounded-md border bg-muted/30">
                        {/* 拖拽手柄 */}
                        <div className="flex flex-col gap-0.5 pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                                type="button"
                                onClick={() => handleMove(index, index - 1)}
                                disabled={disabled || index === 0}
                                className="p-0.5 hover:bg-muted rounded disabled:opacity-30"
                                title="上移"
                            >
                                <GripVertical className="h-3 w-3" />
                            </button>
                        </div>

                        {/* 字段内容 */}
                        <div className="flex-1 min-w-0">
                            <FieldRenderer
                                name={`${index}`}
                                schema={itemSchema}
                                value={item}
                                onChange={val => handleItemChange(index, val)}
                                availableVariables={availableVariables}
                                disabled={disabled}
                                parentPath={name}
                            />
                        </div>

                        {/* 删除按钮 */}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemove(index)}
                            disabled={disabled || !canRemove}
                            className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                    </div>
                ))}

                {/* 添加按钮 */}
                <Button type="button" variant="outline" size="sm" onClick={handleAdd} disabled={disabled || !canAdd} className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    添加项
                </Button>
            </div>

            {help && <p className="text-xs text-muted-foreground">{help}</p>}

            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    )
}

/**
 * 根据 Schema 获取默认值
 */
function getDefaultValue(schema: ExtendedJSONSchema7): unknown {
    if (schema.default !== undefined) {
        return schema.default
    }

    switch (schema.type) {
        case 'string':
            return ''
        case 'number':
        case 'integer':
            return schema.minimum ?? 0
        case 'boolean':
            return false
        case 'array':
            return []
        case 'object':
            return {}
        default:
            return null
    }
}
