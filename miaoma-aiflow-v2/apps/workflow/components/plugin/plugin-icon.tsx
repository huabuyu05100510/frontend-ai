'use client'

import * as LucideIcons from 'lucide-react'
import { PlugIcon } from 'lucide-react'
import { createElement, type CSSProperties, type ElementType, useState } from 'react'

interface PluginIconProps {
    icon?: string
    alt?: string
    size?: number
    color?: string
    className?: string
    fallback?: ElementType<{ size?: number; className?: string; style?: CSSProperties }>
}

function isImageLikeIcon(icon: string): boolean {
    return icon.startsWith('/') || icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('data:image/')
}

function resolveLucideIcon(icon: string): ElementType<{ size?: number; className?: string; style?: CSSProperties }> | null {
    const candidate = (LucideIcons as Record<string, unknown>)[icon]
    return typeof candidate === 'function' ? (candidate as ElementType<{ size?: number; className?: string; style?: CSSProperties }>) : null
}

export function PluginIcon({ icon, alt = 'plugin icon', size = 20, color, className, fallback: Fallback = PlugIcon }: PluginIconProps) {
    const [imageFailed, setImageFailed] = useState(false)

    if (icon && isImageLikeIcon(icon) && !imageFailed) {
        return (
            <img
                src={icon}
                alt={alt}
                className={className}
                style={{
                    width: size,
                    height: size,
                }}
                onError={() => setImageFailed(true)}
            />
        )
    }

    if (icon) {
        const IconComponent = resolveLucideIcon(icon)
        if (IconComponent) {
            return createElement(IconComponent, {
                size,
                className,
                style: color ? { color } : undefined,
            })
        }
    }

    return createElement(Fallback, {
        size,
        className,
        style: color ? { color } : undefined,
    })
}
