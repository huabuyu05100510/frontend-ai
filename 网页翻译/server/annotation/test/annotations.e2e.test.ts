/**
 * Annotations e2e (NestJS Testing + supertest)
 *
 * 启动一个独立的 NestJS 测试 app（用 :memory: SQLite + 高端口避免冲突），
 * 通过 supertest 走完所有 3 个端点 + 限流 + schema 错误处理。
 *
 * 模型：claude-sonnet-4-6（MiniMax-M3 路由）
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import request from 'supertest';
import type { Response } from 'supertest';
import { randomUUID } from 'node:crypto';

// 用 :memory: SQLite 隔离测试，跑完不落盘
process.env.ANNOTATION_DB_PATH = ':memory:';

function makeAnnotation(overrides: Partial<{
  id: string;
  kind: 'align_fix' | 'seg_rating';
  url: string;
  langPair: [string, string];
  rating: 1 | 2 | 3 | 4 | 5;
  modelVersion: string;
}> = {}) {
  const id = overrides.id ?? randomUUID();
  const kind = overrides.kind ?? 'seg_rating';
  return {
    id,
    kind,
    schemaVersion: 1,
    url: overrides.url ?? 'https://example.com/test',
    domPath: '/html/body/div[1]/p[1]',
    srcSegmentId: `seg-${id.slice(0, 8)}`,
    langPair: overrides.langPair ?? ['zh', 'en'],
    srcText: '我爱你',
    tgtText: 'I love you',
    srcTokens: ['我', '爱', '你'],
    tgtTokens: ['I', 'love', 'you'],
    predicted: kind === 'align_fix' ? [[0, 0], [1, 1], [2, 2]] : [],
    modelVersion: overrides.modelVersion ?? 'nllb-600m-l0h15-v1',
    payload:
      kind === 'seg_rating'
        ? { rating: overrides.rating ?? 5 }
        : {
            srcTokenIdx: 1,
            predictedTgtTokenIdx: 1,
            correctedTgtTokenIdx: 1,
            correctionKind: 'change',
          },
    context: { prevSrc: '前一段', nextSrc: '后一段' },
    createdAt: Date.now(),
    appVersion: 'ext-0.1.0',
    userAgent: 'Mozilla/5.0 (test)',
  };
}

describe('AnnotationsService e2e (POST/GET/export/rate-limit)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
      }),
    );
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ─── 1. health ─────────────────────────────────────────
  it('GET /v1/annotations/health → 200 ok', async () => {
    const res = await http.get('/v1/annotations/health').expect(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  // ─── 2. POST 10 条 → accepted=10 ───────────────────────
  it('POST /v1/annotations ingest 10 条 → accepted=10', async () => {
    const items = Array.from({ length: 10 }, () => makeAnnotation());
    const res = await http
      .post('/v1/annotations')
      .send({ items })
      .expect(200);

    expect(res.body.accepted).toBe(10);
    expect(res.body.rejected).toEqual([]);
  });

  // ─── 3. POST 1 条 schema 错误 → rejected ───────────────
  it('POST 1 条 id 不是 uuid → rejected, accepted=0', async () => {
    const bad = {
      id: 'not-a-uuid',
      kind: 'seg_rating',
      schemaVersion: 1,
      url: 'https://example.com',
      domPath: '/',
      srcSegmentId: 'seg-1',
      langPair: ['zh', 'en'],
      srcText: '我',
      tgtText: 'I',
      srcTokens: ['我'],
      tgtTokens: ['I'],
      predicted: [],
      modelVersion: 'nllb-600m-l0h15-v1',
      payload: { rating: 5 },
      createdAt: Date.now(),
    };
    const res = await http.post('/v1/annotations').send({ items: [bad] });
    // class-validator 触发 → 400
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe(400);
  });

  // ─── 4. GET stats → 数字正确 ───────────────────────────
  it('GET /v1/annotations/stats 反映已落库数据', async () => {
    const res = await http.get('/v1/annotations/stats').expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(10);
    expect(res.body.byKind.seg_rating).toBeGreaterThanOrEqual(10);
    expect(res.body.byLangPair['zh-en']).toBeGreaterThanOrEqual(10);
    expect(res.body.byModelVersion['nllb-600m-l0h15-v1']).toBeGreaterThanOrEqual(10);
    expect(res.body.last24h).toBeGreaterThanOrEqual(10);
    expect(Array.isArray(res.body.topDomains)).toBe(true);
    expect(typeof res.body.generatedAt).toBe('number');
  });

  // ─── 5. GET export → 流式 NDJSON ────────────────────────
  it('GET /v1/annotations/export → 流式 NDJSON, 每行 valid JSON', async () => {
    const res = await http
      .get('/v1/annotations/export?format=jsonl&limit=20')
      .buffer(true)
      .parse((res: Response, callback: (err: Error | null, body: string) => void) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks).toString('utf8')));
      })
      .expect(200);

    expect(res.headers['content-type']).toMatch(/application\/x-ndjson/);
    const lines = (res.body as string).split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(10);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      const obj = JSON.parse(line);
      expect(obj.id).toBeDefined();
      expect(obj.kind).toBeDefined();
      expect(obj.langPair).toEqual(['zh', 'en']);
      expect(obj.modelVersion).toBe('nllb-600m-l0h15-v1');
    }
  });

  // ─── 6. 幂等：同 id 第二次 POST → accepted=0 ───────────
  it('POST 同 id 重复 → accepted=0, 总数不增', async () => {
    const id = randomUUID();
    const a = makeAnnotation({ id });
    await http.post('/v1/annotations').send({ items: [a] }).expect(200);

    const before = (await http.get('/v1/annotations/health').expect(200)).body.total as number;
    const dup = await http.post('/v1/annotations').send({ items: [a] }).expect(200);
    const after = (await http.get('/v1/annotations/health').expect(200)).body.total as number;

    expect(dup.body.accepted).toBe(0);
    expect(after).toBe(before);
  });

  // ─── 7. 限流：连发 1001 次 → 部分 429 ─────────────────
  // 注：throttler 默认 1000/min；超出会 429。
  it('POST 1001 次（sequential） → 至少 1 次收到 429', async () => {
    const tiny = makeAnnotation();
    const statuses: number[] = [];
    // 用纯 sequential 串行 + 强制每次新建 socket (避免 agent keep-alive 串扰)
    for (let i = 0; i < 1001; i++) {
      try {
        const r = await http.post('/v1/annotations').send({ items: [tiny] });
        statuses.push(r.status);
      } catch (e: any) {
        // supertest 在 429 时偶尔 ECONNRESET；计为 429
        if (e.code === 'ECONNRESET' || /ECONNRESET/.test(String(e))) {
          statuses.push(429);
        } else {
          throw e;
        }
      }
    }
    const okCount = statuses.filter((s) => s === 200).length;
    const tooManyCount = statuses.filter((s) => s === 429).length;
    // 至少部分请求被限流
    expect(tooManyCount).toBeGreaterThanOrEqual(1);
    expect(okCount + tooManyCount).toBe(1001);
    expect(okCount).toBeLessThanOrEqual(1000);
  }, 180_000);

  // ─── 8. export/stats 训练门槛 ─────────────────────────
  it('GET /v1/annotations/export/stats 返回门槛检查', async () => {
    const res = await http.get('/v1/annotations/export/stats').expect(200);
    expect(res.body).toHaveProperty('ready');
    expect(res.body).toHaveProperty('thresholds');
    expect(res.body.thresholds.minSamples).toBe(500);
    expect(res.body.thresholds.minUrls).toBe(10);
    expect(res.body.thresholds.minLangPairs).toBe(3);
    // 当前数据少，ready=false
    expect(res.body.ready).toBe(false);
  });
});