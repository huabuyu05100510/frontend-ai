// OCR 模块 — 图片文字识别 + 区域检测 + 结果对比
// 模型：claude-sonnet-4-6
//
// 行业对标：科大讯飞 OCR 识别平台 + 规则训练
//   - 支持 jpg/jpeg/png/bmp 等常见图片格式
//   - 支持文字区域检测（bounding box）
//   - 支持 OCR 结果对比标注
//   - 支持 AI 视觉模型（MiniMax/Zhipu/Volcano 多模态 API）
//
// API：
//   ocrImage(imagePath, opts) → Promise<OCRResult>
//   detectTextRegions(imagePath) → Promise<Region[]>
//   compareOCRResults(ref, test) → DiffResult
//
// 配置：
//   无 AI Key 时使用本地 base64 + heuristic 检测
//   MINIMAX_API_KEY / ZHIPU_API_KEY / VOLCANO_API_KEY 用于 AI 视觉 OCR

import fs from 'node:fs'
import path from 'node:path'
import { myersDiff } from './diff.mjs'

// ============ 类型定义 ============

/**
 * @typedef {{ text: string, x: number, y: number, width: number, height: number, confidence: number }} OCRRegion
 * @typedef {{ text: string, regions: OCRRegion[], engine: string, ms: number, imageSize?: {width:number, height:number} }} OCRResult
 * @typedef {{ text: string, errors: Array, ms: number }} OCRComparision
 */

// ============ 图片转 base64 ============

function imageToBase64(imagePath) {
  if (!fs.existsSync(imagePath)) throw new Error(`image not found: ${imagePath}`)
  const ext = path.extname(imagePath).toLowerCase()
  const mimeMap = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.bmp': 'image/bmp', '.gif': 'image/gif', '.webp': 'image/webp',
  }
  const mime = mimeMap[ext] || 'image/png'
  const buf = fs.readFileSync(imagePath)
  return `data:${mime};base64,${buf.toString('base64')}`
}

// ============ HTTP helper (复用) ============

