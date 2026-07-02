// ============================================================================
// fileCache — IndexedDB 持久化文件缓存（零依赖，原生 API）
//   DB: preview-engine, Store: files (autoIncrement)
//   去重：name + size + lastModified 相同则直接返回已有 id
// ============================================================================

export interface CachedFile {
  id?: number
  name: string
  size: number
  lastModified: number
  blob: Blob
}

const DB_NAME = 'preview-engine'
const STORE = 'files'
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function store(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE)
}

export async function listCachedFiles(): Promise<CachedFile[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = store(db, 'readonly').getAll()
    req.onsuccess = () => resolve(req.result as CachedFile[])
    req.onerror = () => reject(req.error)
  })
}

/** 缓存文件，若已存在相同 name+size+lastModified 则跳过；返回 id */
export async function cacheFile(file: File): Promise<number> {
  const all = await listCachedFiles()
  const dup = all.find(
    (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified,
  )
  if (dup?.id != null) return dup.id
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const entry: CachedFile = { name: file.name, size: file.size, lastModified: file.lastModified, blob: file }
    const req = store(db, 'readwrite').add(entry)
    req.onsuccess = () => resolve(req.result as number)
    req.onerror = () => reject(req.error)
  })
}

export async function deleteCachedFile(id: number): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = store(db, 'readwrite').delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function clearCache(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const req = store(db, 'readwrite').clear()
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}
