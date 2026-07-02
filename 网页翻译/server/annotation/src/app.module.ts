/**
 * 根 Module：database（@Global）+ annotations
 */
import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { AnnotationsModule } from './annotations/annotations.module';

@Module({
  imports: [
    DatabaseModule,
    AnnotationsModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60_000, // 1 minute
        limit: 1000, // 单 IP 1000 req/min（方案 §5.3）
      },
    ]),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}