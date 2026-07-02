/**
 * 标注聚合 Service（SQLite CRUD + 聚合查询 + 流式导出）
 * 模型：claude-sonnet-4-6（MiniMax-M3 路由）
 */
import { Inject, Injectable } from '@nestjs/common';
import type { DB } from '../database/database.module';
import { DATABASE } from '../database/database.module';
import { Annotation, IngestResponse, StatsResponse, ValidationErrorEntry, ExportStatsResponse } from '../shared/types';
import { logger } from '../shared/logger';

@Injectable()
export class AnnotationsService {
  constructor(@Inject(DATABASE) private readonly db: DB) {}

  // ─── ingest ─────────────────────────────────────────────
  /** 批量 upsert；已存在的 id 跳过（幂等） */
  async ingest(items: Annotation[]): Promise<IngestResponse> {
    if (items.length === 0) return { accepted: 0, rejected: [] };

    const rejected: ValidationErrorEntry[] = [];
    const valid: Annotation[] = [];

    // 先做基础校验（DTO 已校验过 schema；这里做业务校验 + 安全 normalize）
    items.forEach((it, idx) => {
      const errs: string[] = [];
      if (!Array.isArray(it.langPair) || it.langPair.length !== 2) {
        errs.push('langPair must be [src, tgt]');
      }
      if (!it.id || typeof it.id !== 'string') errs.push('id missing');
      if (!it.srcSegmentId) errs.push('srcSegmentId missing');
      if (!it.modelVersion) errs.push('modelVersion missing');
      if (it.srcText.length > 5000) errs.push('srcText too long');
      if (it.tgtText.length > 5000) errs.push('tgtText too long');

      if (errs.length > 0) {
        rejected.push({ index: idx, id: it.id, errors: errs });
      } else {
        valid.push(it);
      }
    });

    if (valid.length === 0) return { accepted: 0, rejected };

    // 批量 upsert（SQLite 用 INSERT OR IGNORE 实现幂等）
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO annotations (
        id, kind, schema_version, url, dom_path, src_segment_id,
        lang_pair, src_text, tgt_text, src_tokens_json, tgt_tokens_json,
        predicted_json, model_version, payload_json, context_json,
        created_at, app_version, user_agent, received_at
      ) VALUES (
        @id, @kind, @schema_version, @url, @dom_path, @src_segment_id,
        @lang_pair, @src_text, @tgt_text, @src_tokens_json, @tgt_tokens_json,
        @predicted_json, @model_version, @payload_json, @context_json,
        @created_at, @app_version, @user_agent, @received_at
      )
    `);

    const acceptedIds: string[] = [];
    const tx = this.db.transaction((batch: Annotation[]) => {
      for (const a of batch) {
        const info = insert.run({
          id: a.id,
          kind: a.kind,
          schema_version: a.schemaVersion,
          url: a.url,
          dom_path: a.domPath,
          src_segment_id: a.srcSegmentId,
          lang_pair: a.langPair.join('-'),
          src_text: a.srcText,
          tgt_text: a.tgtText,
          src_tokens_json: JSON.stringify(a.srcTokens),
          tgt_tokens_json: JSON.stringify(a.tgtTokens),
          predicted_json: JSON.stringify(a.predicted),
          model_version: a.modelVersion,
          payload_json: JSON.stringify(a.payload ?? {}),
          context_json: a.context ? JSON.stringify(a.context) : null,
          created_at: a.createdAt,
          app_version: a.appVersion ?? null,
          user_agent: a.userAgent ?? null,
          received_at: Date.now(),
        });
        if (info.changes > 0) acceptedIds.push(a.id);
      }
    });

    try {
      tx(valid);
    } catch (e) {
      logger.error('ingest tx failed', { err: String(e) });
      throw e;
    }

    // accepted = 真正被插入的（去重后）
    return { accepted: acceptedIds.length, rejected };
  }

  // ─── stats ──────────────────────────────────────────────
  async getStats(): Promise<StatsResponse> {
    const total = (this.db.prepare(`SELECT COUNT(*) AS c FROM annotations`).get() as { c: number }).c;

    const byKindRows = this.db
      .prepare(`SELECT kind, COUNT(*) AS c FROM annotations GROUP BY kind`)
      .all() as Array<{ kind: string; c: number }>;
    const byKind: Record<string, number> = {};
    for (const r of byKindRows) byKind[r.kind] = r.c;

    const byLangRows = this.db
      .prepare(`SELECT lang_pair, COUNT(*) AS c FROM annotations GROUP BY lang_pair`)
      .all() as Array<{ lang_pair: string; c: number }>;
    const byLangPair: Record<string, number> = {};
    for (const r of byLangRows) byLangPair[r.lang_pair] = r.c;

    const byModelRows = this.db
      .prepare(`SELECT model_version, COUNT(*) AS c FROM annotations GROUP BY model_version`)
      .all() as Array<{ model_version: string; c: number }>;
    const byModelVersion: Record<string, number> = {};
    for (const r of byModelRows) byModelVersion[r.model_version] = r.c;

    const last24hCutoff = Date.now() - 24 * 3600 * 1000;
    const last24h = (this.db
      .prepare(`SELECT COUNT(*) AS c FROM annotations WHERE created_at >= ?`)
      .get(last24hCutoff) as { c: number }).c;

    // topDomains: 解析 url 域名
    const urlRows = this.db
      .prepare(`SELECT url FROM annotations ORDER BY created_at DESC LIMIT 5000`)
      .all() as Array<{ url: string }>;
    const domainCounts = new Map<string, number>();
    for (const r of urlRows) {
      try {
        const u = new URL(r.url);
        const host = u.hostname.replace(/^www\./, '');
        domainCounts.set(host, (domainCounts.get(host) ?? 0) + 1);
      } catch {
        // 忽略
      }
    }
    const topDomains = Array.from(domainCounts.entries())
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      total,
      byKind,
      byLangPair,
      byModelVersion,
      last24h,
      topDomains,
      generatedAt: Date.now(),
    };
  }

  // ─── export stats ───────────────────────────────────────
  /** 检查是否达到训练准入门槛（方案 §6.3） */
  async getExportStats(): Promise<ExportStatsResponse> {
    const MIN_SAMPLES = 500;
    const MIN_URLS = 10;
    const MIN_LANG_PAIRS = 3;

    const samples = (this.db.prepare(`SELECT COUNT(*) AS c FROM annotations`).get() as { c: number }).c;
    const urls = (this.db
      .prepare(`SELECT COUNT(DISTINCT url) AS c FROM annotations`)
      .get() as { c: number }).c;
    const langPairs = (this.db
      .prepare(`SELECT COUNT(DISTINCT lang_pair) AS c FROM annotations`)
      .get() as { c: number }).c;

    const ready = samples >= MIN_SAMPLES && urls >= MIN_URLS && langPairs >= MIN_LANG_PAIRS;

    return {
      ready,
      total: samples,
      thresholds: { minSamples: MIN_SAMPLES, minUrls: MIN_URLS, minLangPairs: MIN_LANG_PAIRS },
      current: { samples, urls, langPairs },
      missing: {
        samples: Math.max(0, MIN_SAMPLES - samples),
        urls: Math.max(0, MIN_URLS - urls),
        langPairs: Math.max(0, MIN_LANG_PAIRS - langPairs),
      },
    };
  }

  // ─── stream export ──────────────────────────────────────
  /**
   * 生成 NDJSON 流式迭代器
   * 按 created_at 升序游标，避免一次性加载全表
   */
  *streamExport(opts: { since?: number; limit?: number } = {}): Generator<string> {
    const since = opts.since ?? 0;
    const limit = opts.limit ?? 10000;

    const stmt = this.db.prepare(`
      SELECT id, kind, schema_version, url, dom_path, src_segment_id,
             lang_pair, src_text, tgt_text, src_tokens_json, tgt_tokens_json,
             predicted_json, model_version, payload_json, context_json,
             created_at, app_version, user_agent
      FROM annotations
      WHERE created_at >= ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `);

    let count = 0;
    for (const row of stmt.iterate(since, limit) as Iterable<{
      id: string;
      kind: string;
      schema_version: number;
      url: string;
      dom_path: string;
      src_segment_id: string;
      lang_pair: string;
      src_text: string;
      tgt_text: string;
      src_tokens_json: string;
      tgt_tokens_json: string;
      predicted_json: string;
      model_version: string;
      payload_json: string;
      context_json: string | null;
      created_at: number;
      app_version: string | null;
      user_agent: string | null;
    }>) {
      const obj = {
        id: row.id,
        kind: row.kind,
        schemaVersion: row.schema_version,
        url: row.url,
        domPath: row.dom_path,
        srcSegmentId: row.src_segment_id,
        langPair: row.lang_pair.split('-'),
        srcText: row.src_text,
        tgtText: row.tgt_text,
        srcTokens: JSON.parse(row.src_tokens_json),
        tgtTokens: JSON.parse(row.tgt_tokens_json),
        predicted: JSON.parse(row.predicted_json),
        modelVersion: row.model_version,
        payload: JSON.parse(row.payload_json),
        context: row.context_json ? JSON.parse(row.context_json) : undefined,
        createdAt: row.created_at,
        appVersion: row.app_version ?? undefined,
        userAgent: row.user_agent ?? undefined,
      };
      yield JSON.stringify(obj) + '\n';
      count++;
    }

    logger.info('export complete', { count, since, limit });
  }

  // ─── health ─────────────────────────────────────────────
  ping(): { ok: boolean; total: number } {
    const total = (this.db.prepare(`SELECT COUNT(*) AS c FROM annotations`).get() as { c: number }).c;
    return { ok: true, total };
  }
}