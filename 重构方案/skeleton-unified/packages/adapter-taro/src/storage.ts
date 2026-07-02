/**
 * @skeleton/adapter-taro - Taro Storage 适配器
 * H5 → localStorage，小程序 → wx.setStorageSync
 */

import type { Storage, SkeletonData } from '@skeleton/core'
import { serializeToBase64, deserializeFromBase64 } from '@skeleton/core'

const KEY_PREFIX = 'skeleton_'

export class TaroStorage implements Storage {
  async get(name: string): Promise<SkeletonData | null> {
    try {
      const Taro = require('@tarojs/taro')
      const base64 = Taro.getStorageSync(KEY_PREFIX + name)
      if (!base64) return null
      return deserializeFromBase64(base64 as string)
    } catch {
      return null
    }
  }

  async set(name: string, data: SkeletonData): Promise<void> {
    try {
      const Taro = require('@tarojs/taro')
      const base64 = serializeToBase64(data)
      Taro.setStorageSync(KEY_PREFIX + name, base64)
    } catch (err) {
      console.warn('[skeleton-taro] storage.set failed:', err)
    }
  }

  async remove(name: string): Promise<void> {
    try {
      const Taro = require('@tarojs/taro')
      Taro.removeStorageSync(KEY_PREFIX + name)
    } catch {
      // ignore
    }
  }
}
