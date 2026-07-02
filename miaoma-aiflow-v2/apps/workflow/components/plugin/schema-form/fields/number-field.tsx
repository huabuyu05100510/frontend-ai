/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

import type { BaseFieldProps } from '../types'

interface NumberFieldProps extends BaseFieldProps {
    /** 最小值 */
    min?: number
    /** 最大值 */
    max?: number
    /** 步进值 */
    step?: number
    /** 是否显示滑块 */
    showSlider?: boolean
}

/**
 * NumberField - 数字输入字段
 */
export function NumberField({
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
    min,
    max,
    step = 1,
    showSlider,
}: NumberFieldProps) {
    const numberValue = typeof value === 'number' ? value : (min ?? 0)

    const handleChange = (newValue: number) => {
        // 确保在范围内
        let clampedValue = newValue
        if (min !== undefined && clampedValue < min) clampedValue = min
        if (max !== undefined && clampedValue > max) clampedValue = max
        onChange(clampedValue)
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const parsed = parseFloat(e.target.value)
        if (!isNaN(parsed)) {
            handleChange(parsed)
        } else if (e.target.value === '') {
            onChange(min ?? 0)
        }
    }

    const handleSliderChange = (values: number[]) => {
        handleChange(values[0])
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

            {showSlider ? (
                <div className="flex items-center gap-4">
                    <Slider
                        value={[numberValue]}
                        onValueChange={handleSliderChange}
                        min={min ?? 0}
                        max={max ?? 100}
                        step={step}
                        disabled={disabled}
                        className="flex-1"
                    />
                    <Input
                        id={name}
                        name={name}
                        type="number"
                        value={numberValue}
                        onChange={handleInputChange}
                        min={min}
                        max={max}
                        step={step}
                        disabled={disabled}
                        className={cn('w-20', error && 'border-destructive')}
                    />
                </div>
            ) : (
                <Input
                    id={name}
                    name={name}
                    type="number"
                    value={numberValue}
                    onChange={handleInputChange}
                    placeholder={placeholder}
                    min={min}
                    max={max}
                    step={step}
                    disabled={disabled}
                    className={cn(error && 'border-destructive')}
                />
            )}

            {help && <p className="text-xs text-muted-foreground">{help}</p>}

            {error && <p className="text-xs text-destructive">{error}</p>}

            {min !== undefined && max !== undefined && (
                <p className="text-xs text-muted-foreground">
                    范围: {min} - {max}
                </p>
            )}
        </div>
    )
}
