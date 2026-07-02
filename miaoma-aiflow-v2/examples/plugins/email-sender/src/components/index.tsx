/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import React, { useState } from 'react'

/**
 * 可用变量输出定义
 */
interface AvailableVariable {
    nodeId: string
    nodeTitle: string
    nodeType: string
    outputs: Array<{
        name: string
        type: string
        description?: string
    }>
}

/**
 * 邮件设置组件属性
 */
interface EmailSettingsProps {
    value: Record<string, unknown>
    onChange: (value: Record<string, unknown>) => void
    schema: unknown
    availableVariables?: AvailableVariable[]
    disabled?: boolean
}

/**
 * 邮件配置类型
 */
interface EmailConfig {
    smtpConfig?: {
        host?: string
        port?: number
        secure?: boolean
    }
    auth?: {
        username?: string
        password?: string
    }
    from?: string
    to?: string[]
    cc?: string[]
    bcc?: string[]
    subject?: string
    body?: string
    isHtml?: boolean
    replyTo?: string
}

/**
 * EmailSettings - 邮件发送节点的自定义设置组件
 *
 * 提供比默认 Schema 表单更好的用户体验：
 * - 分步骤配置向导
 * - 邮件预览功能
 * - 快速测试发送
 */
export function EmailSettings({ value, onChange, disabled }: EmailSettingsProps) {
    const [activeTab, setActiveTab] = useState<'config' | 'preview'>('config')
    const config = value as EmailConfig

    // 更新配置的辅助函数
    const updateConfig = (path: string, newValue: unknown) => {
        const keys = path.split('.')
        const newConfig = { ...config }

        let current: Record<string, unknown> = newConfig
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i]
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {}
            }
            current = current[key] as Record<string, unknown>
        }
        current[keys[keys.length - 1]] = newValue

        onChange(newConfig)
    }

    // SMTP 预设配置
    const smtpPresets = [
        { name: 'Gmail', host: 'smtp.gmail.com', port: 587 },
        { name: 'QQ 邮箱', host: 'smtp.qq.com', port: 587 },
        { name: '163 邮箱', host: 'smtp.163.com', port: 465 },
        { name: 'Outlook', host: 'smtp.office365.com', port: 587 },
    ]

    return (
        <div className="space-y-4">
            {/* 标签页切换 */}
            <div className="flex gap-2 border-b pb-2">
                <button
                    type="button"
                    className={`px-3 py-1.5 text-sm rounded-t ${
                        activeTab === 'config' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'
                    }`}
                    onClick={() => setActiveTab('config')}
                >
                    配置
                </button>
                <button
                    type="button"
                    className={`px-3 py-1.5 text-sm rounded-t ${
                        activeTab === 'preview' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'
                    }`}
                    onClick={() => setActiveTab('preview')}
                >
                    预览
                </button>
            </div>

            {activeTab === 'config' ? (
                <div className="space-y-6">
                    {/* SMTP 配置 */}
                    <section className="space-y-3">
                        <h4 className="font-medium text-sm flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center">
                                1
                            </span>
                            SMTP 服务器
                        </h4>

                        {/* 快速选择预设 */}
                        <div className="flex flex-wrap gap-2">
                            {smtpPresets.map(preset => (
                                <button
                                    key={preset.name}
                                    type="button"
                                    className="px-2 py-1 text-xs border rounded hover:bg-muted transition-colors"
                                    onClick={() => {
                                        updateConfig('smtpConfig.host', preset.host)
                                        updateConfig('smtpConfig.port', preset.port)
                                    }}
                                    disabled={disabled}
                                >
                                    {preset.name}
                                </button>
                            ))}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs text-muted-foreground">服务器地址</label>
                                <input
                                    type="text"
                                    className="w-full px-3 py-2 border rounded-md text-sm"
                                    placeholder="smtp.example.com"
                                    value={config.smtpConfig?.host || ''}
                                    onChange={e => updateConfig('smtpConfig.host', e.target.value)}
                                    disabled={disabled}
                                />
                            </div>
                            <div>
                                <label className="text-xs text-muted-foreground">端口</label>
                                <select
                                    className="w-full px-3 py-2 border rounded-md text-sm"
                                    value={config.smtpConfig?.port || 587}
                                    onChange={e => updateConfig('smtpConfig.port', Number(e.target.value))}
                                    disabled={disabled}
                                >
                                    <option value={25}>25 (SMTP)</option>
                                    <option value={465}>465 (SSL)</option>
                                    <option value={587}>587 (TLS)</option>
                                </select>
                            </div>
                        </div>
                    </section>

                    {/* 认证信息 */}
                    <section className="space-y-3">
                        <h4 className="font-medium text-sm flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center">
                                2
                            </span>
                            认证信息
                        </h4>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-xs text-muted-foreground">用户名</label>
                                <input
                                    type="text"
                                    className="w-full px-3 py-2 border rounded-md text-sm"
                                    placeholder="your@email.com"
                                    value={config.auth?.username || ''}
                                    onChange={e => updateConfig('auth.username', e.target.value)}
                                    disabled={disabled}
                                />
                            </div>
                            <div>
                                <label className="text-xs text-muted-foreground">密码/授权码</label>
                                <input
                                    type="password"
                                    className="w-full px-3 py-2 border rounded-md text-sm"
                                    placeholder="••••••••"
                                    value={config.auth?.password || ''}
                                    onChange={e => updateConfig('auth.password', e.target.value)}
                                    disabled={disabled}
                                />
                            </div>
                        </div>
                    </section>

                    {/* 邮件内容 */}
                    <section className="space-y-3">
                        <h4 className="font-medium text-sm flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center">
                                3
                            </span>
                            邮件内容
                        </h4>

                        <div>
                            <label className="text-xs text-muted-foreground">发件人</label>
                            <input
                                type="text"
                                className="w-full px-3 py-2 border rounded-md text-sm"
                                placeholder="名称 <email@example.com>"
                                value={config.from || ''}
                                onChange={e => updateConfig('from', e.target.value)}
                                disabled={disabled}
                            />
                        </div>

                        <div>
                            <label className="text-xs text-muted-foreground">收件人 (用逗号分隔)</label>
                            <input
                                type="text"
                                className="w-full px-3 py-2 border rounded-md text-sm"
                                placeholder="a@example.com, b@example.com"
                                value={(config.to || []).join(', ')}
                                onChange={e =>
                                    updateConfig(
                                        'to',
                                        e.target.value
                                            .split(',')
                                            .map(s => s.trim())
                                            .filter(Boolean)
                                    )
                                }
                                disabled={disabled}
                            />
                        </div>

                        <div>
                            <label className="text-xs text-muted-foreground">主题</label>
                            <input
                                type="text"
                                className="w-full px-3 py-2 border rounded-md text-sm"
                                placeholder="邮件主题"
                                value={config.subject || ''}
                                onChange={e => updateConfig('subject', e.target.value)}
                                disabled={disabled}
                            />
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <label className="text-xs text-muted-foreground">正文</label>
                                <label className="flex items-center gap-1 text-xs">
                                    <input
                                        type="checkbox"
                                        checked={config.isHtml || false}
                                        onChange={e => updateConfig('isHtml', e.target.checked)}
                                        disabled={disabled}
                                    />
                                    HTML 格式
                                </label>
                            </div>
                            <textarea
                                className="w-full px-3 py-2 border rounded-md text-sm resize-none"
                                rows={6}
                                placeholder="邮件正文内容..."
                                value={config.body || ''}
                                onChange={e => updateConfig('body', e.target.value)}
                                disabled={disabled}
                            />
                        </div>
                    </section>
                </div>
            ) : (
                /* 预览模式 */
                <div className="border rounded-lg overflow-hidden">
                    {/* 邮件头部 */}
                    <div className="bg-muted/50 p-3 border-b text-sm space-y-1">
                        <div>
                            <span className="text-muted-foreground">发件人：</span>
                            <span>{config.from || '(未设置)'}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground">收件人：</span>
                            <span>{(config.to || []).join(', ') || '(未设置)'}</span>
                        </div>
                        <div>
                            <span className="text-muted-foreground">主题：</span>
                            <span className="font-medium">{config.subject || '(未设置)'}</span>
                        </div>
                    </div>

                    {/* 邮件正文 */}
                    <div className="p-4 min-h-[200px] bg-white">
                        {config.isHtml ? (
                            <div
                                className="prose prose-sm max-w-none"
                                dangerouslySetInnerHTML={{ __html: config.body || '<p class="text-muted-foreground">(无内容)</p>' }}
                            />
                        ) : (
                            <pre className="whitespace-pre-wrap text-sm font-sans">
                                {config.body || <span className="text-muted-foreground">(无内容)</span>}
                            </pre>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

/**
 * 默认导出（供 UMD 模式使用）
 */
export default {
    EmailSettings,
}
