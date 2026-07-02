// ============================================================
// @upload-engine/core — 框架无关上传内核公共出口
//   不依赖 React，可用于任意框架 / 原生 JS。
//   React 适配层见 './react'（独立 entry）。
// ============================================================

// ---- 核心调度器 ----
export { SmartUploader } from './smart-uploader'
export type { UploadOptions } from './smart-uploader'

/** 便捷工厂：创建一个上传内核实例 */
import { SmartUploader } from './smart-uploader'
export function createUploader(): SmartUploader {
  return new SmartUploader()
}

// ---- 类型系统 ----
export type {
  UploadScenario,
  UploadStatus,
  UploadConfig,
  UploadFile,
  UploadEvent,
  ChunkStatus,
  CompressFormat,
  CompressMeta,
  StorageAdapter,
  StorageUploadCtx,
} from './types'

// ---- 存储适配器 ----
export { createOSSAdapter } from './adapters/oss'
export type { OSSAdapterOptions, OSSPolicyResponse } from './adapters/oss'

// ---- 预设 ----
export { PRESETS, PRESET_META } from './presets'

// ---- 校验 ----
export { validateFiles, formatSize } from './validator'
export type { ValidationError } from './validator'
export { validateMagic, detectFileType, RISKY_TYPES } from './magic'
export type { MagicResult } from './magic'

// ---- 图片压缩 ----
export { compressImage, isImageFile, renameByMime } from './image-compressor'
export type { CompressOptions, CompressResult } from './image-compressor'

// ---- 完整性校验 ----
export {
  StreamingMerkleTree,
  buildMerkleRoot,
  sha256Hex,
  generateMerkleProof,
} from './merkle'
export type { MerkleProof, MerkleNode } from './merkle'

// ---- 自适应能力 ----
export { ConnectionManager } from './connection-manager'
export { CircuitBreaker } from './circuit-breaker'
export { Semaphore, retryWithBackoff, NonRetryableError } from './concurrency'
export { probeNetwork, calcChunkSize, AdaptiveChunker } from './adaptive-chunk'

// ---- 预览（图片/视频/音频/文档） ----
export { generatePreview } from './preview'
export type { FilePreview, PreviewType } from './preview'

// ---- 可观测 ----
export { telemetry } from './telemetry'
export type { UploadMetrics } from './telemetry'

// ---- 断点续传持久化 ----
export { ResumeStore } from './resume-store'

// ---- 技术点对比基准 ----
export {
  benchImageCases, benchHashCase, benchMagicCase, benchMerkleCase,
  makeSampleImage, makeLargeBlobFile,
} from './benchmarks'
export type { BenchCase, BenchBar } from './benchmarks'
export { simNetworkCases } from './bench-sim'
