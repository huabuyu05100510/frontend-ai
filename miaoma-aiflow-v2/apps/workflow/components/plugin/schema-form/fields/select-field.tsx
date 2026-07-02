/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

import type { SelectFieldProps } from '../types'

/**
 * SelectField - 下拉选择字段
 */
export function SelectField({
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
    options,
}: SelectFieldProps) {
    const stringValue = value !== undefined && value !== null ? String(value) : ''

    const handleChange = (newValue: string) => {
        // 尝试转换回原始类型
        const option = options.find(o => String(o.value) === newValue)
        if (option) {
            onChange(option.value)
        } else {
            onChange(newValue)
        }
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

            <Select value={stringValue} onValueChange={handleChange} disabled={disabled}>
                <SelectTrigger id={name} className={cn(error && 'border-destructive')}>
                    <SelectValue placeholder={placeholder || '请选择...'} />
                </SelectTrigger>
                <SelectContent>
                    {options.map(option => (
                        <SelectItem key={String(option.value)} value={String(option.value)}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {help && <p className="text-xs text-muted-foreground">{help}</p>}

            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    )
}
