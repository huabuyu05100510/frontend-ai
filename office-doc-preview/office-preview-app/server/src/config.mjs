// 全局配置：路径、端口、MIME、格式分类
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')            // office-preview-app/
const PROJECT_ROOT = path.resolve(ROOT, '..')              // 前端AI面试题/office-doc-preview/
// 样本目录：office-doc-preview/files（兼容 apps/../files 历史路径）
const SAMPLES_DIR_CANDIDATES = [
  path.resolve(ROOT, '..', 'files'),          // office-doc-preview/files（实际位置）
  path.resolve(PROJECT_ROOT, '..', 'files'),  // 前端AI面试题/files（历史路径）
]
const SAMPLES_DIR = SAMPLES_DIR_CANDIDATES.find(d => fs.existsSync(d)) || SAMPLES_DIR_CANDIDATES[0]

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
  CONVERT_TIMEOUT_MS: 10 * 60 * 1000,
  // ============ OnlyOffice Document Server ============
  ONLYOFFICE_HOST: process.env.ONLYOFFICE_HOST || 'http://localhost:8080',
  ONLYOFFICE_JWT_SECRET: process.env.ONLYOFFICE_JWT_SECRET || 'mvtndSBp0a7fa400u81Cq2MSfddXD090',
  HOST_FOR_DOCKER: process.env.HOST_FOR_DOCKER || 'http://host.docker.internal:5180',
  // ============ PDF 栅格化（pdftoppm / pdfinfo / poppler） ============
  // 注：自 v3 起，PNG 渲染 + 文字坐标改用 PDFium C++（@hyzyla/pdfium WASM）
  //   - 同引擎同时出 PNG + 字符 bbox → 100% 像素对齐（消除 pdftoppm+pdftotext 跨引擎漂移）
  //   - PDFTOPPM/PDFINFO 保留为 fallback（@hyzyla/pdfium init 失败时使用）
  PDFTOPPM: process.env.PDFTOPPM || '/opt/homebrew/bin/pdftoppm',
  PDFINFO: process.env.PDFINFO || '/opt/homebrew/bin/pdfinfo',
  RASTERIZE_THUMB_DPI: Number(process.env.RASTERIZE_THUMB_DPI || 96),
  RASTERIZE_PAGE_DPI: Number(process.env.RASTERIZE_PAGE_DPI || 120),
  RASTERIZE_PAGE_PARALLEL: Number(process.env.RASTERIZE_PAGE_PARALLEL || 2),
  RASTERIZE_TIMEOUT_MS: Number(process.env.RASTERIZE_TIMEOUT_MS || 5 * 60 * 1000),
  RASTERIZE_MAX_PAGES: Number(process.env.RASTERIZE_MAX_PAGES || 200),
  // ============ PDFium 引擎配置 ============
  // 单进程 LRU 缓存 N 个文档句柄；空闲 idleMs 后自动 evict 释放 WASM 内存
  PDFIUM_CACHE_MAX_DOCS: Number(process.env.PDFIUM_CACHE_MAX_DOCS || 5),
  PDFIUM_CACHE_IDLE_MS: Number(process.env.PDFIUM_CACHE_IDLE_MS || 30000),
  // ============ 静态前端（web/dist）========
  // 生产模式：服务端托管 Vite 产物，提供单端口入口（http://localhost:5180/）
  // 开发模式：前端在 Vite dev server (5188)，用 proxy 转发 /api 到这里
  // ROOT 是 office-preview-app/，所以 web/dist 是 ROOT/web/dist
  WEB_DIST_DIR: process.env.WEB_DIST_DIR_OVERRIDE || path.resolve(ROOT, 'web', 'dist')
}

// 生产模式强制要求显式 JWT 密钥
if (process.env.NODE_ENV === 'production' && !process.env.ONLYOFFICE_JWT_SECRET) {
  throw new Error('[config] ONLYOFFICE_JWT_SECRET required in production')
}

export const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json',
  // Web 前端资源（Vite 产物）
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
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
