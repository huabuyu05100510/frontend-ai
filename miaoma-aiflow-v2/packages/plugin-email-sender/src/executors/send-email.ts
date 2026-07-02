/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import type { PluginNodeExecutionContext, PluginNodeExecutionResult, PluginNodeExecutor } from '@miaoma-aiflow/plugin-core'

interface SendEmailConfig {
    to?: string
    subject?: string
    text?: string
    html?: string
}

function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

function parseEmailList(value: unknown): string[] {
    if (typeof value !== 'string') {
        return []
    }

    return value
        .split(/[\n,;]+/g)
        .map(item => item.trim())
        .filter(Boolean)
}

function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function ensureValidEmailList(name: string, value: unknown, required: boolean): string[] {
    const emails = parseEmailList(value)

    if (required && emails.length === 0) {
        throw new Error(`${name}不能为空`)
    }

    const invalid = emails.find(email => !isValidEmail(email))
    if (invalid) {
        throw new Error(`${name}包含无效邮箱: ${invalid}`)
    }

    return emails
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function buildHtmlContent(text: string, html: string): string {
    if (html.trim()) {
        return html
    }

    const escaped = escapeHtml(text.trim()).replace(/\r?\n/g, '<br />')
    return `<div>${escaped}</div>`
}

export class SendEmailExecutor implements PluginNodeExecutor {
    readonly type = 'send-email'

    async execute(context: PluginNodeExecutionContext): Promise<PluginNodeExecutionResult> {
        const { logger, services } = context
        const config = context.config as SendEmailConfig

        try {
            const subject = normalizeText(config.subject)
            const text = typeof config.text === 'string' ? config.text : ''
            const html = typeof config.html === 'string' ? config.html : ''
            const to = ensureValidEmailList('收件人', config.to, true)

            if (!subject) {
                throw new Error('邮件主题不能为空')
            }

            if (!text.trim() && !html.trim()) {
                throw new Error('纯文本内容和 HTML 内容至少填写一个')
            }

            logger.info(`开始发送邮件，provider=platform-smtp, to=${to.join(',')}`)
            const delivered = await services.sendEmail({
                to: to.join(', '),
                subject,
                html: buildHtmlContent(text, html),
            })

            return {
                success: true,
                outputs: {
                    delivered,
                    provider: 'platform-smtp',
                    status: delivered ? 'sent' : 'unknown',
                    to,
                    subject,
                },
                metadata: {
                    sentAt: new Date().toISOString(),
                },
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知错误'
            logger.error(`发送邮件失败: ${errorMessage}`)

            return {
                success: false,
                error: errorMessage,
            }
        }
    }

    validate(config: Record<string, unknown>) {
        const errors: string[] = []

        try {
            const subject = normalizeText(config.subject)
            const text = typeof config.text === 'string' ? config.text.trim() : ''
            const html = typeof config.html === 'string' ? config.html.trim() : ''

            if (!subject) {
                errors.push('邮件主题不能为空')
            }

            ensureValidEmailList('收件人', config.to, true)

            if (!text && !html) {
                errors.push('纯文本内容和 HTML 内容至少填写一个')
            }
        } catch (error) {
            errors.push(error instanceof Error ? error.message : '配置校验失败')
        }

        return {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined,
        }
    }
}
