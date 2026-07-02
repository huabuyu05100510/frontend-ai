import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// 每个测试后自动清理 DOM，避免 jsdom 节点泄漏
afterEach(() => {
  cleanup()
})

// jsdom 没有 localStorage 完整实现，提供一个最小内存实现
class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length() { return this.store.size }
  clear() { this.store.clear() }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null }
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null }
  setItem(k: string, v: string) { this.store.set(k, String(v)) }
  removeItem(k: string) { this.store.delete(k) }
}
;(globalThis as any).localStorage = new MemoryStorage()
;(globalThis as any).sessionStorage = new MemoryStorage()

// 静默 jsdom 不支持的 IntersectionObserver 警告
class IOStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
  root = null
  rootMargin = ''
  thresholds = []
}
// @ts-ignore
global.IntersectionObserver = IOStub

// matchMedia stub（部分组件可能用到）
if (!global.matchMedia) {
  // @ts-ignore
  global.matchMedia = (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false
  })
}