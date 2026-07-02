// 任务元数据持久化（JSON 文件）+ 进程内并发状态
import fs from 'node:fs'
import { CONFIG } from './config.mjs'

let cache = null
let writeTimer = null

function ensure() {
  if (!fs.existsSync(CONFIG.META_FILE)) {
    fs.mkdirSync(path.dirname(CONFIG.META_FILE), { recursive: true })
    fs.writeFileSync(CONFIG.META_FILE, '[]', 'utf-8')
  }
}

import path from 'node:path'

export function loadTasks() {
  ensure()
  try {
    cache = JSON.parse(fs.readFileSync(CONFIG.META_FILE, 'utf-8'))
  } catch {
    cache = []
  }
  return cache
}

export function saveTasksImmediate() {
  ensure()
  fs.writeFileSync(CONFIG.META_FILE, JSON.stringify(cache || [], null, 2), 'utf-8')
}

// 防抖落盘：高频状态更新避免磁盘抖动
export function saveTasks() {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(saveTasksImmediate, 300)
}

export function listTasks() {
  if (!cache) loadTasks()
  // 按创建时间倒序
  return [...cache].sort((a, b) => b.createdAt - a.createdAt)
}

export function getTask(id) {
  if (!cache) loadTasks()
  return cache.find(t => t.id === id)
}

export function upsertTask(task) {
  if (!cache) loadTasks()
  const idx = cache.findIndex(t => t.id === task.id)
  if (idx >= 0) cache[idx] = { ...cache[idx], ...task }
  else cache.push(task)
  saveTasks()
  return task
}

export function updateTask(id, patch) {
  if (!cache) loadTasks()
  const idx = cache.findIndex(t => t.id === id)
  if (idx >= 0) {
    cache[idx] = { ...cache[idx], ...patch, updatedAt: Date.now() }
    saveTasks()
    return cache[idx]
  }
  return null
}
