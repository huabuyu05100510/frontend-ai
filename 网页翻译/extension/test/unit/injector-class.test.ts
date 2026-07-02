/**
 * W3.2: 沉浸式 className 计算（grid/RTL/空段）
 *
 * 模型：Claude (Sonnet 4.5)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  TranslationInjector,
  isRtlLang,
  computeTgtClassName,
} from '../../src/content/injector'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('isRtlLang', () => {
  it('ar/he/fa/ur 是 RTL', () => {
    expect(isRtlLang('ar')).toBe(true)
    expect(isRtlLang('he')).toBe(true)
    expect(isRtlLang('fa')).toBe(true)
    expect(isRtlLang('ur')).toBe(true)
    expect(isRtlLang('AR')).toBe(true) // 大小写不敏感
  })

  it('zh/en/ja 等不是 RTL', () => {
    expect(isRtlLang('zh')).toBe(false)
    expect(isRtlLang('en')).toBe(false)
    expect(isRtlLang('ja')).toBe(false)
    expect(isRtlLang('ko')).toBe(false)
  })

  it('null/undefined → false', () => {
    expect(isRtlLang(null)).toBe(false)
    expect(isRtlLang(undefined)).toBe(false)
    expect(isRtlLang('')).toBe(false)
  })
})

describe('computeTgtClassName', () => {
  it('普通段落：返回 xt-translation', () => {
    document.body.innerHTML = '<div id="wrap"><p id="p1">Hello</p></div>'
    const cls = computeTgtClassName(document.getElementById('p1')!, '你好', 'zh')
    expect(cls).toBe('xt-translation')
  })

  it('grid 容器内部：附加 xt-grid-translation', () => {
    const grid = document.createElement('div')
    grid.style.display = 'grid'
    grid.innerHTML = '<p id="p1">Hello</p>'
    document.body.appendChild(grid)
    const cls = computeTgtClassName(document.getElementById('p1')!, '你好', 'zh')
    expect(cls).toContain('xt-translation')
    expect(cls).toContain('xt-grid-translation')
  })

  it('RTL 目标语言：附加 xt-rtl', () => {
    document.body.innerHTML = '<p id="p1">Hello</p>'
    const cls = computeTgtClassName(document.getElementById('p1')!, 'مرحبا', 'ar')
    expect(cls).toContain('xt-translation')
    expect(cls).toContain('xt-rtl')
  })

  it('grid + RTL：两者都附加', () => {
    const grid = document.createElement('div')
    grid.style.display = 'grid'
    grid.innerHTML = '<p id="p1">Hello</p>'
    document.body.appendChild(grid)
    const cls = computeTgtClassName(document.getElementById('p1')!, 'مرحبا', 'ar')
    expect(cls).toContain('xt-translation')
    expect(cls).toContain('xt-grid-translation')
    expect(cls).toContain('xt-rtl')
  })

  it('空段：返回 null（跳过注入）', () => {
    document.body.innerHTML = '<p id="p1">Hello</p>'
    expect(computeTgtClassName(document.getElementById('p1')!, '', 'zh')).toBeNull()
    expect(computeTgtClassName(document.getElementById('p1')!, '   ', 'zh')).toBeNull()
  })
})

describe('TranslationInjector — 沉浸式 className 集成', () => {
  it('grid 容器内注入：译文带 xt-grid-translation', () => {
    const grid = document.createElement('div')
    grid.style.display = 'grid'
    grid.innerHTML = '<p data-xt-id="s1">Card title</p>'
    document.body.appendChild(grid)

    const injector = new TranslationInjector()
    injector.inject('s1', '卡片标题', 'bilingual', 'zh')

    const tgt = document.querySelector('[data-xt-tgt="s1"]')!
    expect(tgt.classList.contains('xt-translation')).toBe(true)
    expect(tgt.classList.contains('xt-grid-translation')).toBe(true)
  })

  it('RTL 注入：译文带 xt-rtl', () => {
    document.body.innerHTML = '<p data-xt-id="s1">Hello</p>'
    const injector = new TranslationInjector()
    injector.inject('s1', 'مرحبا', 'bilingual', 'ar')

    const tgt = document.querySelector('[data-xt-tgt="s1"]')!
    expect(tgt.classList.contains('xt-rtl')).toBe(true)
  })

  it('普通段落：只有 xt-translation', () => {
    document.body.innerHTML = '<p data-xt-id="s1">Hello</p>'
    const injector = new TranslationInjector()
    injector.inject('s1', '你好', 'bilingual', 'zh')

    const tgt = document.querySelector('[data-xt-tgt="s1"]')!
    expect(tgt.classList.contains('xt-translation')).toBe(true)
    expect(tgt.classList.contains('xt-grid-translation')).toBe(false)
    expect(tgt.classList.contains('xt-rtl')).toBe(false)
  })

  it('空段跳过：inject 不创建译文元素', () => {
    document.body.innerHTML = '<p data-xt-id="s1">Hello</p>'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const injector = new TranslationInjector()
    injector.inject('s1', '', 'bilingual', 'zh')
    injector.inject('s1', '   ', 'bilingual', 'zh')

    expect(document.querySelector('[data-xt-tgt="s1"]')).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('inline-grid 容器也算 grid', () => {
    const grid = document.createElement('span')
    grid.style.display = 'inline-grid'
    grid.innerHTML = '<p data-xt-id="s1">A</p>'
    document.body.appendChild(grid)

    const injector = new TranslationInjector()
    injector.inject('s1', '甲', 'bilingual', 'zh')

    const tgt = document.querySelector('[data-xt-tgt="s1"]')!
    expect(tgt.classList.contains('xt-grid-translation')).toBe(true)
  })
})