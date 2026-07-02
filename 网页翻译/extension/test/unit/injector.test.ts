import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TranslationInjector } from '../../src/content/injector'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('TranslationInjector — 双语模式', () => {
  it('v4: P 元素 - 译文在 srcEl 内部 flex 右列，非兄弟节点', () => {
    document.body.innerHTML = '<p id="p1" data-xt-id="seg-1">Hello world</p>'
    const injector = new TranslationInjector()
    injector.inject('seg-1', '你好世界', 'bilingual')

    const tgt = document.querySelector('[data-xt-tgt="seg-1"]')
    expect(tgt).toBeTruthy()
    expect(tgt?.textContent).toBe('你好世界')
    // v4: 译文在 srcEl 内部
    const src = document.querySelector('[data-xt-id="seg-1"]')!
    expect(src.contains(tgt!)).toBe(true)
    expect(src.nextElementSibling).toBeNull()
  })

  it('v4: 译文是 <span> 元素', () => {
    document.body.innerHTML = '<p data-xt-id="s1">Original text</p>'
    const injector = new TranslationInjector()
    injector.inject('s1', '译文', 'bilingual')

    const tgt = document.querySelector('[data-xt-tgt="s1"]')!
    expect(tgt.tagName).toBe('SPAN')
    expect(tgt.textContent).toBe('译文')
  })

  it('v4: P 保留原始子元素在 .xt-src-text span 中', () => {
    document.body.innerHTML = '<p data-xt-id="s1">Hello <a href="/">link</a> world</p>'
    const injector = new TranslationInjector()
    injector.inject('s1', '你好链接世界', 'bilingual')

    const src = document.querySelector('[data-xt-id="s1"]')!
    const srcText = src.querySelector('.xt-src-text')
    expect(srcText?.textContent).toBe('Hello link world')
    // 原始 <a> 保留
    const a = srcText?.querySelector('a')
    expect(a).toBeTruthy()
    expect(a?.getAttribute('href')).toBe('/')

    const tgt = src.querySelector('[data-xt-tgt="s1"]')!
    expect(tgt.textContent).toBe('你好链接世界')
  })

  it('v4: 译文在 srcEl 内部，不影响后续兄弟节点', () => {
    document.body.innerHTML = '<p data-xt-id="s1">First</p><p id="after">After</p>'
    const injector = new TranslationInjector()
    injector.inject('s1', '第一', 'bilingual')

    const p = document.querySelector('[data-xt-id="s1"]')!
    const tgt = document.querySelector('[data-xt-tgt="s1"]')!
    expect(p.contains(tgt)).toBe(true)
    expect(p.nextElementSibling?.id).toBe('after')
  })

  it('流式追加：多次 append 同一 id 追加内容', () => {
    document.body.innerHTML = '<p data-xt-id="s1">Hello</p>'
    const injector = new TranslationInjector()
    injector.inject('s1', '你', 'bilingual')
    injector.append('s1', '好')
    injector.append('s1', '世界')

    expect(document.querySelector('[data-xt-tgt="s1"]')?.textContent).toBe('你好世界')
  })
})

describe('TranslationInjector — 仅译文模式', () => {
  it('替换原文文本节点，保留子元素', () => {
    document.body.innerHTML = '<p data-xt-id="s1">Hello world</p>'
    const injector = new TranslationInjector()
    injector.inject('s1', '你好世界', 'translation-only')
    expect(document.querySelector('[data-xt-id="s1"]')?.textContent).toBe('你好世界')
  })

  it('保存原文到 data-xt-original', () => {
    document.body.innerHTML = '<p data-xt-id="s1">Original text here</p>'
    const injector = new TranslationInjector()
    injector.inject('s1', '译文', 'translation-only')
    expect(document.querySelector('[data-xt-id="s1"]')?.getAttribute('data-xt-original')).toBe('Original text here')
  })

  it('替换文本节点但保留子元素', () => {
    document.body.innerHTML = '<p data-xt-id="s1">Hello <a href="/">link</a> world</p>'
    const injector = new TranslationInjector()
    injector.inject('s1', '你好链接世界', 'translation-only')

    const src = document.querySelector('[data-xt-id="s1"]')!
    const a = src.querySelector('a')
    expect(a).toBeTruthy()
    expect(a?.getAttribute('href')).toBe('/')
    expect(src.textContent).toBe('你好链接世界')
  })
})

