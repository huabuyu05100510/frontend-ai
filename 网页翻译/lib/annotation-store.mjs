/**
 * annotation-store —— IndexedDB 存储层
 *
 * 对标 docs/annotation-feature-tech-plan-V1.md §3 + §4
 *   - DB: xt-annotations (version 1)
 *   - ObjectStore 'annotations', keyPath 'id'
 *   - indexes: by_createdAt / by_synced / by_url / by_kind
 *   - 记录结构: Annotation（顶层 kind/url/langPair + 内嵌 payload）
 *
 * 设计：
 *   - 记录扁平存储：annotation 字段全部在顶层（id/createdAt/synced + kind/url/... + payload:{}）
 *   - 单例 DB 连接（_dbPromise），每次 close 后清单例（fake-indexeddb 友好）
 *   - put 直接接收完整 Annotation 对象
 *   - exportJSONL 返回 async iterable（流式，不全 load）
 *
 * 模型：Claude (Sonnet 4.6 / MiniMax-M3 路由)
 */

const DB_NAME = 'xt-annotations'
const DB_VERSION = 1
const STORE = 'annotations'

let _dbPromise = null
let _dbCachedHandle = null

/**
 * 打开 DB（单例）。onupgradeneeded 时建 store + 4 索引。
 * 若单例 DB 已 close，自动重新打开。
 * @returns {Promise<IDBDatabase>}
 */
export function openDb() {
  // 若单例持有已 close 的 handle，重置
  if (_dbPromise) {
    const cached = _dbCachedHandle
    if (cached && cached.close && cached.close.hasBeenClosed) {
      _dbPromise = null
      _dbCachedHandle = null
    }
  }
  if (_dbPromise) return _dbPromise
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('indexedDB unavailable (Node 环境 / fake-indexeddb 未注入)'))
  }
  const current = _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' })
        os.createIndex('by_createdAt', 'createdAt', { unique: false })
        os.createIndex('by_synced', 'synced', { unique: false })
        os.createIndex('by_url', 'url', { unique: false })
        os.createIndex('by_kind', 'kind', { unique: false })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      _dbCachedHandle = db
      // 拦截 close：标记并清单例
      const origClose = db.close.bind(db)
      db.close = function patchedClose() {
        db.close.hasBeenClosed = true
        if (_dbPromise === current) {
          _dbPromise = null
          _dbCachedHandle = null
        }
        return origClose()
      }
      db.onclose = () => {
        db.close.hasBeenClosed = true
        if (_dbPromise === current) {
          _dbPromise = null
          _dbCachedHandle = null
        }
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
  return current
}

/** 重置单例（测试用，配合 clear() 实现隔离） */
export function _reset() {
  _dbPromise = null
  _dbCachedHandle = null
}

/**
 * 写入一条（upsert）。同 id 覆盖。
 * 默认 synced=0（如果未指定）。
 * 字段合法性由调用方负责（建议先调 lib/annotation.mjs encode）。
 * 这里只做最小 shape 校验：id 必须是非空字符串。
 * @param {object} anno 完整 Annotation 对象
 * @returns {Promise<string>} id
 */
export async function put(anno) {
  if (anno == null || typeof anno !== 'object') {
    return Promise.reject(new Error('anno must be object'))
  }
  if (typeof anno.id !== 'string' || anno.id.length === 0) {
    return Promise.reject(new Error('anno.id must be non-empty string'))
  }
  const db = await openDb()
  // 扁平存储：annotation 字段在顶层，payload 子对象保留
  const record = { ...anno, synced: anno.synced ?? 0 }
  if (record.createdAt == null) record.createdAt = Date.now()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const os = tx.objectStore(STORE)
    const req = os.put(record)
    req.onsuccess = () => resolve(record.id)
    req.onerror = () => reject(req.error)
    tx.onabort = () => reject(tx.error || new Error('tx aborted'))
  })
}

/**
 * 读单条
 * @param {string} id
 * @returns {Promise<object|undefined>}
 */
export async function get(id) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const os = tx.objectStore(STORE)
    const req = os.get(id)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * 按 createdAt 列表
 * @param {{limit?: number, offset?: number, desc?: boolean, kind?: string}} opts
 * @returns {Promise<object[]>}
 */
