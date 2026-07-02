/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

'use client'

import { ArrowLeftIcon, GlobeIcon, ShieldCheckIcon, WrenchIcon } from 'lucide-react'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const NEXT_STEPS = [
    '首期插件市场已切换为远程官方源消费模式。',
    '当前应用不再直接接收本地插件发布和版本提交流程。',
    '后续会补齐远程发布、审核和上架后台能力。',
]

export default function PublishPluginPage() {
    return (
        <div className="px-6 lg:px-12 py-6 max-w-3xl mx-auto">
            <Link href="/plugins" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
                <ArrowLeftIcon size={16} />
                返回插件市场
            </Link>

            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <WrenchIcon size={22} className="text-amber-600" />
                </div>
                <div>
                    <h1 className="text-xl font-semibold">发布能力建设中</h1>
                    <p className="text-sm text-muted-foreground">当前版本已优先完成远程插件市场消费侧能力。</p>
                </div>
            </div>

            <Card className="mb-6">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <GlobeIcon size={18} />
                        现状说明
                    </CardTitle>
                    <CardDescription>插件目录、详情、安装和更新能力已统一接入远程官方源。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {NEXT_STEPS.map(step => (
                        <div key={step} className="flex items-start gap-3 rounded-lg border p-3">
                            <ShieldCheckIcon size={16} className="mt-0.5 text-emerald-600 shrink-0" />
                            <p className="text-sm">{step}</p>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">后续能力</CardTitle>
                    <CardDescription>远程发布和审核会作为下一阶段能力单独建设。</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-4">
                    <Badge variant="secondary" className="bg-amber-50 text-amber-700">
                        只读市场
                    </Badge>
                    <Link href="/plugins">
                        <Button>返回插件市场</Button>
                    </Link>
                </CardContent>
            </Card>
        </div>
    )
}
