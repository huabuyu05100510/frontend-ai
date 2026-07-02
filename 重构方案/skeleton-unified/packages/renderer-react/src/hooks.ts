/**
 * @skeleton/renderer-react - React Hooks
 *
 * useSkeletonCapture：运行时自动捕获骨架（开发/调试用）
 * useBonesFromStorage：从 IndexedDB 读取骨架数据
 */

import { useState, useRef, useEffect } from 'react'
import type { SkeletonData } from '@skeleton/core'
import { extractBones, packSkeletonData } from '@skeleton/core'
import { measureDOM } from '@skeleton/adapter-web'
import { WebStorage } from '@skeleton/adapter-web'

const storage = new WebStorage()

/**
 * 从 IndexedDB 读取骨架数据。
 * 在组件首次加载时触发，有缓存立即返回。
 *
 * @param name 骨架名（组件/路由标识）
 */
export function useBonesFromStorage(name: string): SkeletonData | null {
  const [data, setData] = useStateRef<SkeletonData | null>(null)

  useEffect(() => {
    storage.get(name).then((cached: SkeletonData | null) => {
      if (cached) setData(cached)
    })
  }, [name])

  return data
}

/** 简单 useState wrapper */
function useStateRef<T>(initial: T): [T, (v: T) => void] {
  return useState<T>(initial)
}

/**
 * 运行时骨架捕获 Hook（开发阶段 / 无构建工具时使用）。
 *
 * 使用方式：
 * ```tsx
 * function ProductCard() {
 *   const captureRef = useSkeletonCapture('product-card')
 *   return <div ref={captureRef}>...</div>
 * }
 * ```
 *
 * 工作原理：
 * 1. 组件 loading → false 后（内容加载完成），触发骨架捕获
 * 2. 测量 DOM，提取骨骼，存入 IndexedDB
 * 3. 下次加载时从 IndexedDB 读取并展示骨架
 *
 * @param name    骨架名
 * @param loading 当前 loading 状态（从 true→false 触发捕获）
 * @param delay   捕获延迟（ms），等待布局稳定，默认 200ms
 */
export function useSkeletonCapture(
  name: string,
  loading: boolean,
  delay = 200,
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  const prevLoading = useRef(loading)
  const captured = useRef(false)

  useEffect(() => {
    // loading 从 true → false：触发捕获
    if (prevLoading.current && !loading && !captured.current && ref.current) {
      const el = ref.current
      const timer = setTimeout(async () => {
        try {
          const tree = await measureDOM(el)
          const bones = extractBones(tree)
          const data = packSkeletonData(bones, tree.rect, name, 'web')
          await storage.set(name, data)
          captured.current = true
        } catch (err) {
          console.warn('[skeleton] capture failed:', err)
        }
      }, delay)
      return () => clearTimeout(timer)
    }
    prevLoading.current = loading
  }, [name, loading, delay])

  return ref
}