export async function listByCreatedAt({ limit = 1000, offset = 0, desc = false, kind } = {}) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const os = tx.objectStore(STORE)
    const idx = os.index('by_createdAt')
    const direction = desc ? 'prev' : 'next'
    const out = []
    let skipped = 0
    const cursorReq = idx.openCursor(null, direction)
    cursorReq.onsuccess = e => {
      const cur = e.target.result
      if (!cur) return resolve(out)
      const v = cur.value
      if (kind && v.kind !== kind) {
        cur.continue()
        return
      }
      if (skipped < offset) {
        skipped++
        cur.continue()
        return
      }
      out.push(v)
      if (out.length >= limit) return resolve(out)
      cur.continue()
    }
    cursorReq.onerror = () => reject(cursorReq.error)
  })
}

/** 取未同步（synced=0）的 */
export async function listUnsynced({ limit = 100 } = {}) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const os = tx.objectStore(STORE)
    const idx = os.index('by_synced')
    const out = []
    const cursorReq = idx.openCursor(IDBKeyRange.only(0))
    cursorReq.onsuccess = e => {
      const cur = e.target.result
      if (!cur || out.length >= limit) return resolve(out)
      out.push(cur.value)
      cur.continue()
    }
    cursorReq.onerror = () => reject(cursorReq.error)
  })
}

/** 批量标记已同步；返回成功条数 */
export async function markSynced(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const os = tx.objectStore(STORE)
    let count = 0
    let pending = ids.length
    let failed = false
    const done = () => { if (!failed && pending === 0) resolve(count) }
    ids.forEach(id => {
      const req = os.get(id)
      req.onsuccess = () => {
        if (failed) return
        const rec = req.result
        if (!rec) {
          pending--
          done()
          return
        }
        rec.synced = 1
        const putReq = os.put(rec)
        putReq.onsuccess = () => {
          count++
          pending--
          done()
        }
        putReq.onerror = e => { failed = true; reject(e) }
      }
      req.onerror = e => { failed = true; reject(e) }
    })
  })
}

/** 删除单条（找不到不抛错） */
export async function deleteById(id) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const os = tx.objectStore(STORE)
    const req = os.delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/** 清空全部（测试用） */
export async function clear() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const os = tx.objectStore(STORE)
    const req = os.clear()
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/**
 * 聚合统计
 * @returns {Promise<{total: number, byKind: object, byLangPair: object, last24h: number, unsyncedCount: number}>}
 */
export async function stats() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const os = tx.objectStore(STORE)
    const out = { total: 0, byKind: {}, byLangPair: {}, last24h: 0, unsyncedCount: 0 }
    const DAY = 86_400_000
    const now = Date.now()
    const cursorReq = os.openCursor()
    cursorReq.onsuccess = e => {
      const cur = e.target.result
      if (!cur) return resolve(out)
      const v = cur.value
      out.total++
      if (v.kind) out.byKind[v.kind] = (out.byKind[v.kind] || 0) + 1
      if (Array.isArray(v.langPair)) {
        const k = `${v.langPair[0]}-${v.langPair[1]}`
        out.byLangPair[k] = (out.byLangPair[k] || 0) + 1
      }
      if (typeof v.createdAt === 'number' && now - v.createdAt < DAY) out.last24h++
      if (v.synced === 0 || v.synced == null) out.unsyncedCount++
      cur.continue()
    }
    cursorReq.onerror = () => reject(cursorReq.error)
  })
}

/**
 * 流式导出 JSONL（async iterable）
 * 每行一个 JSON 对象 + \n
 * @returns {AsyncIterable<string>}
 */
export async function* exportJSONL() {
  const db = await openDb()
  const tx = db.transaction(STORE, 'readonly')
  const os = tx.objectStore(STORE)
  const cursorReq = os.index('by_createdAt').openCursor(null, 'prev')
  const queue = []
  let resolveNext = null
  let done = false
  let error = null

  cursorReq.onsuccess = e => {
    const cur = e.target.result
    if (cur) {
      queue.push(JSON.stringify(cur.value) + '\n')
      cur.continue()
    } else {
      done = true
    }
    if (resolveNext) {
      const r = resolveNext
      resolveNext = null
      r()
    }
  }
  cursorReq.onerror = e => {
    error = e.target.error
    done = true
    if (resolveNext) {
      const r = resolveNext
      resolveNext = null
      r()
    }
  }

  while (true) {
    if (queue.length > 0) {
      yield queue.shift()
      continue
    }
    if (error) throw error
    if (done) return
    await new Promise(r => { resolveNext = r })
  }
}
