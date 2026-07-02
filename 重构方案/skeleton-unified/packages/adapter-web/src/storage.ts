/**
 * @skeleton/adapter-web - IndexedDB 存储
 *
 * 存储骨架数据，支持二进制压缩格式。
 * 数据库名：SkeletonUnified，Store：skeletons，key = name
 */

import type { Storage, SkeletonData } from '@skeleton/core'
import { compressSkeletonData, decompressSkeletonData } from '@skeleton/core'

const DB_NAME = 'SkeletonUnified'
const STORE_NAME = 'skeletons'
const DB_VERSION = 1

let dbInstance: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    req.onsuccess = () => {
      dbInstance = req.result
      dbInstance.onclose = () => { dbInstance = null }
      resolve(dbInstance)
    }

    req.onerror = () => reject(req.error)
  })
}

export class WebStorage implements Storage {
  async get(key: string): Promise<SkeletonData | null> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(key)
      req.onsuccess = () => {
        if (!req.result) { resolve(null); return }
        const data = decompressSkeletonData(req.result as Uint8Array)
        resolve(data)
      }
      req.onerror = () => reject(req.error)
    })
  }

  async set(key: string, data: SkeletonData): Promise<void> {
    const db = await openDB()
    const compressed = compressSkeletonData(data)
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(compressed, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async remove(key: string): Promise<void> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}
