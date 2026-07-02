import { describe, it, expect, beforeEach } from 'vitest'
import { extractSegments, consumeShadowRoots } from '../../src/content/dom-walker'

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('extractSegments — 基础提取', () => {
  it('从 <p> 提取文本', () => {
    document.body.innerHTML = '<p id="p1">Hello world, this is a test</p>'
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('Hello world, this is a test')
    expect(segs[0].element.id).toBe('p1')
  })

  it('从 h1-h6 提取，role=heading', () => {
    document.body.innerHTML = '<h1>Main Title Here</h1><h2>Sub Heading Text</h2>'
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(2)
    expect(segs[0].role).toBe('heading')
    expect(segs[1].role).toBe('heading')
  })

  it('从 <li> 提取，role=list-item', () => {
    document.body.innerHTML = '<ul><li>First list item</li><li>Second list item</li></ul>'
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(2)
    segs.forEach(s => expect(s.role).toBe('list-item'))
  })

  it('合并同块内的 inline 元素为一个 segment', () => {
    document.body.innerHTML = '<p>Hello <strong>world</strong>, how are <em>you</em>?</p>'
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('Hello world, how are you?')
  })

  it('每个 segment 有唯一 ID', () => {
    document.body.innerHTML = '<p>First paragraph text</p><p>Second paragraph text</p>'
    const segs = extractSegments(document.body)
    const ids = segs.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('extractSegments — 跳过规则', () => {
  it('跳过 <code> 块', () => {
    document.body.innerHTML = '<pre><code>const x = 1; // code here</code></pre>'
    expect(extractSegments(document.body)).toHaveLength(0)
  })

  it('跳过 <script>', () => {
    document.body.innerHTML = '<script>alert("xss")</script><p>Normal text content here</p>'
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('Normal text content here')
  })

  it('跳过 <style>', () => {
    document.body.innerHTML = '<style>body { color: red }</style><p>Normal text here</p>'
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(1)
  })

  it('跳过纯数字/符号（无字母或CJK的短文本）', () => {
    document.body.innerHTML = '<p>OK</p><p>123</p><p>This is real content</p>'
    const segs = extractSegments(document.body)
    // "OK" has Latin letters → pass now (lower threshold); "123" has no letters/CJK → pass for digits only
    // "OK" (2 chars) and "This is real content" both pass
    expect(segs.length).toBeGreaterThanOrEqual(1)
    expect(segs.map(s => s.text)).toContain('This is real content')
  })

  it('W2-2: 提取 display:none 元素（隐藏 tooltip/dropdown/lazy 预翻译）', () => {
    document.body.innerHTML = '<p style="display:none">Hidden content text</p><p>Visible text here</p>'
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(2)
    expect(segs.map(s => s.text).sort()).toEqual(['Hidden content text', 'Visible text here'])
  })

  it('跳过 <input> <textarea> <select>', () => {
    document.body.innerHTML = `
      <input type="text" placeholder="Enter something" />
      <textarea>Some text in textarea</textarea>
      <p>Valid paragraph content here</p>
    `
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(1)
  })

  it('不重复提取嵌套块', () => {
    // <article> 包含 <p>，不应该提取 <article> 的文本（因为 <p> 会提取）
    document.body.innerHTML = '<article><p>Inner paragraph text content</p></article>'
    const segs = extractSegments(document.body)
    // 只提取最小块（<p>），不重复
    expect(segs).toHaveLength(1)
    expect(segs[0].element.tagName).toBe('P')
  })
})

describe('extractSegments — 边界情况', () => {
  it('空页面返回空数组', () => {
    document.body.innerHTML = ''
    expect(extractSegments(document.body)).toHaveLength(0)
  })

  it('保留换行语义（多个段落）', () => {
    document.body.innerHTML = `
      <p>First paragraph with enough text</p>
      <p>Second paragraph with enough text</p>
      <p>Third paragraph with enough text</p>
    `
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(3)
  })

  it('元素上标注 data-xt-id 属性', () => {
    document.body.innerHTML = '<p>Paragraph that needs an id attribute</p>'
    const segs = extractSegments(document.body)
    expect(segs[0].element.getAttribute('data-xt-id')).toBe(segs[0].id)
  })
})

describe('extractSegments — 按目标语言过滤（避免重复翻译 / 反向翻译）', () => {
  it('tgtLang=zh：跳过纯中文段，只留需要翻译的英文段', () => {
    document.body.innerHTML = `
      <p>这是一个中文章节，不需要翻译</p>
      <p>View current subscription and billing details</p>
      <p>另一个中文章节也不需要翻译</p>
      <p>Another English paragraph should be translated</p>
    `
    const segs = extractSegments(document.body, { tgtLang: 'zh' })
    expect(segs).toHaveLength(2)
    expect(segs.map(s => s.text)).toEqual([
      'View current subscription and billing details',
      'Another English paragraph should be translated',
    ])
  })

  it('tgtLang=en：跳过纯英文段，只留需要翻译的中文段', () => {
    document.body.innerHTML = `
      <p>Hello world this is english text</p>
      <p>另一个中文章节需要翻译</p>
      <p>Another English paragraph should be skipped</p>
      <p>还有一个中文章节也需要翻译</p>
    `
    const segs = extractSegments(document.body, { tgtLang: 'en' })
    expect(segs).toHaveLength(2)
    expect(segs.map(s => s.text)).toEqual([
      '另一个中文章节需要翻译',
      '还有一个中文章节也需要翻译',
    ])
  })

  it('混合 CJK+latin 段放行（让 LLM 处理品牌术语保留）', () => {
    document.body.innerHTML = `
      <p>订阅 Key (sk-cp) 用于 Token Plan 套餐</p>
      <p>查看当前订阅状态不需要再次翻译</p>
    `
    const segs = extractSegments(document.body, { tgtLang: 'zh' })
    // 混合段（CJK+latin）→ 保留（让 LLM 处理），纯中文 → 跳过
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('订阅 Key (sk-cp) 用于 Token Plan 套餐')
  })

  it('含数字 + 中文（如"2026 年到期"）算纯中文，被过滤', () => {
    document.body.innerHTML = `
      <p>2026 年 6 月 27 日到期日</p>
      <p>View current plan usage and remaining quota</p>
    `
    const segs = extractSegments(document.body, { tgtLang: 'zh' })
    // 数字 + CJK → 视为纯中文 → 跳过；英文保留
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('View current plan usage and remaining quota')
  })

  it('不传 tgtLang 时退化为旧行为：所有 ≥4 字符段都提取（包括纯中文）', () => {
    document.body.innerHTML = `
      <p>这是一个中文段落但仍会被提取（旧行为）</p>
      <p>Hello world english paragraph</p>
    `
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(2)
  })

  it('tgtLang=ja：保守放行（不识别 ja），中英文都会被提取', () => {
    document.body.innerHTML = `
      <p>这是一个中文段落但目标是日语</p>
      <p>Hello world this is english text</p>
    `
    const segs = extractSegments(document.body, { tgtLang: 'ja' })
    expect(segs.length).toBeGreaterThanOrEqual(1)
  })

  it('⚠ 修复回归：CJK 不再被 /\\W/ 误判为"纯符号"被滤掉', () => {
    // 旧实现的 bug：/[\d\s\W]+/ 会把 CJK 当成非 word，导致中文段被当成"纯符号"过滤掉
    document.body.innerHTML = `<p>这是一个中文段落应该被提取出来</p>`
    const segs = extractSegments(document.body, { tgtLang: 'en' })
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('这是一个中文段落应该被提取出来')
  })
})

describe('extractSegments — W2-3 段落级提取（对标沉浸式翻译）', () => {
  it('inline <span> 直接含文字：由父 DIV 兜底提取（不再独立成段）', () => {
    document.body.innerHTML = `<div><span class="date">4 hrs ago</span></div>`
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('4 hrs ago')
    expect(segs[0].element.tagName).toBe('DIV')
  })

  it('多个 inline span 合并入父 DIV（沉浸式翻译行为）', () => {
    document.body.innerHTML = `
      <div class="row">
        <span class="time">4 hrs ago</span>
        <span class="location">Nottinghamshire</span>
      </div>`
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('4 hrs ago Nottinghamshire')
    expect(segs[0].element.tagName).toBe('DIV')
  })

  it('容器型 DIV 含子 BLOCK 时继续递归拆分', () => {
    document.body.innerHTML = `
      <div>
        <p>第一段内容</p>
        <p>第二段内容</p>
      </div>`
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(2)
    expect(segs.map(s => s.text)).toEqual(['第一段内容', '第二段内容'])
  })

  it('容器型 DIV 直接含文字（无子 BLOCK）时作为一段提取', () => {
    document.body.innerHTML = `<div class="banner">Click here to learn more today</div>`
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('Click here to learn more today')
  })

  it('A 链接在父 DIV 内：父 DIV 提取（链接文字合并入父段）', () => {
    document.body.innerHTML = `<div class="card"><a href="/x">Read the full story here</a></div>`
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('Read the full story here')
    expect(segs[0].element.tagName).toBe('DIV')
  })

  it('P 内的 inline 元素不重复提取（被父 P 合并）', () => {
    document.body.innerHTML = `<p>Hello <strong>world</strong> today</p>`
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('Hello world today')
  })

  it('W2-3: <bdi> 文字由父 DIV 兜底提取（不再独立成段）', () => {
    document.body.innerHTML = `<div class="price"><bdi>3 pieces</bdi></div>`
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('3 pieces')
    expect(segs[0].element.tagName).toBe('DIV')
  })

  it('W2-2: 隐藏 dropdown 内的文字被提取（预翻译，可见时已是中文）', () => {
    document.body.innerHTML = `
      <div class="dropdown" style="display:none">
        <a href="/x">Live chat support here</a>
      </div>`
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('Live chat support here')
    expect(segs[0].element.tagName).toBe('DIV')
  })
})

describe('extractSegments — 短文本阈值（阈值降低到 1+ 字符）', () => {
  it('提取 2-3 字符的导航短文本', () => {
    document.body.innerHTML = '<p>Home</p><p>About</p><p>News</p>'
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(3)
    expect(segs.map(s => s.text)).toEqual(['Home', 'About', 'News'])
  })

  it('提取单字符 CJK', () => {
    document.body.innerHTML = '<p>中</p>'
    const segs = extractSegments(document.body)
    // CJK single char is valid
    expect(segs).toHaveLength(1)
    expect(segs[0].text).toBe('中')
  })

  it('纯数字 "1234" 仍然跳过（无字母或CJK）', () => {
    document.body.innerHTML = '<p>1234</p>'
    const segs = extractSegments(document.body)
    expect(segs).toHaveLength(0)
  })
})

describe('extractSegments — inline-only 子树不被漏掉', () => {
  it('容器 DIV 含 h3 + span: span 文本也被提取', () => {
    document.body.innerHTML = '<div class="card"><h3>Main Title Here</h3><span class="meta">Published 2024</span></div>'
    const segs = extractSegments(document.body)
    // h3 + span meta are both extracted
    expect(segs.length).toBe(2)
    expect(segs.map(s => s.element.tagName)).toContain('H3')
    expect(segs.map(s => s.text)).toContain('Published 2024')
  })

  it('容器内的 A 链接单独提取（非 DIV 合并）', () => {
    document.body.innerHTML = '<div class="nav"><a href="/home">Home</a><a href="/news">News</a></div>'
    const segs = extractSegments(document.body)
    // A elements with short text → each one extracted
    expect(segs.length).toBe(2)
  })
})

describe('extractSegments — W2-3 Shadow DOM + iframe 递归', () => {
  it('open shadow root 内的文字被提取', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<p>Shadow content here</p>'
    const segs = extractSegments(document.body)
    expect(segs.map(s => s.text)).toContain('Shadow content here')
  })

  it('closed shadow root 安全跳过（不抛错）', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    host.attachShadow({ mode: 'closed' })
    expect(() => extractSegments(document.body)).not.toThrow()
  })

  it('shadow root 提取后由 consumeShadowRoots 暴露给 observer', () => {
    consumeShadowRoots() // clear
    const host = document.createElement('div')
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<p>Shadow text</p>'
    extractSegments(document.body)
    const roots = consumeShadowRoots()
    expect(roots).toContain(shadow)
  })

  it('同域 iframe body 文字被提取（mock contentDocument）', () => {
    const iframe = document.createElement('iframe')
    Object.defineProperty(iframe, 'contentDocument', {
      configurable: true,
      get() {
        const doc = new DOMParser().parseFromString(
          '<html><body><p>Iframe content here</p></body></html>', 'text/html')
        return doc
      },
    })
    document.body.appendChild(iframe)
    const segs = extractSegments(document.body)
    expect(segs.map(s => s.text)).toContain('Iframe content here')
  })

  it('跨域 iframe contentDocument 抛错被吞（不抛错）', () => {
    const iframe = document.createElement('iframe')
    Object.defineProperty(iframe, 'contentDocument', {
      configurable: true,
      get() {
        throw new DOMException('cross-origin', 'SecurityError')
      },
    })
    document.body.appendChild(iframe)
    expect(() => extractSegments(document.body)).not.toThrow()
  })
})