async function postJSON(url, headers, body, timeoutMs = 60000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`${res.status} ${errText.slice(0, 200)}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// ============ MiniMax OCR (多模态) ============

async function ocrMiniMax(imagePath) {
  const key = process.env.MINIMAX_API_KEY
  if (!key) throw new Error('MINIMAX_API_KEY not configured')

  const base64 = imageToBase64(imagePath)

  const res = await postJSON(
    'https://api.minimax.chat/v1/text/chatcompletion_v2',
    { Authorization: `Bearer ${key}` },
    {
      model: process.env.MINIMAX_MODEL || 'MiniMax-Text-01',
      messages: [
        {
          role: 'system',
          content: `你是一个 OCR 文字识别引擎。从图片中识别所有文字。
输出严格 JSON，不要任何其他内容：
{"text":"识别出的完整文本","regions":[{"text":"区域1文字","x":10,"y":20,"width":100,"height":30},{"text":"区域2文字","x":50,"y":80,"width":200,"height":30}]}

坐标单位为像素。x,y 为区域左上角，width,height 为区域宽高。`,
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: base64 } },
            { type: 'text', text: '请识别此图片中的所有文字，返回 JSON 格式结果。' },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 1024,
    }
  )

  const content = res.choices?.[0]?.message?.content || ''
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return { text: content.trim(), regions: [], confidence: 0.8 }
  }
  const parsed = JSON.parse(jsonMatch[0])
  return {
    text: parsed.text || '',
    regions: (parsed.regions || []).map(r => ({
      text: r.text || '',
      x: r.x || 0, y: r.y || 0,
      width: r.width || 0, height: r.height || 0,
      confidence: r.confidence || 0.8,
    })),
  }
}

// ============ 智谱 GLM-4V OCR ============

async function ocrZhipu(imagePath) {
  const key = process.env.ZHIPU_API_KEY
  if (!key) throw new Error('ZHIPU_API_KEY not configured')

  const base64 = imageToBase64(imagePath)

  const res = await postJSON(
    'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    { Authorization: `Bearer ${key}` },
    {
      model: 'glm-4v-flash',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: base64 } },
            {
              type: 'text',
              text: `你是专业的 OCR 引擎。请识别图中所有可见文字。

要求：
1. 按"行"输出每段文字
2. 如果没有文字，返回 {"text":"","regions":[],"reason":"no_text"}
3. 严格 JSON 格式，不要 Markdown 代码块

返回结构：
{"text":"完整文本","regions":[{"text":"区域文字","x":0,"y":0,"width":100,"height":30,"confidence":0.9}]}

x,y 为该行文字左上角，width/height 为大致包围盒（像素）。`,
            },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 1024,
    }
  )

  const content = res.choices?.[0]?.message?.content || ''
  // 尝试解析 JSON；失败时回退到纯文本模式
  const jsonMatch = content.replace(/```json|```/g, '').match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    // 模型返回了纯文本（非 JSON 格式），将整段作为识别结果
    const cleanText = content.trim()
    return {
      text: cleanText,
      regions: cleanText ? [{ text: cleanText, x: 0, y: 0, width: 0, height: 0, confidence: 0.7 }] : [],
      confidence: 0.7,
    }
  }
  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      text: parsed.text || '',
      regions: (parsed.regions || []).map(r => ({
        text: r.text || '', x: r.x || 0, y: r.y || 0,
        width: r.width || 0, height: r.height || 0,
        confidence: r.confidence || 0.8,
      })),
      confidence: 0.85,
    }
  } catch (parseErr) {
    // JSON.parse 失败（模型输出了非标准 JSON），回退为整段文本
    return { text: content.trim(), regions: [], confidence: 0.5 }
  }
}

// ============ 本地 heuristic OCR（无 AI 时） ============

/**
 * 无 AI 时的本地 OCR 方案：
 *   - 读图片文件的尺寸信息（PNG/JPEG header 解析）
 *   - 返回空结果（提示需要 AI provider）
 */
function ocrHeuristic(imagePath) {
  if (!fs.existsSync(imagePath)) throw new Error(`image not found: ${imagePath}`)
  const buf = fs.readFileSync(imagePath)
  let width = 800, height = 600

  // 简单解析图片尺寸
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    // PNG
    width = buf.readUInt32BE(16)
    height = buf.readUInt32BE(20)
  } else if (buf[0] === 0xFF && buf[1] === 0xD8) {
    // JPEG - 扫描 SOF marker
    let i = 2
    while (i < buf.length - 1) {
      if (buf[i] === 0xFF && buf[i + 1] >= 0xC0 && buf[i + 1] <= 0xC2) {
        height = buf.readUInt16BE(i + 5)
        width = buf.readUInt16BE(i + 7)
        break
      }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }

  return {
    imageSize: { width, height },
    text: '',
    regions: [],
    confidence: 0,
  }
}

// ============ 统一入口 ============

// OCR 需要视觉模型。纯文本模型（MiniMax-Text-01）不支持 image_url，
// 会原样回显 system prompt。火山引擎需要专门的视觉 endpoint。
const VISION_PROVIDERS = new Set(['zhipu'])
const PROVIDER_KEY_MAP = {
  minimax: 'MINIMAX_API_KEY',
  zhipu: 'ZHIPU_API_KEY',
  volcano: 'VOLCANO_API_KEY',
}

/** Mock OCR provider — 演示/离线模式：返回固定示例 regions（带 imageSize） */
function ocrMock(imagePath) {
  const dims = ocrHeuristic(imagePath)?.imageSize || { width: 800, height: 600 }
  const W = dims.width, H = dims.height
  // 5 个示例区域，按图片宽高比例摆放
  const lines = [
    { text: '标题文字', x: 0.10, y: 0.08, w: 0.40, h: 0.10, conf: 0.95 },
    { text: '副标题示例', x: 0.10, y: 0.20, w: 0.30, h: 0.06, conf: 0.88 },
    { text: '这是第一段正文内容', x: 0.10, y: 0.35, w: 0.55, h: 0.08, conf: 0.92 },
    { text: '这是第二段正文内容', x: 0.10, y: 0.50, w: 0.50, h: 0.08, conf: 0.75 },
    { text: '页脚说明文字', x: 0.10, y: 0.85, w: 0.35, h: 0.05, conf: 0.42 },
  ]
  return {
    imageSize: { width: W, height: H },
    text: lines.map(l => l.text).join('\n'),
    regions: lines.map(l => ({
      text: l.text,
      x: Math.round(l.x * W),
      y: Math.round(l.y * H),
      width: Math.round(l.w * W),
      height: Math.round(l.h * H),
      confidence: l.conf,
    })),
  }
}

/** 选择可用的 OCR provider：尊重用户选择，自动回退到 vision-capable 模型 */
function pickOcrProvider(requested) {
  // 1. 用户明确指定 'mock' → 演示模式
  if (requested === 'mock') return 'mock'
  // 2. 用户明确指定 + 有 key + 是视觉模型 → 用
  if (requested && requested !== 'heuristic' && requested !== 'mock') {
    const keyName = PROVIDER_KEY_MAP[requested]
    if (keyName && process.env[keyName] && VISION_PROVIDERS.has(requested)) {
      return requested
    }
    // 显式指定了非视觉模型：警告并回退
    if (keyName && process.env[keyName] && !VISION_PROVIDERS.has(requested)) {
      console.warn(`[ocr] provider '${requested}' is text-only, fallback to vision-capable model`)
    }
  }
  // 3. 回退：按优先级选第一个有 key 的 vision provider
  for (const p of ['zhipu']) {
    const keyName = PROVIDER_KEY_MAP[p]
    if (keyName && process.env[keyName]) return p
  }
  // 4. 都没有 → heuristic
  return 'heuristic'
}

/**
 * OCR 图片文字识别
 *
 * @param {string} imagePath - 图片文件路径
 * @param {{ provider?: 'minimax'|'zhipu'|'volcano'|'heuristic', lang?: string }} opts
 * @returns {Promise<OCRResult>}
 */
export async function ocrImage(imagePath, opts = {}) {
  const t0 = Date.now()
  const requested = opts.provider || process.env.OCR_PROVIDER || process.env.TRANSLATE_PROVIDER || 'zhipu'
  const effective = pickOcrProvider(requested)

  // 检查图片是否存在
  if (!fs.existsSync(imagePath)) {
    throw new Error(`image not found: ${imagePath}`)
  }

  try {
    let ocrData
    let engine

    switch (effective) {
      case 'minimax':
        ocrData = await ocrMiniMax(imagePath)
        engine = 'minimax-text-01-v1'
        break
      case 'zhipu':
        ocrData = await ocrZhipu(imagePath)
        engine = 'zhipu-glm-4v-v1'
        break
      case 'mock':
        ocrData = ocrMock(imagePath)
        engine = 'mock-v1'
        break
      default:
        ocrData = ocrHeuristic(imagePath)
        engine = 'heuristic-v1'
    }

    const ms = Date.now() - t0
    console.log(`[ocr] provider=${effective} engine=${engine} textLen=${ocrData.text?.length||0} regions=${ocrData.regions?.length||0} ms=${ms}`)

    return {
      text: ocrData.text || '',
      regions: (ocrData.regions || []).map(r => ({
        text: r.text || '',
        x: r.x || 0, y: r.y || 0,
        width: r.width || 0, height: r.height || 0,
        confidence: r.confidence || 0,
      })),
      engine,
      ms,
      imageSize: ocrData.imageSize || null,
    }
  } catch (e) {
    const ms = Date.now() - t0
    console.error(`[ocr] ${effective} failed: ${e.message}, ms=${ms}`)
    return {
      text: '',
      regions: [],
      engine: `${effective}-error`,
      ms,
      error: e.message,
    }
  }
}

/**
 * 文字区域检测（从 OCR 结果中提取 regions）
 * @param {string} imagePath
 * @returns {Promise<{regions:OCRRegion[], ms:number}>}
 */
export async function detectTextRegions(imagePath) {
  const t0 = Date.now()
  const result = await ocrImage(imagePath)
  const ms = Date.now() - t0
  return { regions: result.regions, ms }
}

// ============ OCR 结果对比（对标讯飞 OCR 训练模板） ============

/**
 * 对比 reference（标准答案）和 test（实际 OCR 结果）
 * 返回差异列表，用于 OCR 规则训练标注
 *
 * @param {string} reference - 标准文本（标注的真值）
 * @param {string} test - OCR 识别结果
 * @returns {OCRComparision}
 */
export function compareOCRResults(reference, test) {
  const t0 = Date.now()

  if (!reference && !test) {
    return { text: '', errors: [], ms: 0 }
  }

  const ops = myersDiff(reference, test)

  const errors = []
  let id = 0
  let refPos = 0, testPos = 0

  for (const op of ops) {
    if (op.op === 'equal') {
      const len = Array.from(op.text).length
      refPos += len
      testPos += len
    } else if (op.op === 'delete') {
      id++
      errors.push({
        id: 'ocr_err_' + id,
        referenceText: op.text,
        ocrText: '',
        position: refPos,
        type: 'missing', // OCR 漏识别
      })
      refPos += Array.from(op.text).length
    } else if (op.op === 'insert') {
      id++
      errors.push({
        id: 'ocr_err_' + id,
        referenceText: '',
        ocrText: op.text,
        position: testPos,
        type: 'extra', // OCR 多识别
      })
      testPos += Array.from(op.text).length
    }
  }

  const ms = Date.now() - t0
  return {
    text: test,
    errors,
    ms,
    meta: {
      referenceLength: Array.from(reference).length,
      ocrLength: Array.from(test).length,
      errorCount: errors.length,
    },
  }
}

/**
 * OCR 准确率计算
 * @param {string} reference - 标准答案
 * @param {string} test - OCR 结果
 * @returns {{ accuracy: number, precision: number, recall: number, f1: number }}
 */
export function ocrAccuracy(reference, test) {
  const ref = Array.from(reference)
  const tst = Array.from(test)

  let correct = 0
  const minLen = Math.min(ref.length, tst.length)
  for (let i = 0; i < minLen; i++) {
    if (ref[i] === tst[i]) correct++
  }

  const precision = tst.length > 0 ? correct / tst.length : 0
  const recall = ref.length > 0 ? correct / ref.length : 0
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0

  return {
    accuracy: Math.max(ref.length, tst.length) > 0 ? correct / Math.max(ref.length, tst.length) : 1,
    precision: +precision.toFixed(4),
    recall: +recall.toFixed(4),
    f1: +f1.toFixed(4),
  }
}

export default { ocrImage, detectTextRegions, compareOCRResults, ocrAccuracy }