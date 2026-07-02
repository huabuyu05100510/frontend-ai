// AI 平台全局配置
// 模型：claude-sonnet-4-6

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

export const CONFIG = {
  PORT: Number(process.env.PORT || 5180),
  HOST: `http://localhost:${process.env.PORT || 5180}`,
  DATA_DIR: path.resolve(ROOT, '.data'),
  UPLOAD_DIR: path.resolve(ROOT, '.data', 'uploads'),

  // AI Provider
  TRANSLATE_PROVIDER: process.env.TRANSLATE_PROVIDER || 'mock',
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY || '',
  ZHIPU_API_KEY: process.env.ZHIPU_API_KEY || '',
  VOLCANO_API_KEY: process.env.VOLCANO_API_KEY || '',

  MAX_TEXT_LENGTH: 200 * 1024,
  MAX_FILE_SIZE: 500 * 1024 * 1024,
}

fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true })
fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true })

export const LANG_MAP = {
  'zh-CN': '简体中文', en: 'English', ja: '日本語', ko: '한국어',
  fr: 'Français', de: 'Deutsch', es: 'Español', ru: 'Русский',
}
export const SUPPORTED_LANGS = Object.keys(LANG_MAP)
export const SUPPORTED_LANG_SET = new Set(SUPPORTED_LANGS)
