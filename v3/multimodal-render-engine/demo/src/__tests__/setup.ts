import '@testing-library/jest-dom'
import { vi } from 'vitest'

// jsdom 缺少 ResizeObserver / IntersectionObserver，提供 stub
global.ResizeObserver = class {
  observe()   {}
  unobserve() {}
  disconnect() {}
}

global.IntersectionObserver = class {
  observe()   {}
  unobserve() {}
  disconnect() {}
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds = []
  takeRecords() { return [] }
} as unknown as typeof IntersectionObserver
