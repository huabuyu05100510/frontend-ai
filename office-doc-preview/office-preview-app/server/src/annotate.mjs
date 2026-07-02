// 标注存储（annotation store）— 任务级页面文字标注，JSON 文件持久化
// 模型：claude-sonnet-4-6
//
// 数据形状：
//   { id, taskId, page, text, note?, color?, createdAt, updatedAt }
//
// 存储路径：DERIVED_DIR/annotations/<taskId>.json（单文件包含该任务全部标注，原子写入）
//
// 设计要点：
//   - 内存 Map 缓存 + 文件持久化双层；首次访问懒加载
//   - 写入采用 tmp + rename 原子替换，避免崩溃半写
//   - 颜色彩票：默认黄色 #fff3bf，前端可覆盖
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CONFIG } from './config.mjs'

const ANNOT_DIR = () => path.join(CONFIG.DERIVED_DIR, 'annotations')

/** taskId → annotations[] */
const cache = new Map()

function filePathOf(taskId) {
  return path.join(ANNOT_DIR(), `${taskId}.json`)
}

/** 合法 taskId 校验（防止路径穿越） */
function validTaskId(id) {
  return typeof id === 'string' && /^[\w-]{1,128}$/.test(id)
}

function ensureDir() {
  fs.mkdirSync(ANNOT_DIR(), { recursive: true })
}

function load(taskId) {
  if (cache.has(taskId)) return cache.get(taskId)
  let list = []
  try {
    const raw = fs.readFileSync(filePathOf(taskId), 'utf-8')
    list = JSON.parse(raw)
    if (!Array.isArray(list)) list = []
  } catch { /* 文件不存在或解析失败，按空处理 */ }
  cache.set(taskId, list)
  return list
}

function persist(taskId) {
  ensureDir()
  const list = cache.get(taskId) || []
  const target = filePathOf(taskId)
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2))
  fs.renameSync(tmp, target)
}

/** 列出任务的全部标注 */
export function listAnnotations(taskId) {
  if (!validTaskId(taskId)) return []
  return load(taskId).slice()
}

/** 创建标注；返回新建对象 */
export function createAnnotation({ taskId, page, text, note, color }) {
  if (!validTaskId(taskId)) throw new Error('invalid taskId')
  if (typeof page !== 'number' || page < 1) throw new Error('invalid page')
  if (typeof text !== 'string' || text.length === 0) throw new Error('text required')
  if (text.length > 4096) throw new Error('text too long (>4096)')
  if (note !== undefined && (typeof note !== 'string' || note.length > 4096)) {
    throw new Error('note too long (>4096)')
  }
  const now = Date.now()
  const ann = {
    id: 'a_' + now.toString(36) + crypto.randomBytes(3).toString('hex'),
    taskId,
    page,
    text,
    note: note || '',
    color: color || '#fff3bf',
    createdAt: now,
    updatedAt: now,
  }
  const list = load(taskId)
  list.push(ann)
  persist(taskId)
  return ann
}

/** 删除标注；返回 true 命中 / false 未找到 */
export function deleteAnnotation(taskId, annId) {
  if (!validTaskId(taskId)) return false
  const list = load(taskId)
  const idx = list.findIndex(a => a.id === annId)
  if (idx < 0) return false
  list.splice(idx, 1)
  persist(taskId)
  return true
}

/** 更新批注（可选） */
export function updateAnnotation(taskId, annId, patch) {
  if (!validTaskId(taskId)) return null
  const list = load(taskId)
  const ann = list.find(a => a.id === annId)
  if (!ann) return null
  if (typeof patch?.note === 'string') {
    if (patch.note.length > 4096) throw new Error('note too long')
    ann.note = patch.note
  }
  if (typeof patch?.color === 'string') ann.color = patch.color
  ann.updatedAt = Date.now()
  persist(taskId)
  return ann
}

/** 测试用：清空缓存（不删文件） */
export function _resetCacheForTests() {
  cache.clear()
}
