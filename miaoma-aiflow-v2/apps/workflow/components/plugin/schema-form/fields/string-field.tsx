/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import type { BaseFieldProps } from '../types'

interface StringFieldProps extends BaseFieldProps {
    /** 是否多行 */
    multiline?: boolean
    /** 输入类型 */
    type?: 'text' | 'password' | 'email' | 'url'
    /** 最小长度 */
    minLength?: number
    /** 最大长度 */
    maxLength?: number
    /** 正则验证 */
    pattern?: string
}

/**
 * StringField - 字符串输入字段
 */
export function StringField({
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
    multiline,
    type = 'text',
    minLength,
    maxLength,
}: StringFieldProps) {
    const stringValue = (value as string) ?? ''

    const handleChange = (newValue: string) => {
        onChange(newValue)
    }

    const inputProps = {
        id: name,
        name,
        value: stringValue,
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => handleChange(e.target.value),
        placeholder,
        disabled,
        minLength,
        maxLength,
        className: cn(error && 'border-destructive'),
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

            {multiline ? <Textarea {...inputProps} rows={4} /> : <Input {...inputProps} type={type} />}

            {help && <p className="text-xs text-muted-foreground">{help}</p>}

            {error && <p className="text-xs text-destructive">{error}</p>}

            {maxLength && (
                <p className="text-xs text-muted-foreground text-right">
                    {stringValue.length} / {maxLength}
                </p>
            )}
        </div>
    )
}
