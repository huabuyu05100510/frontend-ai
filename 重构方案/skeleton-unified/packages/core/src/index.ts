/**
 * @skeleton/core - 骨架屏算法核心
 *
 * 纯算法包，无任何平台依赖（无 DOM / RN / 小程序 API）。
 * 各平台通过 @skeleton/adapter-web / adapter-rn / adapter-taro 接入。
 */

// 类型
export type {
  Bone,
  CompactBone,
  AnyBone,
  SkeletonData,
  ResponsiveSkeletonData,
  Rect,
  NodeStyles,
  NodeMeasurement,
  SkeletonDescriptor,
  ResponsiveDescriptor,
  ExtractConfig,
  AnimationStyle,
  AnimationConfig,
  Scheduler,
  Storage,
  PlatformAdapter,
} from './types.js'

export { normalizeBone, compactBone } from './types.js'

// 工具函数
export {
  toPercent,
  round2,
  roundN,
  rectToPercent,
  parseRadius,
  adjustColor,
  isTransparent,
  resolveBreakpoint,
  fnv1a32,
  SHIMMER_DEFAULTS,
  PULSE_DEFAULTS,
  CONTAINER_DEFAULTS,
  COLOR_DEFAULTS,
} from './utils.js'

// 拓扑压缩
export {
  isRedundantWrapper,
  collapseRedundantWrappers,
} from './topology.js'
export type { TopologyStats } from './topology.js'

// 骨架提取
export {
  extractBones,
  extractBonesWithStats,
  packSkeletonData,
} from './extract.js'

// 调度器
export {
  createRICScheduler,
  createSyncScheduler,
  createWxNextTickScheduler,
  ChunkedWalker,
  walkAsync,
} from './scheduler.js'

// 压缩
export {
  encodeBinary,
  decodeBinary,
  lzwEncode,
  lzwDecode,
  compressSkeletonData,
  decompressSkeletonData,
  serializeToBase64,
  deserializeFromBase64,
} from './compressor.js'
