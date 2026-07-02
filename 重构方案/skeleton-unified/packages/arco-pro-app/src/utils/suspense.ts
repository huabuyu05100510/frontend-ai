/**
 * React 17 兼容的 Suspense 数据请求工具
 *
 * 原理：组件内 throw Promise → React Suspense 捕获 → 显示 fallback
 *       Promise resolve → React 重新渲染 → 显示真实内容
 *
 * 这是 React 16.6 起就支持的底层机制，无需 React 18，无需 Babel。
 */

type Status = 'pending' | 'success' | 'error'

interface Resource<T> {
  read(): T
}

function wrapPromise<T>(promise: Promise<T>): Resource<T> {
  let status: Status = 'pending'
  let result: T
  let error: unknown

  promise.then(
    (data) => { status = 'success'; result = data },
    (err)  => { status = 'error';   error = err },
  )

  return {
    read() {
      if (status === 'pending') throw promise   // React 捕获，显示 fallback
      if (status === 'error')   throw error     // ErrorBoundary 捕获
      return result!
    },
  }
}

// ── 请求缓存（模块级，避免每次渲染重新发请求）─────────────────────────────

const cache = new Map<string, Resource<unknown>>()

/**
 * 在组件内同步读取异步数据。
 * 首次调用时发起请求并挂起（throw Promise），数据就绪后返回结果。
 *
 * @param key     缓存键（相同 key 不重复请求）
 * @param fetcher 返回 Promise 的函数
 *
 * @example
 * function MyComponent() {
 *   const data = useSuspenseData('my-key', () => axios.get('/api/data').then(r => r.data))
 *   return <div>{data.name}</div>
 * }
 */
export function useSuspenseData<T>(key: string, fetcher: () => Promise<T>): T {
  if (!cache.has(key)) {
    cache.set(key, wrapPromise(fetcher()))
  }
  return (cache.get(key) as Resource<T>).read()
}

/** 手动使缓存失效，下次读取时重新请求 */
export function invalidateSuspenseCache(key: string): void {
  cache.delete(key)
}

/** 清空所有缓存 */
export function clearSuspenseCache(): void {
  cache.clear()
}
