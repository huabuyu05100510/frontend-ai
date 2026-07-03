import { describe, expect, it, beforeEach } from 'vitest'
import { IframePool } from '../src/IframePool'

describe('IframePool 边界场景', () => {
  let host: HTMLElement
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  it('预热后池达到 max', () => {
    const pool = new IframePool(3)
    pool.warmup(host)
    expect(pool.metrics().size).toBe(3)
    expect(pool.metrics().peak).toBe(3)
    expect(pool.metrics().totalCreated).toBe(3)
  })

  it('池耗尽时现场新建（业务不阻塞）', () => {
    const pool = new IframePool(2)
    pool.warmup(host)
    pool.acquire(host) // 取走 1
    pool.acquire(host) // 取走 2
    expect(pool.metrics().size).toBe(0)
    // 池已空，再 acquire 应现场新建
    const third = pool.acquire(host)
    expect(third).toBeInstanceOf(HTMLIFrameElement)
    expect(pool.metrics().totalCreated).toBe(3) // 2 预热 + 1 现场
  })

  it('池满时 release 直接销毁', () => {
    const pool = new IframePool(2)
    pool.warmup(host)
    const extra = document.createElement('iframe')
    host.appendChild(extra)
    pool.release(extra) // 池已满
    expect(pool.metrics().size).toBe(2) // 没增加
    expect(extra.parentNode).toBeNull() // 被销毁
  })

  it('release 同一 iframe 多次不重复入池', () => {
    const pool = new IframePool(3)
    pool.warmup(host)
    const iframe = pool.acquire(host) // 池 3 → 2
    pool.release(iframe) // 第一次合法归还：2 → 3
    expect(pool.metrics().size).toBe(3)
    pool.release(iframe) // 重复 release：跳过
    expect(pool.metrics().size).toBe(3)
  })

  it('release 前清理全局变量（避免老 app 污染新 app）', () => {
    const pool = new IframePool(1)
    const iframe = pool.acquire(host)
    // 模拟老 app 往 contentWindow 挂的全局
    ;(iframe.contentWindow as any).__USER__ = { name: 'alice' }
    pool.release(iframe)
    expect((iframe.contentWindow as any).__USER__).toBeUndefined()
  })
})
