/**
 * @skeleton/adapter-rn - AsyncStorage 存储
 */

import type { Storage, SkeletonData } from '@skeleton/core'
import { compressSkeletonData, decompressSkeletonData, serializeToBase64, deserializeFromBase64 } from '@skeleton/core'

const KEY_PREFIX = '@skeleton/'

/**
 * RN AsyncStorage 适配器。
 * AsyncStorage 只支持字符串，所以用 base64 序列化。
 */
export class RNStorage implements Storage {
  private getKey(name: string): string {
    return KEY_PREFIX + name
  }

  async get(name: string): Promise<SkeletonData | null> {
    try {
      // 动态导入避免直接依赖 react-native（保持 optional peer dep）
      const AsyncStorage = await getAsyncStorage()
      if (!AsyncStorage) return null
      const base64 = await AsyncStorage.getItem(this.getKey(name))
      if (!base64) return null
      return deserializeFromBase64(base64)
    } catch {
      return null
    }
  }

  async set(name: string, data: SkeletonData): Promise<void> {
    try {
      const AsyncStorage = await getAsyncStorage()
      if (!AsyncStorage) return
      const base64 = serializeToBase64(data)
      await AsyncStorage.setItem(this.getKey(name), base64)
    } catch (err) {
      console.warn('[skeleton-rn] storage.set failed:', err)
    }
  }

  async remove(name: string): Promise<void> {
    try {
      const AsyncStorage = await getAsyncStorage()
      if (!AsyncStorage) return
      await AsyncStorage.removeItem(this.getKey(name))
    } catch {
      // ignore
    }
  }
}

interface AsyncStorageType {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

let asyncStorageCache: AsyncStorageType | null | undefined = undefined

async function getAsyncStorage(): Promise<AsyncStorageType | null> {
  if (asyncStorageCache !== undefined) return asyncStorageCache
  try {
    // 尝试 @react-native-async-storage/async-storage（推荐包）
    const mod = await import('@react-native-async-storage/async-storage' as any)
    asyncStorageCache = mod.default ?? mod
    return asyncStorageCache!
  } catch {
    try {
      // 降级到旧版 AsyncStorage
      const { AsyncStorage } = await import('react-native' as any)
      asyncStorageCache = AsyncStorage
      return asyncStorageCache!
    } catch {
      asyncStorageCache = null
      console.warn('[skeleton-rn] AsyncStorage not available. Install @react-native-async-storage/async-storage')
      return null
    }
  }
}
