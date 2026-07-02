import { describe, it, expect } from 'vitest'
import { parseSlide } from '../pptx'

const shape = (text: string, x = 0, y = 0) =>
  `<p:sp><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="100" cy="50"/></a:xfrm></p:spPr>` +
  `<p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`

const slide = (shapes: string) =>
  `<p:sld xmlns:p="ns" xmlns:a="ns"><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`

describe('parseSlide', () => {
  it('提取每个文本框的文本与坐标', () => {
    const s = parseSlide(3, slide(shape('标题', 100, 200) + shape('正文', 300, 400)))
    expect(s.index).toBe(3)
    expect(s.texts).toHaveLength(2)
    expect(s.texts[0]).toMatchObject({ text: '标题', x: 100, y: 200, w: 100, h: 50 })
    expect(s.texts[1]).toMatchObject({ text: '正文', x: 300, y: 400 })
  })

  it('多段落文本用换行拼接', () => {
    const sp =
      '<p:sp><p:txBody><a:p><a:r><a:t>第一行</a:t></a:r></a:p><a:p><a:r><a:t>第二行</a:t></a:r></a:p></p:txBody></p:sp>'
    const s = parseSlide(1, slide(sp))
    expect(s.texts[0].text).toBe('第一行\n第二行')
  })

  it('一个段落多 run 直接拼接', () => {
    const sp = '<p:sp><p:txBody><a:p><a:r><a:t>Hello </a:t></a:r><a:r><a:t>World</a:t></a:r></a:p></p:txBody></p:sp>'
    const s = parseSlide(1, slide(sp))
    expect(s.texts[0].text).toBe('Hello World')
  })

  it('忽略无文本的形状', () => {
    const empty = '<p:sp><p:spPr><a:xfrm><a:off x="1" y="2"/></a:xfrm></p:spPr></p:sp>'
    const s = parseSlide(1, slide(empty + shape('有字')))
    expect(s.texts).toHaveLength(1)
    expect(s.texts[0].text).toBe('有字')
  })

  it('无坐标默认 0', () => {
    const sp = '<p:sp><p:txBody><a:p><a:r><a:t>X</a:t></a:r></a:p></p:txBody></p:sp>'
    const s = parseSlide(1, slide(sp))
    expect(s.texts[0]).toMatchObject({ text: 'X', x: 0, y: 0 })
  })

  it('提取图片 p:pic 的位置/尺寸与 r:embed', () => {
    const pic =
      '<p:pic><p:blipFill><a:blip r:embed="rId7"/></p:blipFill><p:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr></p:pic>'
    const s = parseSlide(1, slide(pic))
    expect(s.images).toHaveLength(1)
    expect(s.images[0]).toMatchObject({ x: 10, y: 20, w: 300, h: 400, rId: 'rId7' })
  })

  it('提取字号(sz/100=pt)与粗体/颜色', () => {
    const sp =
      '<p:sp><p:txBody><a:p><a:r><a:rPr sz="4000" b="1"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>大标题</a:t></a:r></a:p></p:txBody></p:sp>'
    const s = parseSlide(1, slide(sp))
    expect(s.texts[0]).toMatchObject({ text: '大标题', size: 40, bold: true, color: '#FF0000' })
  })
})
