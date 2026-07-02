import { describe, it, expect } from 'vitest'
import { parseDocx, parseRels, parseStylesXml } from '../docx'

const doc = (body: string) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`

describe('parseDocx', () => {
  it('普通段落与文本拼接', () => {
    const blocks = parseDocx(doc('<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>World</w:t></w:r></w:p>'))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('paragraph')
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].runs.map((r) => r.text).join('')).toBe('Hello World')
    }
  })

  it('标题（pStyle=Heading1）识别等级', () => {
    const blocks = parseDocx(doc('<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>章节</w:t></w:r></w:p>'))
    expect(blocks[0].type).toBe('heading')
    if (blocks[0].type === 'heading') {
      expect(blocks[0].level).toBe(2)
      expect(blocks[0].runs[0].text).toBe('章节')
    }
  })

  it('加粗/斜体 run 样式', () => {
    const blocks = parseDocx(
      doc('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>粗</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>斜</w:t></w:r></w:p>'),
    )
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].runs[0].bold).toBe(true)
      expect(blocks[0].runs[1].italic).toBe(true)
    }
  })

  it('w:b w:val="false" 不算加粗', () => {
    const blocks = parseDocx(doc('<w:p><w:r><w:rPr><w:b w:val="false"/></w:rPr><w:t>x</w:t></w:r></w:p>'))
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].runs[0].bold).toBeFalsy()
    }
  })

  it('表格解析为行列单元格', () => {
    const tbl =
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    const blocks = parseDocx(doc(tbl))
    expect(blocks[0].type).toBe('table')
    if (blocks[0].type === 'table') {
      expect(blocks[0].rows.length).toBe(2)
      expect(blocks[0].rows[0].length).toBe(2)
      const cellText = (cell: { text: string }[]) => cell.map((r) => r.text).join('')
      expect(cellText(blocks[0].rows[0][0])).toBe('A1')
      expect(cellText(blocks[0].rows[1][1])).toBe('B2')
    }
  })

  it('保持块顺序', () => {
    const blocks = parseDocx(
      doc(
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>正文</w:t></w:r></w:p>',
      ),
    )
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph'])
  })

  it('空段落产出空 runs 段落', () => {
    const blocks = parseDocx(doc('<w:p/>'))
    expect(blocks[0].type).toBe('paragraph')
    if (blocks[0].type === 'paragraph') expect(blocks[0].runs).toEqual([])
  })

  it('解析段落对齐（center / 居中）', () => {
    const blocks = parseDocx(doc('<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>中</w:t></w:r></w:p>'))
    expect(blocks[0].type).toBe('paragraph')
    if (blocks[0].type === 'paragraph') expect(blocks[0].align).toBe('center')
  })

  it('w:jc=both 归一为 justify', () => {
    const blocks = parseDocx(doc('<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'))
    if (blocks[0].type === 'paragraph') expect(blocks[0].align).toBe('justify')
  })

  it('提取内嵌图片为 image 块（rId + 尺寸 EMU→px）', () => {
    const drawing =
      '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="952500"/>' +
      '<a:graphic><a:graphicData><pic:pic><pic:blipFill>' +
      '<a:blip r:embed="rId7"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>' +
      '</wp:inline></w:drawing></w:r></w:p>'
    const blocks = parseDocx(doc(drawing))
    const img = blocks.find((b) => b.type === 'image')
    expect(img).toBeTruthy()
    if (img && img.type === 'image') {
      expect(img.rId).toBe('rId7')
      expect(img.width).toBe(200) // 1905000 / 9525
      expect(img.height).toBe(100)
    }
  })

  it('图文混排：文本块在前，图片块随后', () => {
    const mixed =
      '<w:p><w:r><w:t>说明</w:t></w:r>' +
      '<w:r><w:drawing><a:blip r:embed="rId3"/></w:drawing></w:r></w:p>'
    const blocks = parseDocx(doc(mixed))
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'image'])
  })
})

describe('parseRels', () => {
  it('解析关系表 Id→Target', () => {
    const xml =
      '<Relationships><Relationship Id="rId7" Type="image" Target="media/image1.png"/>' +
      '<Relationship Id="rId1" Type="styles" Target="styles.xml"/></Relationships>'
    expect(parseRels(xml)).toEqual({ rId7: 'media/image1.png', rId1: 'styles.xml' })
  })
})

// ---------------------------------------------------------------- styles.xml ----
const stylesRoot = (body: string) =>
  `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:styles>`

describe('parseStylesXml', () => {
  it('空 styles.xml 返回 {}', () => {
    expect(parseStylesXml(stylesRoot(''))).toEqual({})
  })

  it('异常 XML 不抛异常（返回 {} 或部分解析）', () => {
    // 残缺 XML：解析器返回 #root，无样式条目
    expect(() => parseStylesXml('<w:styles><w:style')).not.toThrow()
    expect(parseStylesXml('<w:styles><w:style')).toEqual({})
  })

  it('解析 paragraph 样式：字号/加粗/颜色', () => {
    const xml = stylesRoot(
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
        '<w:name w:val="Normal"/>' +
        '<w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/><w:color w:val="FF0000"/></w:rPr>' +
        '<w:pPr><w:spacing w:before="120" w:after="120" w:line="360" w:lineRule="auto"/></w:pPr>' +
        '</w:style>',
    )
    const map = parseStylesXml(xml)
    expect(map.Normal).toBeDefined()
    expect(map.Normal.fontSize).toBe(12) // 24 / 2
    expect(map.Normal.fontSizeCs).toBe(12)
    expect(map.Normal.color).toBe('#FF0000')
    expect(map.Normal.isDefault).toBe(true)
    // spacing line=360 auto → 1.5x
    expect(map.Normal.lineSpacing).toBeCloseTo(1.5)
  })

  it('解析 character 样式（仅 rPr，无 pPr）', () => {
    const xml = stylesRoot(
      '<w:style w:type="character" w:styleId="Hyperlink">' +
        '<w:name w:val="Hyperlink"/>' +
        '<w:rPr><w:color w:val="0000FF"/><w:u w:val="single"/></w:rPr>' +
        '</w:style>',
    )
    const map = parseStylesXml(xml)
    expect(map.Hyperlink).toBeDefined()
    expect(map.Hyperlink.color).toBe('#0000FF')
    expect(map.Hyperlink.underline).toBe(true)
  })

  it('docDefaults 合并到未指定值的 style', () => {
    const xml = stylesRoot(
      '<w:docDefaults>' +
        '<w:rPrDefault><w:rPr><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault>' +
        '<w:pPrDefault><w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
        '</w:docDefaults>' +
        '<w:style w:type="paragraph" w:styleId="Normal">' +
        '<w:name w:val="Normal"/>' +
        '</w:style>',
    )
    const map = parseStylesXml(xml)
    expect(map.Normal).toBeDefined()
    // docDefaults 已注入到 Normal：21/2 = 10.5pt
    expect(map.Normal.fontSize).toBeCloseTo(10.5)
    // 1.15x 行距（276/240）
    expect(map.Normal.lineSpacing).toBeCloseTo(1.15)
  })

  it('docDefaults + style 显式值：style 覆盖 defaults', () => {
    const xml = stylesRoot(
      '<w:docDefaults>' +
        '<w:rPrDefault><w:rPr><w:sz w:val="21"/></w:rPr></w:rPrDefault>' +
        '</w:docDefaults>' +
        '<w:style w:type="paragraph" w:styleId="Heading1">' +
        '<w:name w:val="heading 1"/>' +
        '<w:rPr><w:sz w:val="32"/><w:b/></w:rPr>' +
        '</w:style>',
    )
    const map = parseStylesXml(xml)
    expect(map.Heading1).toBeDefined()
    expect(map.Heading1.fontSize).toBe(16) // 32/2
    expect(map.Heading1.bold).toBe(true)
  })

  it('basedOn 记录在 basedOn 字段（暂不递归）', () => {
    const xml = stylesRoot(
      '<w:style w:type="paragraph" w:styleId="Heading1">' +
        '<w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>' +
        '<w:rPr><w:sz w:val="32"/><w:b/></w:rPr>' +
        '</w:style>',
    )
    const map = parseStylesXml(xml)
    expect(map.Heading1.basedOn).toBe('Normal')
    expect(map.Heading1.fontSize).toBe(16)
  })

  it('基于 docDefaults 注入字号（21pt 默认 → 10.5pt）', () => {
    const xml = stylesRoot(
      '<w:docDefaults>' +
        '<w:rPrDefault><w:rPr><w:sz w:val="24"/><w:b/></w:rPr></w:rPrDefault>' +
        '</w:docDefaults>' +
        '<w:style w:type="paragraph" w:styleId="BodyText">' +
        '<w:name w:val="Body Text"/>' +
        '<w:rPr><w:i/></w:rPr>' + // 仅有 italic
        '</w:style>',
    )
    const map = parseStylesXml(xml)
    expect(map.BodyText.fontSize).toBe(12) // 来自 docDefault
    expect(map.BodyText.bold).toBe(true) // 来自 docDefault
    expect(map.BodyText.italic).toBe(true) // style 自身
  })
})

// ---------------------------------------------------------------- CJK szCs ----
describe('CJK 字号 w:szCs', () => {
  it('w:szCs 优先于 w:sz', () => {
    const blocks = parseDocx(
      doc('<w:p><w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="32"/></w:rPr><w:t>中</w:t></w:r></w:p>'),
    )
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].runs[0].fontSize).toBe(16) // szCs=32/2
    }
  })

  it('仅有 w:sz 时回退到 w:sz/2', () => {
    const blocks = parseDocx(
      doc('<w:p><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>A</w:t></w:r></w:p>'),
    )
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].runs[0].fontSize).toBe(12)
    }
  })

  it('同时缺省时无 fontSize', () => {
    const blocks = parseDocx(
      doc('<w:p><w:r><w:t>x</w:t></w:r></w:p>'),
    )
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].runs[0].fontSize).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------- 行距 w:line ----
describe('行距 w:line', () => {
  it('lineRule=auto, line=480 → 2x', () => {
    const blocks = parseDocx(
      doc('<w:p><w:pPr><w:spacing w:line="480" w:lineRule="auto"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'),
    )
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].lineHeight).toBeCloseTo(2.0)
    }
  })

  it('lineRule=auto, line=360 → 1.5x', () => {
    const blocks = parseDocx(
      doc('<w:p><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'),
    )
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].lineHeight).toBeCloseTo(1.5)
    }
  })

  it('lineRule=exact, line=480 → 480/240=2.0（倍数等同 auto）', () => {
    const blocks = parseDocx(
      doc('<w:p><w:pPr><w:spacing w:line="480" w:lineRule="exact"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'),
    )
    if (blocks[0].type === 'paragraph') {
      // exact 模式下通常用 line/20 转 pt 行高；但为简化，我们也按倍数处理
      expect(blocks[0].lineHeight).toBeCloseTo(2.0)
    }
  })

  it('无 w:line 时 lineHeight 不设置', () => {
    const blocks = parseDocx(doc('<w:p><w:r><w:t>x</w:t></w:r></w:p>'))
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].lineHeight).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------- 首行缩进 ----
describe('首行缩进 w:firstLine', () => {
  it('w:firstLine=480 twips → 32px', () => {
    const blocks = parseDocx(
      doc('<w:p><w:pPr><w:ind w:firstLine="480"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'),
    )
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].indentFirstLine).toBe(32)
    }
  })

  it('w:firstLine=210 → 14px（一个汉字 ≈ 14px@10.5pt）', () => {
    const blocks = parseDocx(
      doc('<w:p><w:pPr><w:ind w:firstLine="210"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'),
    )
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].indentFirstLine).toBe(14)
    }
  })

  it('w:hanging=240（左悬挂 240twips）→ 16px', () => {
    const blocks = parseDocx(
      doc('<w:p><w:pPr><w:ind w:hanging="240"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'),
    )
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].indentFirstLine).toBe(16)
    }
  })

  it('无 w:firstLine 时 indentFirstLine 不设置', () => {
    const blocks = parseDocx(doc('<w:p><w:r><w:t>x</w:t></w:r></w:p>'))
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].indentFirstLine).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------- styles 集成 ----
describe('parseDocx + styles 集成', () => {
  it('run 引用 rStyle 命中 styles.xml 的字体/颜色', () => {
    const stylesXml = stylesRoot(
      '<w:style w:type="character" w:styleId="Highlight">' +
        '<w:name w:val="Highlight"/>' +
        '<w:rPr><w:sz w:val="36"/><w:color w:val="FF8800"/><w:b/></w:rPr>' +
        '</w:style>',
    )
    const styles = parseStylesXml(stylesXml)
    const blocks = parseDocx(
      doc('<w:p><w:r><w:rPr><w:rStyle w:val="Highlight"/></w:rPr><w:t>x</w:t></w:r></w:p>'),
      undefined,
      styles,
    )
    if (blocks[0].type === 'paragraph') {
      const r = blocks[0].runs[0]
      expect(r.fontSize).toBe(18) // 36/2
      expect(r.color).toBe('#FF8800')
      expect(r.bold).toBe(true)
    }
  })

  it('paragraph 引用 pStyle 命中 styles.xml 的行距', () => {
    const stylesXml = stylesRoot(
      '<w:style w:type="paragraph" w:styleId="LooseLine">' +
        '<w:name w:val="Loose"/>' +
        '<w:pPr><w:spacing w:line="480" w:lineRule="auto"/></w:pPr>' +
        '</w:style>',
    )
    const styles = parseStylesXml(stylesXml)
    const blocks = parseDocx(
      doc('<w:p><w:pPr><w:pStyle w:val="LooseLine"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'),
      undefined,
      styles,
    )
    if (blocks[0].type === 'paragraph') {
      expect(blocks[0].lineHeight).toBeCloseTo(2.0)
    }
  })

  it('显式 run/段落样式覆盖 styles 默认', () => {
    const stylesXml = stylesRoot(
      '<w:style w:type="character" w:styleId="Base">' +
        '<w:name w:val="Base"/>' +
        '<w:rPr><w:sz w:val="36"/><w:color w:val="FF0000"/></w:rPr>' +
        '</w:style>',
    )
    const styles = parseStylesXml(stylesXml)
    const blocks = parseDocx(
      doc(
        '<w:p><w:r><w:rPr><w:rStyle w:val="Base"/><w:color w:val="00FF00"/></w:rPr><w:t>x</w:t></w:r></w:p>',
      ),
      undefined,
      styles,
    )
    if (blocks[0].type === 'paragraph') {
      // 字号来自 style 兜底，颜色被 run 覆盖
      expect(blocks[0].runs[0].fontSize).toBe(18)
      expect(blocks[0].runs[0].color).toBe('#00FF00')
    }
  })
})
