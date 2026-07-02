/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import type { PluginNodeExecutionContext, PluginNodeExecutionResult, PluginNodeExecutor } from '@miaoma-aiflow/plugin-core'

/**
 * SMTP 配置接口
 */
interface SmtpConfig {
    host: string
    port: number
    secure?: boolean
}

/**
 * 认证信息接口
 */
interface AuthConfig {
    username: string
    password: string
}

/**
 * 邮件发送节点配置
 */
interface SendEmailConfig {
    smtpConfig: SmtpConfig
    auth: AuthConfig
    from: string
    to: string[]
    cc?: string[]
    bcc?: string[]
    subject: string
    body: string
    isHtml?: boolean
    replyTo?: string
}

/**
 * 邮件发送 API 响应
 */
interface EmailApiResponse {
    success: boolean
    messageId?: string
    accepted?: string[]
    rejected?: string[]
    response?: string
    error?: string
}

/**
 * SendEmailExecutor - 邮件发送节点执行器
 *
 * 通过 SMTP 协议发送邮件，支持：
 * - 纯文本和 HTML 格式
 * - 多收件人、抄送、密送
 * - SSL/TLS 加密
 */
export class SendEmailExecutor implements PluginNodeExecutor {
    readonly type = 'send-email'

    /**
     * 执行邮件发送
     */
    async execute(context: PluginNodeExecutionContext): Promise<PluginNodeExecutionResult> {
        const { config, services, logger } = context
        const emailConfig = config as unknown as SendEmailConfig

        try {
            // 记录开始
            logger.info(`开始发送邮件: ${emailConfig.subject}`)
            logger.debug(`收件人: ${emailConfig.to.join(', ')}`)

            // 验证配置
            const validationResult = this.validate(config)
            if (!validationResult.valid) {
                throw new Error(`配置验证失败: ${validationResult.errors?.join(', ')}`)
            }

            // 构建邮件请求体
            const emailPayload = this.buildEmailPayload(emailConfig)

            // 调用邮件发送 API
            // 注意：这里使用 services.fetch，它是受权限控制的
            // 实际使用时，你可能需要调用自己的邮件服务 API
            const response = await this.sendEmail(services.fetch, emailPayload)

            if (!response.success) {
                throw new Error(response.error || '邮件发送失败')
            }

            logger.info(`邮件发送成功，ID: ${response.messageId}`)

            return {
                success: true,
                outputs: {
                    messageId: response.messageId || '',
                    accepted: response.accepted || emailConfig.to,
                    rejected: response.rejected || [],
                    response: response.response || 'OK',
                },
                metadata: {
                    sentAt: new Date().toISOString(),
                    recipientCount: emailConfig.to.length,
                },
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知错误'
            logger.error(`邮件发送失败: ${errorMessage}`)

            return {
                success: false,
                error: errorMessage,
            }
        }
    }

    /**
     * 验证节点配置
     */
    validate(config: Record<string, unknown>): { valid: boolean; errors?: string[] } {
        const errors: string[] = []
        const emailConfig = config as unknown as Partial<SendEmailConfig>

        // 验证 SMTP 配置
        if (!emailConfig.smtpConfig?.host) {
            errors.push('SMTP 服务器地址不能为空')
        }

        if (!emailConfig.smtpConfig?.port) {
            errors.push('SMTP 端口不能为空')
        }

        // 验证认证信息
        if (!emailConfig.auth?.username) {
            errors.push('用户名不能为空')
        }

        if (!emailConfig.auth?.password) {
            errors.push('密码不能为空')
        }

        // 验证发件人
        if (!emailConfig.from) {
            errors.push('发件人不能为空')
        }

        // 验证收件人
        if (!emailConfig.to || emailConfig.to.length === 0) {
            errors.push('至少需要一个收件人')
        }

        // 验证邮件主题
        if (!emailConfig.subject) {
            errors.push('邮件主题不能为空')
        }

        // 验证邮件正文
        if (!emailConfig.body) {
            errors.push('邮件正文不能为空')
        }

        // 验证邮箱格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

        if (emailConfig.to) {
            for (const email of emailConfig.to) {
                if (!emailRegex.test(email)) {
                    errors.push(`无效的收件人邮箱: ${email}`)
                }
            }
        }

        if (emailConfig.cc) {
            for (const email of emailConfig.cc) {
                if (!emailRegex.test(email)) {
                    errors.push(`无效的抄送邮箱: ${email}`)
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors.length > 0 ? errors : undefined,
        }
    }

    /**
     * 构建邮件请求体
     */
    private buildEmailPayload(config: SendEmailConfig): Record<string, unknown> {
        return {
            smtp: {
                host: config.smtpConfig.host,
                port: config.smtpConfig.port,
                secure: config.smtpConfig.secure || config.smtpConfig.port === 465,
            },
            auth: {
                user: config.auth.username,
                pass: config.auth.password,
            },
            message: {
                from: config.from,
                to: config.to,
                cc: config.cc,
                bcc: config.bcc,
                subject: config.subject,
                [config.isHtml ? 'html' : 'text']: config.body,
                replyTo: config.replyTo,
            },
        }
    }

    /**
     * 发送邮件 (调用外部 API)
     *
     * 注意：这是一个示例实现。在实际使用中，
     * 你需要替换为自己的邮件服务 API 地址。
     */
    private async sendEmail(fetch: typeof globalThis.fetch, payload: Record<string, unknown>): Promise<EmailApiResponse> {
        // 示例：调用一个邮件发送微服务
        // 在实际使用时，替换为你的邮件服务地址
        const EMAIL_SERVICE_URL = process.env.EMAIL_SERVICE_URL || 'https://api.example.com/email/send'

        try {
            const response = await fetch(EMAIL_SERVICE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            })

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                return {
                    success: false,
                    error: (errorData as { message?: string }).message || `HTTP ${response.status}: ${response.statusText}`,
                }
            }

            const data = (await response.json()) as EmailApiResponse
            return {
                success: true,
                messageId: data.messageId,
                accepted: data.accepted,
                rejected: data.rejected,
                response: data.response,
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : '网络请求失败',
            }
        }
    }
}
