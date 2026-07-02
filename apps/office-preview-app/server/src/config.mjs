// 全局配置：路径、端口、MIME、格式分类
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')            // apps/office-preview-app
const PROJECT_ROOT = path.resolve(ROOT, '..')              // 前端AI面试题/apps 的父级
const SAMPLES_DIR = path.resolve(PROJECT_ROOT, '..', 'files') // 前端AI面试题/files

export const CONFIG = {
  PORT: Number(process.env.PORT || 5180),
  HOST: `http://localhost:${process.env.PORT || 5180}`,
  // 数据落盘：upload 原文件 + derived 转码产物
  DATA_DIR: path.resolve(ROOT, '.data'),
  UPLOAD_DIR: path.resolve(ROOT, '.data', 'uploads'),
  DERIVED_DIR: path.resolve(ROOT, '.data', 'derived'),
  META_FILE: path.resolve(ROOT, '.data', 'tasks.json'),
  // 首次启动时扫描预置样本目录（不存在则跳过）
  SAMPLES_DIR,
  SOFFICE: process.env.SOFFICE || '/opt/homebrew/bin/soffice',
  // 单文件大小上限（500MB），与 V1 方案对齐
  MAX_FILE_SIZE: 500 * 1024 * 1024,
  // 转码并发
  CONVERT_CONCURRENCY: 2,
  // 单次转码超时（10 分钟，覆盖超大文件）
  CONVERT_TIMEOUT_MS: 10 * 60 * 1000
}

export const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.pcm': 'audio/pcm', '.amr': 'audio/amr',
  '.mp4': 'video/mp4', '.m4v': 'video/x-m4v', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.flv': 'video/x-flv', '.webm': 'video/webm',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword', '.ppt': 'application/vnd.ms-powerpoint',
  '.xls': 'application/vnd.ms-excel'
}

// 渲染决策矩阵：每个扩展名走哪条预览链路
//   pdf      → pdf.js 直接渲染
//   docx/pptx/xlsx/doc/ppt/xls → soffice 后端转 PDF，前端走 pdf.js
//   图片/音视频 → 原生 + Range
export const RENDER_STRATEGY = {
  // 直接前端渲染（无需后端转码）
  FRONTEND: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'svg', 'txt', 'md', 'mp3', 'wav', 'm4a', 'aac', 'mp4', 'm4v', 'mov', 'mkv', 'flv', 'webm'],
  // 需要后端 soffice 转 PDF
  CONVERT_TO_PDF: ['docx', 'pptx', 'xlsx', 'doc', 'ppt', 'xls']
}

export function extOf(name) {
  return (path.extname(name || '').toLowerCase().replace(/^\./, '') || '').toLowerCase()
}

export function mimeOf(name) {
  return MIME[path.extname(name).toLowerCase()] || 'application/octet-stream'
}

export function strategyOf(ext) {
  if (RENDER_STRATEGY.FRONTEND.includes(ext)) return 'frontend'
  if (RENDER_STRATEGY.CONVERT_TO_PDF.includes(ext)) return 'convert_pdf'
  return 'unsupported'
}
