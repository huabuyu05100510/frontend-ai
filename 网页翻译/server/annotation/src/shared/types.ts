/**
 * 共享类型（与 extension/src/shared/types.ts 对齐）
 * 修改时请同步两边
 *
 * 模型：claude-sonnet-4-6（MiniMax-M3 路由）
 */

/** 标注类型枚举（与方案 §2 对齐） */
export const AnnotationKind = Object.freeze({
  ALIGN_FIX: 'align_fix',
  SEG_RATING: 'seg_rating',
  ALT_TRANS: 'alt_trans', // 远期，不在 MVP
} as const);

export type AnnotationKindType =
  (typeof AnnotationKind)[keyof typeof AnnotationKind];

/** 类型 A：词级 alignment 修正 payload */
export interface AlignFixPayload {
  srcTokenIdx: number;
  predictedTgtTokenIdx: number;
  correctedTgtTokenIdx: number | null;
  correctionKind: 'change' | 'remove' | 'add';
}

/** 类型 B：段级 1-5 星评分 payload */
export interface SegRatingPayload {
  rating: 1 | 2 | 3 | 4 | 5;
}

/** 上下文窗口 */
export interface AnnotationContext {
  prevSrc?: string;
  nextSrc?: string;
}

/** 标注主结构（与 docs/annotation-feature-tech-plan-V1.md §3.1 一致） */
export interface Annotation {
  id: string;
  kind: AnnotationKindType;
  schemaVersion: number;

  // 来源上下文
  url: string;
  domPath: string;
  srcSegmentId: string;
  langPair: [string, string];

  // 文本内容
  srcText: string;
  tgtText: string;
  srcTokens: string[];
  tgtTokens: string[];

  // 算法快照
  predicted: Array<[number, number]>;
  modelVersion: string;

  // 类型特定 payload
  payload: AlignFixPayload | SegRatingPayload | Record<string, unknown>;

  // 上下文窗口
  context?: AnnotationContext;

  // 元数据
  createdAt: number;
  appVersion?: string;
  userAgent?: string;
}

/** ingest 端点响应 */
export interface IngestResponse {
  accepted: number;
  rejected: ValidationErrorEntry[];
}

export interface ValidationErrorEntry {
  index: number;
  id?: string;
  errors: string[];
}

/** stats 端点响应 */
export interface StatsResponse {
  total: number;
  byKind: Record<string, number>;
  byLangPair: Record<string, number>;
  byModelVersion: Record<string, number>;
  last24h: number;
  topDomains: Array<{ domain: string; count: number }>;
  generatedAt: number;
}

/** export stats 端点响应 */
export interface ExportStatsResponse {
  ready: boolean;
  total: number;
  thresholds: {
    minSamples: number;
    minUrls: number;
    minLangPairs: number;
  };
  current: {
    samples: number;
    urls: number;
    langPairs: number;
  };
  missing: {
    samples: number;
    urls: number;
    langPairs: number;
  };
}