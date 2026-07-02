/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'
import { GlobalExceptionFilter } from './common/filters/http-exception.filter'
import { TransformInterceptor } from './common/interceptors/transform.interceptor'

async function bootstrap() {
    const app = await NestFactory.create(AppModule)
    const logger = new Logger('Bootstrap')

    app.setGlobalPrefix('api')

    app.enableCors({
        origin: true,
        credentials: true,
    })

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            transformOptions: {
                enableImplicitConversion: true,
            },
        })
    )

    app.useGlobalFilters(new GlobalExceptionFilter())
    app.useGlobalInterceptors(new TransformInterceptor())

    const port = process.env.PORT ?? 3101
    await app.listen(port)

    logger.log(`🚀 Plugin Market Server is running on: http://localhost:${port}/api/plugin-market`)
    logger.log(`📦 Plugin List API: GET http://localhost:${port}/api/plugin-market/v1/plugins`)
}

bootstrap()
