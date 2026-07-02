/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'

import { PluginMarketService } from './plugin-market.service'

@Controller('plugin-market')
export class PluginMarketController {
    constructor(private readonly pluginMarketService: PluginMarketService) {}

    @Get('v1/plugins')
    async listPlugins(@Req() request: Request, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
        return this.pluginMarketService.listPlugins(
            this.getBaseUrl(request),
            page ? Number.parseInt(page, 10) : 1,
            pageSize ? Number.parseInt(pageSize, 10) : 20
        )
    }

    @Get('v1/plugins/:id')
    async getPluginDetail(@Req() request: Request, @Param('id') id: string) {
        return this.pluginMarketService.getPluginDetail(decodeURIComponent(id), this.getBaseUrl(request))
    }

    @Get('assets')
    async getPluginAsset(
        @Res() response: Response,
        @Query('pluginId') pluginId?: string,
        @Query('version') version?: string,
        @Query('file') file?: string
    ): Promise<void> {
        if (!pluginId || !version || !file) {
            response.status(404).send('Not Found')
            return
        }

        const asset = await this.pluginMarketService.loadPluginAsset(pluginId, version, file)
        response.setHeader('Content-Type', asset.contentType)
        response.setHeader('Cache-Control', 'public, max-age=300')
        response.send(asset.content)
    }

    private getBaseUrl(request: Request): string {
        const configuredBaseUrl = process.env.PLUGIN_MARKET_PUBLIC_BASE_URL?.trim()
        if (configuredBaseUrl) {
            return configuredBaseUrl.replace(/\/$/, '')
        }

        const protocol = request.headers['x-forwarded-proto']?.toString().split(',')[0] || request.protocol
        const host = request.headers['x-forwarded-host']?.toString().split(',')[0] || request.get('host')

        if (!host) {
            throw new Error('无法解析插件市场服务地址')
        }

        return `${protocol}://${host}/api/plugin-market`
    }
}
