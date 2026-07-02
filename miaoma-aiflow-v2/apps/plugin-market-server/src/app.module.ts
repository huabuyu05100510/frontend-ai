/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { PluginMarketModule } from './modules/plugin-market/plugin-market.module'

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: '.env',
        }),
        PluginMarketModule,
    ],
    controllers: [],
    providers: [],
})
export class AppModule {}
