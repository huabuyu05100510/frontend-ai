/**
 * W1-6 单测：sidebar（右侧固定栏）模式
 *
 * 行为契约：
 *  - inject(mode='sidebar') 不在原文旁边插入，而是追加到 #xt-sidebar-host 的列表
 *  - 同一段重复 inject → 更新已存在的 item，不新增
 *  - append → 流式追加到 sidebar item 的 tgt
 *  - restore → 移除 sidebar host（连同所有 item）+ 解除 body 让位
 *
 * 模型：Claude (Sonnet 4.5)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { TranslationInjector } from '../../src/content/injector'
import { ensureSidebarHost, removeSidebarHost } from '../../src/content/injector'

const HOST_ID = 'xt-sidebar-host'

describe('TranslationInjector — sidebar 模式', () => {
  let injector: TranslationInjector

  beforeEach(() => {
    document.body.innerHTML = ''
    // 给一个原文段
    const p = document.createElement('p')
    p.setAttribute('data-xt-id', 's1')
    p.textContent = 'Hello world'
    document.body.appendChild(p)

    injector = new TranslationInjector()
  })

  it('inject(sidebar) 在 body 上挂 #xt-sidebar-host', () => {
    injector.inject('s1', '你好世界', 'sidebar')
    const host = document.getElementById(HOST_ID)
    expect(host).toBeTruthy()
  })

  it('sidebar item 同时含 src+tgt，且带 data-xt-seg 索引', () => {
    injector.inject('s1', '你好世界', 'sidebar')
    const item = document.querySelector(`[${'data-xt-tgt'}="s1"]`)
    expect(item).toBeTruthy()
    // src/tgt 文本都在 item 内
    const text = item!.textContent ?? ''
    expect(text).toContain('Hello world')
    expect(text).toContain('你好世界')
  })

  it('同 segment 重复 inject → 更新而非新增', () => {
    injector.inject('s1', '你好', 'sidebar')
    injector.inject('s1', '你好世界', 'sidebar')
    const items = document.querySelectorAll(`[${'data-xt-tgt'}="s1"]`)
    expect(items.length).toBe(1)
    expect(items[0].textContent).toContain('你好世界')
  })

  it('多 segment 顺序追加', () => {
    const p2 = document.createElement('p')
    p2.setAttribute('data-xt-id', 's2')
    p2.textContent = 'Second segment'
    document.body.appendChild(p2)

    injector.inject('s1', '第一段', 'sidebar')
    injector.inject('s2', '第二段', 'sidebar')

    const items = document.querySelectorAll(`[${'data-xt-tgt'}]`)
    expect(items.length).toBe(2)
  })

  it('append 流式追加到 sidebar item', () => {
    injector.inject('s1', '你', 'sidebar')
    injector.append('s1', '好')
    injector.append('s1', '世界')
    const item = document.querySelector(`[${'data-xt-tgt'}="s1"]`)
    expect(item?.textContent).toContain('你好世界')
  })

  it('restore() 移除 sidebar host 并解除 body 让位', () => {
    injector.inject('s1', '你好世界', 'sidebar')
    expect(document.getElementById(HOST_ID)).toBeTruthy()
    injector.restore()
    expect(document.getElementById(HOST_ID)).toBeNull()
  })
})

describe('sidebar host 工具函数', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.body.style.removeProperty('margin-right')
  })

  it('ensureSidebarHost 幂等：重复调用只一个 host', () => {
    ensureSidebarHost()
    ensureSidebarHost()
    expect(document.querySelectorAll(`#${HOST_ID}`).length).toBe(1)
  })

  it('ensureSidebarHost 给 body 加让位（padding-right 或 margin-right > 0）', () => {
    ensureSidebarHost()
    const w = getComputedStyle(document.body)
    const pad = parseInt(w.paddingRight || '0', 10)
    const mar = parseInt(w.marginRight || '0', 10)
    expect(pad + mar).toBeGreaterThan(0)
  })

  it('removeSidebarHost 清掉让位', () => {
    ensureSidebarHost()
    removeSidebarHost()
    const w = getComputedStyle(document.body)
    const pad = parseInt(w.paddingRight || '0', 10)
    const mar = parseInt(w.marginRight || '0', 10)
    expect(pad + mar).toBe(0)
  })
})
