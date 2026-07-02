/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import type { PluginNodeExecutionContext, PluginNodeExecutionResult, PluginNodeExecutor } from '@miaoma-aiflow/plugin-core'

interface GetCurrentTimeConfig {
    timezone?: string
    locale?: string
    hour12?: boolean
    includeSeconds?: boolean
}

const DEFAULT_TIMEZONE = 'Asia/Shanghai'
const DEFAULT_LOCALE = 'zh-CN'

function isValidTimeZone(timezone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
        return true
    } catch {
        return false
    }
}

function normalizeLocale(locale: string | undefined): string {
    return typeof locale === 'string' && locale.trim() ? locale.trim() : DEFAULT_LOCALE
}

function normalizeTimezone(timezone: string | undefined): string {
    const candidate = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : DEFAULT_TIMEZONE
    return isValidTimeZone(candidate) ? candidate : DEFAULT_TIMEZONE
}

function formatDateTime(now: Date, locale: string, timezone: string, hour12: boolean, includeSeconds: boolean) {
    const commonOptions: Intl.DateTimeFormatOptions = {
        timeZone: timezone,
        hour12,
    }

    const formatted = new Intl.DateTimeFormat(locale, {
        ...commonOptions,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: includeSeconds ? '2-digit' : undefined,
    }).format(now)

    const date = new Intl.DateTimeFormat(locale, {
        ...commonOptions,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now)

    const time = new Intl.DateTimeFormat(locale, {
        ...commonOptions,
        hour: '2-digit',
        minute: '2-digit',
        second: includeSeconds ? '2-digit' : undefined,
    }).format(now)

    return {
        formatted,
        date,
        time,
    }
}

/**
 * GetCurrentTimeExecutor - 当前时间执行器
 */
export class GetCurrentTimeExecutor implements PluginNodeExecutor {
    readonly type = 'get-current-time'

    async execute(context: PluginNodeExecutionContext): Promise<PluginNodeExecutionResult> {
        const { logger } = context
        const config = context.config as GetCurrentTimeConfig

        try {
            const timezone = normalizeTimezone(config.timezone)
            const locale = normalizeLocale(config.locale)
            const hour12 = Boolean(config.hour12)
            const includeSeconds = config.includeSeconds !== false
            const now = new Date()

            logger.info(`生成当前时间，timezone=${timezone}, locale=${locale}`)

            const formattedResult = formatDateTime(now, locale, timezone, hour12, includeSeconds)

            return {
                success: true,
                outputs: {
                    formatted: formattedResult.formatted,
                    date: formattedResult.date,
                    time: formattedResult.time,
                    isoString: now.toISOString(),
                    timestamp: now.getTime(),
                    timezone,
                    locale,
                },
                metadata: {
                    generatedAt: now.toISOString(),
                    source: 'system-clock',
                },
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知错误'
            logger.error(`生成当前时间失败: ${errorMessage}`)

            return {
                success: false,
                error: errorMessage,
            }
        }
    }

    validate(config: Record<string, unknown>) {
        const errors: string[] = []
        const timezone = config.timezone
        const locale = config.locale

        if (timezone !== undefined && (typeof timezone !== 'string' || !timezone.trim())) {
            errors.push('时区必须是非空字符串')
        }

        if (typeof timezone === 'string' && timezone.trim() && !isValidTimeZone(timezone.trim())) {
            errors.push(`无效的时区: ${timezone}`)
        }

        if (locale !== undefined && (typeof locale !== 'string' || !locale.trim())) {
            errors.push('语言环境必须是非空字符串')
        }

        if (config.hour12 !== undefined && typeof config.hour12 !== 'boolean') {
            errors.push('12 小时制必须是布尔值')
        }

        if (config.includeSeconds !== undefined && typeof config.includeSeconds !== 'boolean') {
            errors.push('包含秒必须是布尔值')
        }

        return {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined,
        }
    }
}