describe('TranslationInjector — 还原', () => {
  it('restore() 移除所有译文（bilingual 模式）', () => {
    document.body.innerHTML = '<p data-xt-id="s1">A</p><p data-xt-id="s2">B</p>'
    const injector = new TranslationInjector()
    injector.inject('s1', '甲', 'bilingual')
    injector.inject('s2', '乙', 'bilingual')
    injector.restore()
    expect(document.querySelectorAll('[data-xt-tgt]').length).toBe(0)
  })

  it('restore() 恢复 translation-only 模式下的原文', () => {
    document.body.innerHTML = '<p id="p1" data-xt-id="s1">Original text</p>'
    const injector = new TranslationInjector()
    injector.inject('s1', '译文', 'translation-only')
    injector.restore()

    const p = document.querySelector('#p1')!
    expect(p.textContent).toBe('Original text')
    expect(p.hasAttribute('data-xt-original')).toBe(false)
  })

  it('restore() 清除 data-xt-id 标记', () => {
    document.body.innerHTML = '<p data-xt-id="s1">Text</p>'
    const injector = new TranslationInjector()
    injector.inject('s1', '文', 'bilingual')
    injector.restore()
    expect(document.querySelector('[data-xt-id]')).toBeNull()
  })
})

describe('TranslationInjector — 防重复', () => {
  it('对同一 id 重复 inject 不创建多个译文元素', () => {
    document.body.innerHTML = '<p data-xt-id="s1">Text</p>'
    const injector = new TranslationInjector()
    injector.inject('s1', '译1', 'bilingual')
    injector.inject('s1', '译2', 'bilingual')
    expect(document.querySelectorAll('[data-xt-tgt="s1"]').length).toBe(1)
  })
})

// ─── v4: 左原文右译文并排布局 ────────────────────────────────
// 策略：
//  - P/H1-H6/DIV/SPAN/A → display:flex 左原文右译文并排
//  - TD/TH/LI → 译文作为 block 子元素注入内部（不改变 display）
describe('TranslationInjector — v4 左原文右译文并排布局', () => {
  it('UL/LI：译文注入到 LI 内部作为 block 子元素，UL 子元素不变', () => {
    document.body.innerHTML = '<ul><li data-xt-id="s1">item</li></ul>'
    const injector = new TranslationInjector()
    injector.inject('s1', '项目', 'bilingual')

    const li = document.querySelector('[data-xt-id="s1"]')!
    const tgt = document.querySelector('[data-xt-tgt="s1"]')!
    expect(tgt.tagName).toBe('SPAN')
    // v4: LI preserve display — 译文在 LI 内部的 .xt-tgt-col 中
    expect(li.contains(tgt)).toBe(true)
    // LI display 未改变
    expect(li.style.display).not.toBe('flex')
    // UL 仍然只有 1 个 LI 子元素
    expect(document.querySelectorAll('ul > li').length).toBe(1)
  })

  it('TABLE/TD：译文注入到 TD 内部作为 block 子元素', () => {
    document.body.innerHTML =
      '<table><tbody><tr><td data-xt-id="s1">cell</td></tr></tbody></table>'
    const injector = new TranslationInjector()
    injector.inject('s1', '单元格', 'bilingual')

    const td = document.querySelector('[data-xt-id="s1"]')!
    const tgt = document.querySelector('[data-xt-tgt="s1"]')!
    expect(tgt.tagName).toBe('SPAN')
    expect(td.contains(tgt)).toBe(true)
    expect(td.style.display).not.toBe('flex')
    expect(document.querySelectorAll('tr > td').length).toBe(1)
  })

  it('P 元素：变为 flex 左右并排', () => {
    document.body.innerHTML = '<div style="display:flex"><p data-xt-id="s1">para</p></div>'
    const injector = new TranslationInjector()
    injector.inject('s1', '段落', 'bilingual')

    const p = document.querySelector('[data-xt-id="s1"]') as HTMLElement
    const tgt = document.querySelector('[data-xt-tgt="s1"]')!
    expect(p.contains(tgt)).toBe(true)
    expect(p.style.display).toBe('flex')
    // 外部 flex-wrap 未被修改
    const flexDiv = document.querySelector('[style*="flex"]') as HTMLElement
    expect(flexDiv.style.flexWrap).toBe('')
  })

  it('TH：译文注入到 TH 内部作为 block 子元素', () => {
    document.body.innerHTML =
      '<table><tr><th data-xt-id="s1">Header</th></tr></table>'
    const injector = new TranslationInjector()
    injector.inject('s1', '表头', 'bilingual')

    const th = document.querySelector('[data-xt-id="s1"]')!
    const tgt = document.querySelector('[data-xt-tgt="s1"]')!
    expect(tgt.tagName).toBe('SPAN')
    expect(th.contains(tgt)).toBe(true)
    expect(th.style.display).not.toBe('flex')
  })

  it('P 内的 span：span 变为 flex 左右并排', () => {
    document.body.innerHTML = '<p><span data-xt-id="s1">inline</span></p>'
    const injector = new TranslationInjector()
    injector.inject('s1', '内联', 'bilingual')

    const srcSpan = document.querySelector('[data-xt-id="s1"]') as HTMLElement
    const tgt = document.querySelector('[data-xt-tgt="s1"]')!
    expect(srcSpan.contains(tgt)).toBe(true)
    expect(srcSpan.style.display).toBe('flex')
  })

  it('P 带子元素：flex 左列保留所有原始子元素', () => {
    document.body.innerHTML = '<p data-xt-id="s1">Hello <a href="/">link</a> world</p>'
    const injector = new TranslationInjector()
    injector.inject('s1', '你好链接世界', 'bilingual')

    const p = document.querySelector('[data-xt-id="s1"]')!
    const srcCol = p.querySelector('.xt-src-text')!
    // 左列保留 <a> 元素
    expect(srcCol.querySelector('a')).toBeTruthy()
    expect((srcCol.querySelector('a') as HTMLAnchorElement).href).toContain('/')
    expect(srcCol.textContent).toBe('Hello link world')

    const tgt = p.querySelector('[data-xt-tgt="s1"]')!
    expect(tgt.textContent).toBe('你好链接世界')
  })

  it('TBODY/THEAD/TFOOT/TR：正常注入', () => {
    document.body.innerHTML = '<table><tbody data-xt-id="s1"><tr><td>x</td></tr></tbody></table>'
    const injector = new TranslationInjector()
    injector.inject('s1', '表体', 'bilingual')

    const tgt = document.querySelector('[data-xt-tgt="s1"]')
    expect(tgt).toBeTruthy()
  })

  it('流式 append 译文元素正常追加', () => {
    document.body.innerHTML = '<ul><li data-xt-id="s1">item</li></ul>'
    const injector = new TranslationInjector()
    injector.inject('s1', '项', 'bilingual')
    injector.append('s1', '目')
    const tgt = document.querySelector('[data-xt-tgt="s1"]')!
    expect(tgt.textContent).toBe('项目')
  })

  it('restore() 恢复 P flex 布局为原始状态', () => {
    document.body.innerHTML =
      '<ul><li id="li1" data-xt-id="s1">item</li></ul>' +
      '<p id="p1" data-xt-id="s2">para</p>'
    const injector = new TranslationInjector()
    injector.inject('s1', '项目', 'bilingual')
    injector.inject('s2', '段落', 'bilingual')
    injector.restore()

    expect(document.querySelectorAll('[data-xt-tgt]').length).toBe(0)
    expect(document.querySelector('#li1')?.textContent).toBe('item')
    expect(document.querySelector('#p1')?.textContent).toBe('para')
    // P display 恢复
    const p = document.querySelector('#p1') as HTMLElement
    expect(p.style.display).toBe('')
    expect(p.hasAttribute('data-xt-saved-display')).toBe(false)
  })
})

