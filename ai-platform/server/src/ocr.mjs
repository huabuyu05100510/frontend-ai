// OCR 模块 — 图片文字识别 + 区域检测 + 结果对比
// 模型：claude-sonnet-4-6
import fs from 'node:fs'
import path from 'node:path'
import { myersDiff } from './diff.mjs'

function imageToBase64(imagePath) {
  if (!fs.existsSync(imagePath)) throw new Error(`image not found: ${imagePath}`)
  const ext = path.extname(imagePath).toLowerCase()
  const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.bmp': 'image/bmp', '.gif': 'image/gif', '.webp': 'image/webp' }
  return `data:${mimeMap[ext] || 'image/png'};base64,${fs.readFileSync(imagePath).toString('base64')}`
}

async function postJSON(url, headers, body, timeoutMs = 60000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal })
    if (!res.ok) { const e = await res.text().catch(() => ''); throw new Error(`${res.status} ${e.slice(0, 200)}`) }
    return await res.json()
  } finally { clearTimeout(timer) }
}

async function ocrMiniMax(imagePath) {
  const key = process.env.MINIMAX_API_KEY
  if (!key) throw new Error('MINIMAX_API_KEY not set')
  const base64 = imageToBase64(imagePath)
  const res = await postJSON('https://api.minimaxi.chat/v1/text/chatcompletion_v2', { Authorization: `Bearer ${key}` }, {
    model: 'abab6.5s-chat',
    messages: [{
      role: 'system',
      content: `你是OCR识别引擎。从图片中识别所有文字，返回JSON：{"text":"完整文本","regions":[{"text":"文字","x":0,"y":0,"width":100,"height":30}]}`,
    }, { role: 'user', content: [{ type: 'image_url', image_url: { url: base64 } }, { type: 'text', text: '请识别图片中的文字，返回JSON。' }] }],
    temperature: 0, max_tokens: 4096,
  })
  const content = res.choices?.[0]?.message?.content || ''
  const m = content.match(/\{[\s\S]*\}/)
  if (!m) return { text: content.trim(), regions: [] }
  const p = JSON.parse(m[0])
  return { text: p.text || '', regions: (p.regions || []).map(r => ({ text: r.text || '', x: r.x || 0, y: r.y || 0, width: r.width || 0, height: r.height || 0, confidence: r.confidence || 0.8 })) }
}

async function ocrZhipu(imagePath) {
  const key = process.env.ZHIPU_API_KEY
  if (!key) throw new Error('ZHIPU_API_KEY not set')
  const base64 = imageToBase64(imagePath)
  const res = await postJSON('https://open.bigmodel.cn/api/paas/v4/chat/completions', { Authorization: `Bearer ${key}` }, {
    model: 'glm-4v-flash',
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: base64 } }, { type: 'text', text: '识别图片文字，返回JSON：{"text":"文本","regions":[{"text":"区","x":0,"y":0,"width":0,"height":0}]}' }] }],
    temperature: 0, max_tokens: 4096,
  })
  const content = res.choices?.[0]?.message?.content || ''
  const m = content.replace(/```json|```/g, '').match(/\{[\s\S]*\}/)
  if (!m) return { text: content.trim(), regions: [] }
  const p = JSON.parse(m[0])
  return { text: p.text || '', regions: (p.regions || []).map(r => ({ text: r.text || '', x: r.x || 0, y: r.y || 0, width: r.width || 0, height: r.height || 0, confidence: r.confidence || 0.8 })) }
}

function ocrHeuristic(imagePath) {
  if (!fs.existsSync(imagePath)) throw new Error(`image not found: ${imagePath}`)
  const buf = fs.readFileSync(imagePath)
  let width = 800, height = 600
  if (buf[0] === 0x89 && buf[1] === 0x50) { width = buf.readUInt32BE(16); height = buf.readUInt32BE(20) }
  else if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2
    while (i < buf.length - 1) {
      if (buf[i] === 0xFF && buf[i + 1] >= 0xC0 && buf[i + 1] <= 0xC2) { height = buf.readUInt16BE(i + 5); width = buf.readUInt16BE(i + 7); break }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  return { imageSize: { width, height }, text: '', regions: [] }
}

export async function ocrImage(imagePath, opts = {}) {
  const t0 = Date.now()
  if (!fs.existsSync(imagePath)) throw new Error(`image not found: ${imagePath}`)
  const resolved = opts.provider || process.env.TRANSLATE_PROVIDER || 'heuristic'
  const hasAI = !!(process.env.MINIMAX_API_KEY || process.env.ZHIPU_API_KEY || process.env.VOLCANO_API_KEY)
  const effective = (resolved !== 'heuristic' && hasAI) ? resolved : 'heuristic'

  try {
    let ocrData, engine
    switch (effective) {
      case 'minimax': ocrData = await ocrMiniMax(imagePath); engine = 'minimax-abab6.5s-v1'; break
      case 'zhipu': ocrData = await ocrZhipu(imagePath); engine = 'zhipu-glm-4v-v1'; break
      default: ocrData = ocrHeuristic(imagePath); engine = 'heuristic-v1'
    }
    const ms = Date.now() - t0
    console.log(`[ocr] provider=${effective} engine=${engine} text=${ocrData.text?.length||0} regions=${ocrData.regions?.length||0} ms=${ms}`)
    return {
      text: ocrData.text || '', engine, ms, imageSize: ocrData.imageSize || null,
      regions: (ocrData.regions || []).map(r => ({ text: r.text || '', x: r.x || 0, y: r.y || 0, width: r.width || 0, height: r.height || 0, confidence: r.confidence || 0 })),
    }
  } catch (e) {
    const ms = Date.now() - t0
    console.error(`[ocr] ${effective} failed: ${e.message} ms=${ms}`)
    return { text: '', regions: [], engine: `${effective}-error`, ms, error: e.message }
  }
}

export async function detectTextRegions(imagePath) {
  const t0 = Date.now(); const result = await ocrImage(imagePath); return { regions: result.regions, ms: Date.now() - t0 }
}

export function compareOCRResults(reference, test) {
  const t0 = Date.now()
  if (!reference && !test) return { text: '', errors: [], ms: 0 }
  const ops = myersDiff(reference, test)
  const errors = []; let id = 0, refPos = 0, testPos = 0
  for (const op of ops) {
    if (op.op === 'equal') { const len = Array.from(op.text).length; refPos += len; testPos += len }
    else if (op.op === 'delete') {
      id++; errors.push({ id: 'ocr_err_' + id, referenceText: op.text, ocrText: '', position: refPos, type: 'missing' })
      refPos += Array.from(op.text).length
    } else if (op.op === 'insert') {
      id++; errors.push({ id: 'ocr_err_' + id, referenceText: '', ocrText: op.text, position: testPos, type: 'extra' })
      testPos += Array.from(op.text).length
    }
  }
  return { text: test, errors, ms: Date.now() - t0, meta: { referenceLength: Array.from(reference).length, ocrLength: Array.from(test).length, errorCount: errors.length } }
}

export function ocrAccuracy(reference, test) {
  const ref = Array.from(reference), tst = Array.from(test)
  let correct = 0
  for (let i = 0; i < Math.min(ref.length, tst.length); i++) if (ref[i] === tst[i]) correct++
  const precision = tst.length > 0 ? correct / tst.length : 0
  const recall = ref.length > 0 ? correct / ref.length : 0
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0
  return { accuracy: Math.max(ref.length, tst.length) > 0 ? correct / Math.max(ref.length, tst.length) : 1, precision: +precision.toFixed(4), recall: +recall.toFixed(4), f1: +f1.toFixed(4) }
}
