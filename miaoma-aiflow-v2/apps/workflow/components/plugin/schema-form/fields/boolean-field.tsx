/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import type { BaseFieldProps } from '../types'

/**
 * BooleanField - 布尔开关字段
 */
export function BooleanField({ name, label, description, help, value, onChange, disabled, error }: BaseFieldProps) {
    const boolValue = Boolean(value)

    const handleChange = (checked: boolean) => {
        onChange(checked)
    }

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                    {label && (
                        <Label htmlFor={name} className="text-sm font-medium cursor-pointer">
                            {label}
                        </Label>
                    )}
                    {description && <p className="text-xs text-muted-foreground">{description}</p>}
                </div>
                <Switch id={name} checked={boolValue} onCheckedChange={handleChange} disabled={disabled} />
            </div>

            {help && <p className="text-xs text-muted-foreground">{help}</p>}

            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    )
}
