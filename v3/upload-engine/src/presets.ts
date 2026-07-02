import type { UploadConfig, UploadScenario } from './types'

// 默认接口地址（demo 使用 mock）
const API = {
  uploadUrl: '/api/upload',
  chunkUrl: '/api/upload/chunk',
  mergeUrl: '/api/upload/merge',
  checkUrl: '/api/upload/check',
}

/** 全格式上传 — 接受任意类型，图片自动压缩 */
const universal: UploadConfig = {
  scenario: 'universal',
  accept: ['*'],                // 通配：放行所有格式
  maxSize: 2 * 1024 * 1024 * 1024, // 2GB
  maxCount: 20,
  chunkSize: 4 * 1024 * 1024,   // 大文件自动分片
  concurrent: 3,
  retry: 3,
  exifCorrect: true,            // 图片自动 EXIF 矫正
  compress: true,              // 图片上传前自动压缩
  compressQuality: 0.82,
  compressMaxPx: 4096,
  compressFormat: 'auto',       // 按源格式+浏览器能力择优（AVIF/WebP/JPEG/PNG）
  ...API,
}

/** 文档上传 — 讯飞翻译平台 */
const document: UploadConfig = {
  scenario: 'document',
  accept: [
    'pdf', 'docx', 'ppt', 'pptx', 'txt', 'xls', 'xlsx', 'srt',
    'doc', 'xlsm', 'csv', 'html', 'htm', 'xml', 'json',
    'md', 'rtf', 'odt', 'ods', 'odp', 'wps', 'et', 'dps',
  ],
  maxSize: 1024 * 1024 * 1024,  // 1GB（PDF 等大文档）
  maxCount: 10,
  chunkSize: 4 * 1024 * 1024,   // 4MB 分片，大文档走分片上传
  concurrent: 1,
  retry: 3,
  exifCorrect: false,
  compress: false,
  compressQuality: 1,
  compressMaxPx: 9999,
  ...API,
}

/** 图片上传 — 讯飞图片翻译 / OCR */
const image: UploadConfig = {
  scenario: 'image',
  accept: ['jpg', 'jpeg', 'png', 'bmp'],
  maxSize: 4 * 1024 * 1024,    // 4MB
  maxCount: 10,
  maxDimension: { w: 10000, h: 10000 },
  minDimension: { w: 20, h: 20 },
  chunkSize: 0,
  concurrent: 1,
  retry: 3,
  exifCorrect: true,
  compress: true,              // OCR/翻译图片上传前压缩：高质量、保细节
  compressQuality: 0.9,
  compressMaxPx: 4096,         // OCR 需细节，保留较高分辨率
  compressFormat: 'auto',
  ...API,
}

/** 音频上传 — 讯飞音频翻译 */
const audio: UploadConfig = {
  scenario: 'audio',
  accept: ['mp3', 'wav', 's48', 'amr', 'wma', 'm4a', 'aac', 'pcm'],
  maxSize: 1024 * 1024 * 1024,  // 1GB
  maxCount: 5,
  chunkSize: 4 * 1024 * 1024,   // 4MB / 片
  concurrent: 3,
  retry: 3,
  exifCorrect: false,
  compress: false,
  compressQuality: 1,
  compressMaxPx: 9999,
  ...API,
}

/** 视频上传 — 讯飞视频翻译 */
const video: UploadConfig = {
  scenario: 'video',
  accept: ['mp4', 'm4v', 'mkv', 'flv', 'mov', 'wmv', 'mxf', 'avi', 'ts'],
  maxSize: 1024 * 1024 * 1024,  // 1GB
  maxCount: 5,
  chunkSize: 4 * 1024 * 1024,   // 4MB / 片
  concurrent: 3,
  retry: 3,
  exifCorrect: false,
  compress: false,
  compressQuality: 1,
  compressMaxPx: 9999,
  ...API,
}

/** AI 图搜 — 滴滴「在哪儿问问」 */
const aiImage: UploadConfig = {
  scenario: 'ai-image',
  accept: ['jpg', 'jpeg', 'png', 'heic', 'webp'],
  maxSize: 10 * 1024 * 1024,    // 10MB
  maxCount: 5,
  chunkSize: 0,
  concurrent: 1,
  retry: 2,
  exifCorrect: true,
  compress: true,
  compressQuality: 0.8,
  compressMaxPx: 1920,          // 最长边 1920px
  compressFormat: 'auto',
  compressTargetKB: 500,        // 目标 ≤ 500KB，自适应二分质量
  ...API,
}

export const PRESETS: Record<UploadScenario, UploadConfig> = {
  universal,
  document,
  image,
  audio,
  video,
  'ai-image': aiImage,
}

export const PRESET_META: Record<UploadScenario, { label: string; icon: string; desc: string }> = {
  universal: { label: '全格式', icon: '🌐', desc: '任意格式 · 图片自动压缩 · ≤ 2GB' },
  document:  { label: '文档上传', icon: '📄', desc: '23 种格式 · < 50MB · 批量 ≤ 10' },
  image:     { label: '图片上传', icon: '🖼️', desc: '4 种格式 · 上传前压缩 · 尺寸校验' },
  audio:     { label: '音频上传', icon: '🎵', desc: '9 种格式 · < 1GB · 分片续传' },
  video:     { label: '视频上传', icon: '🎬', desc: '10 种格式 · < 1GB · 分片续传' },
  'ai-image': { label: 'AI 图搜', icon: '🤖', desc: 'EXIF 矫正 · 压缩 · 预览' },
}