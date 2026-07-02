/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { Module } from '@nestjs/common'

import { PluginMarketController } from './plugin-market.controller'
import { PluginMarketService } from './plugin-market.service'

@Module({
    controllers: [PluginMarketController],
    providers: [PluginMarketService],
    exports: [PluginMarketService],
})
export class PluginMarketModule {}
