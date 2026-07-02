// OCR 模板持久化（JSON 文件存储）
// 模型：claude-sonnet-4-6
//
// 模板 schema（自研 iocr，对标百度 iocr 控制台 2 步流程）：
//   {
//     id: string,
//     name: string,
//     scenario: 'finance' | 'medical' | 'general' | 'id-card',
//     sign?: string,                  // 百度 templateSign（可选，本地自研模板不需要）
//     referenceFields: Array<{        // 第 1 步：参照字段（锚点，用于图片对齐）
//       id: string,
//       name: string,                 // 显示名（如"发票号码标签"）
//       text: string,                 // 实际文字（如"发票号码"，用于 OCR 模糊匹配）
//       x: number, y: number, w: number, h: number,
//     }>,
//     fields: Array<{                 // 第 2 步：识别字段（要提取的数据）
//       id: string,
//       name: string,
//       type: 'string' | 'number' | 'date' | 'text',
//       x: number, y: number, w: number, h: number,
//     }>,
//     sampleImageUrl?: string,        // 样例图 URL（前端画框参照）
//     createdAt: number,
//     updatedAt: number,
//   }
//
// 存储：DERIVED_DIR/ocr-templates/<id>.json

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CONFIG } from './config.mjs'

const VALID_SCENARIOS = new Set(['finance', 'medical', 'general', 'id-card'])
const VALID_FIELD_TYPES = new Set(['string', 'number', 'date', 'text'])

/** 校验坐标 box（x/y/w/h 必须是有限数） */
function checkBox(o, label) {
  for (const k of ['x', 'y', 'w', 'h']) {
    if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) {
      throw new Error(`${label}.${k} must be number`)
    }
  }
}

function dir() {
  return path.join(CONFIG.DERIVED_DIR, 'ocr-templates')
}

function fileOf(id) {
  return path.join(dir(), `${id}.json`)
}

function validId(id) {
  return typeof id === 'string' && /^[\w-]{1,128}$/.test(id)
}

export function listTemplates({ scenario } = {}) {
  const d = dir()
  if (!fs.existsSync(d)) return []
  const items = []
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.json')) continue
    try {
      const t = JSON.parse(fs.readFileSync(path.join(d, f), 'utf-8'))
      if (scenario && t.scenario !== scenario) continue
      items.push(t)
    } catch (e) {
      console.warn('[ocr-template] skip bad file', f, e.message)
    }
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt)
  return items
}

export function getTemplate(id) {
  if (!validId(id)) return null
  const f = fileOf(id)
  if (!fs.existsSync(f)) return null
  try {
    return JSON.parse(fs.readFileSync(f, 'utf-8'))
  } catch {
    return null
  }
}

/**
 * 创建模板（带完整校验）
 * @param {{name, scenario, sign?, referenceFields?, fields, sampleImageUrl?}} input
 * @returns {object} 完整模板对象
 * @throws {Error} 校验失败
 */
export function createTemplate(input) {
  if (!input || typeof input !== 'object') throw new Error('input required')
  if (typeof input.name !== 'string' || !input.name.trim()) throw new Error('name required')
  if (!VALID_SCENARIOS.has(input.scenario)) throw new Error(`invalid scenario: ${input.scenario}`)
  if (!Array.isArray(input.fields) || input.fields.length === 0) throw new Error('fields required (at least 1)')

  // 参照字段（可选，但若提供必须合法）
  let referenceFields = []
  if (input.referenceFields !== undefined) {
    if (!Array.isArray(input.referenceFields)) throw new Error('referenceFields must be array')
    for (const f of input.referenceFields) {
      if (!f || typeof f !== 'object') throw new Error('referenceField must be object')
      if (typeof f.name !== 'string' || !f.name.trim()) throw new Error('referenceField.name required')
      if (typeof f.text !== 'string' || !f.text.trim()) throw new Error('referenceField.text required')
      checkBox(f, 'referenceField')
    }
    referenceFields = input.referenceFields
  }

  for (const f of input.fields) {
    if (typeof f.name !== 'string' || !f.name.trim()) throw new Error('field.name required')
    if (f.type && !VALID_FIELD_TYPES.has(f.type)) throw new Error(`invalid field type: ${f.type}`)
    checkBox(f, 'field')
  }

  const now = Date.now()
  const tpl = {
    id: 'tpl_' + now.toString(36) + crypto.randomBytes(4).toString('hex'),
    name: input.name.trim(),
    scenario: input.scenario,
    sign: input.sign || '',
    referenceFields: referenceFields.map(f => ({
      id: 'r_' + crypto.randomBytes(4).toString('hex'),
      name: f.name.trim(),
      text: f.text.trim(),
      x: f.x, y: f.y, w: f.w, h: f.h,
    })),
    fields: input.fields.map(f => ({
      id: 'f_' + crypto.randomBytes(4).toString('hex'),
      name: f.name.trim(),
      type: f.type || 'string',
      x: f.x, y: f.y, w: f.w, h: f.h,
    })),
    sampleImageUrl: input.sampleImageUrl || '',
    createdAt: now,
    updatedAt: now,
  }

  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(fileOf(tpl.id), JSON.stringify(tpl, null, 2))
  console.log(`[ocr-template] created id=${tpl.id} name=${tpl.name} scenario=${tpl.scenario} refFields=${tpl.referenceFields.length} fields=${tpl.fields.length}`)
  return tpl
}

export function deleteTemplate(id) {
  if (!validId(id)) return false
  const f = fileOf(id)
  if (!fs.existsSync(f)) return false
  fs.unlinkSync(f)
  console.log(`[ocr-template] deleted id=${id}`)
  return true
}

export function _resetForTests() {
  const d = dir()
  fs.rmSync(d, { recursive: true, force: true })
}
