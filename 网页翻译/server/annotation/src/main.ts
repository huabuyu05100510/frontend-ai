/**
 * Bootstrap：端口 3001，Swagger /api/docs
 * 模型：claude-sonnet-4-6（MiniMax-M3 路由）
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

const PORT = Number(process.env.PORT ?? process.env.ANNOTATION_PORT ?? 3001);

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.enableCors({
    origin: '*',
    methods: 'GET,POST,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      stopAtFirstError: false,
      exceptionFactory: (errors) => {
        const flatten = (errs: any[], parent = ''): Array<{ field: string; errors: string[] }> => {
          const out: Array<{ field: string; errors: string[] }> = [];
          for (const e of errs) {
            const field = parent ? `${parent}.${e.property}` : e.property;
            if (e.constraints && Object.keys(e.constraints).length > 0) {
              out.push({ field, errors: Object.values(e.constraints) });
            }
            if (e.children && e.children.length > 0) {
              out.push(...flatten(e.children, field));
            }
          }
          return out;
        };
        const details = flatten(errors);
        return new BadRequestException({
          statusCode: 400,
          error: 'ValidationFailed',
          message: 'Request body validation failed',
          details,
        });
      },
    }),
  );

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('XT Annotation Service')
    .setDescription('网页翻译用户标注聚合服务（M3 of annotation-feature-tech-plan-V1）')
    .setVersion('1.0.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(PORT, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`▶ Annotation Service listening http://localhost:${PORT}`);
  logger.log(`  Swagger:  http://localhost:${PORT}/api/docs`);
  logger.log(`  Endpoints:`);
  logger.log(`    POST /v1/annotations            (限流 1000/min/IP)`);
  logger.log(`    GET  /v1/annotations/stats`);
  logger.log(`    GET  /v1/annotations/export     (NDJSON stream)`);
  logger.log(`    GET  /v1/annotations/export/stats`);
  logger.log(`    GET  /v1/annotations/health`);
}

bootstrap().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[bootstrap fatal]', e);
  process.exit(1);
});