describe('TranslationInjector — v4 setMode 用缓存重注入', () => {
  it('bilingual → translation-only：原文替换 + data-xt-original 记录', () => {
    document.body.innerHTML = '<p data-xt-id="s1">Hello world</p>'
    const inj = new TranslationInjector()
    inj.inject('s1', '你好世界', 'bilingual')
    inj.setMode('translation-only')
    const src = document.querySelector('[data-xt-id="s1"]')!
    expect(src.textContent).toBe('你好世界')
    expect(src.getAttribute('data-xt-original')).toBe('Hello world')
    expect(document.querySelector('[data-xt-tgt="s1"]')).toBeNull()
  })

  it('translation-only → bilingual：原文在 flex 左列，译文在右列', () => {
    document.body.innerHTML = '<p data-xt-id="s2">Original text</p>'
    const inj = new TranslationInjector()
    inj.inject('s2', '译文文字', 'translation-only')
    inj.setMode('bilingual')
    const src = document.querySelector('[data-xt-id="s2"]')!
    expect(src.getAttribute('data-xt-original')).toBeNull()
    const tgt = src.querySelector('[data-xt-tgt="s2"]')!
    expect(tgt.textContent).toBe('译文文字')
    expect(src.querySelector('.xt-src-text')?.textContent).toBe('Original text')
  })

  it('未翻译段切模式无副作用', () => {
    document.body.innerHTML = '<p data-xt-id="s3">untranslated stuff</p>'
    const inj = new TranslationInjector()
    inj.setMode('bilingual')
    expect(document.querySelector('[data-xt-tgt="s3"]')).toBeNull()
  })
})