/**
 * Annotations Controller —— 3 端点（方案 §5.1）
 *   POST /v1/annotations                批量 ingest
 *   GET  /v1/annotations/stats          聚合统计
 *   GET  /v1/annotations/export        流式导出 NDJSON
 *   GET  /v1/annotations/export/stats  训练数据准入门槛
 *   GET  /v1/annotations/health         健康检查
 *
 * 模型：claude-sonnet-4-6（MiniMax-M3 路由）
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiResponse, ApiBody } from '@nestjs/swagger';
import type { Response } from 'express';
import { CreateAnnotationBatchDto } from './dto/create-annotation.dto';
import { ExportQueryDto } from './dto/export-query.dto';
import { QueryStatsDto } from './dto/query-stats.dto';
import { AnnotationsService } from './annotations.service';
import { logger } from '../shared/logger';
import type { Annotation, IngestResponse, StatsResponse, ExportStatsResponse } from '../shared/types';

@ApiTags('annotations')
@Controller('v1/annotations')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }))
export class AnnotationsController {
  constructor(private readonly svc: AnnotationsService) {}

  // ─── POST /v1/annotations ────────────────────────────────
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '批量 ingest 标注（带限流 1000 req/min/IP）' })
  @ApiBody({ type: CreateAnnotationBatchDto })
  @ApiResponse({ status: 200, description: 'accepted + rejected 列表' })
  @ApiResponse({ status: 400, description: 'schema 校验失败' })
  @ApiResponse({ status: 429, description: '限流' })
  async ingest(@Body() body: CreateAnnotationBatchDto): Promise<IngestResponse> {
    const t0 = Date.now();
    const items: Annotation[] = body.items.map((dto) => ({
      id: dto.id,
      kind: dto.kind,
      schemaVersion: dto.schemaVersion,
      url: dto.url,
      domPath: dto.domPath,
      srcSegmentId: dto.srcSegmentId,
      langPair: dto.langPair,
      srcText: dto.srcText,
      tgtText: dto.tgtText,
      srcTokens: dto.srcTokens,
      tgtTokens: dto.tgtTokens,
      predicted: dto.predicted,
      modelVersion: dto.modelVersion,
      payload: dto.payload,
      context: dto.context,
      createdAt: dto.createdAt,
      appVersion: dto.appVersion,
      userAgent: dto.userAgent,
    }));

    const resp = await this.svc.ingest(items);
    logger.info('ingest', {
      accepted: resp.accepted,
      rejected: resp.rejected.length,
      tookMs: Date.now() - t0,
    });
    return resp;
  }

  // ─── GET /v1/annotations/stats ───────────────────────────
  @Get('stats')
  @ApiOperation({ summary: '聚合统计' })
  @ApiResponse({ status: 200, type: Object })
  async stats(@Query() _q: QueryStatsDto): Promise<StatsResponse> {
    return this.svc.getStats();
  }

  // ─── GET /v1/annotations/export/stats ────────────────────
  @Get('export/stats')
  @ApiOperation({ summary: '训练数据准入门槛检查（方案 §6.3）' })
  async exportStats(): Promise<ExportStatsResponse> {
    return this.svc.getExportStats();
  }

  // ─── GET /v1/annotations/export ──────────────────────────
  @Get('export')
  @ApiOperation({ summary: '流式导出 NDJSON（Content-Type=application/x-ndjson）' })
  async export(@Query() q: ExportQueryDto, @Res() res: Response): Promise<void> {
    const since = q.since ?? 0;
    const limit = q.limit ?? 10000;

    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Transfer-Encoding', 'chunked');

    let written = 0;
    for (const line of this.svc.streamExport({ since, limit })) {
      // 判断是否可写（客户端断开保护）
      if (!res.write(line)) {
        await new Promise<void>((resolve) => res.once('drain', () => resolve()));
      }
      written++;
    }
    res.end();
    logger.info('export done', { written, since, limit });
  }

  // ─── GET /v1/annotations/health ──────────────────────────
  @Get('health')
  @ApiOperation({ summary: '健康检查' })
  health() {
    return this.svc.ping();
  }
}