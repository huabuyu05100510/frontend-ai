import { describe, it, expect } from 'vitest'
import { layoutOcrBoxes, ocrText, type OcrWord } from '../layout'

const words: OcrWord[] = [
  { text: '苹果', x0: 10, y0: 20, x1: 110, y1: 60 },
  { text: 'Banana', x0: 10, y0: 80, x1: 210, y1: 120 },
]

describe('layoutOcrBoxes', () => {
  it('按渲染尺寸缩放词框', () => {
    const boxes = layoutOcrBoxes(words, { w: 1000, h: 500 }, { w: 500, h: 250 })
    expect(boxes[0]).toEqual({ left: 5, top: 10, width: 50, height: 20, text: '苹果' })
    expect(boxes[1]).toEqual({ left: 5, top: 40, width: 100, height: 20, text: 'Banana' })
  })

  it('1:1 渲染保持原坐标', () => {
    const boxes = layoutOcrBoxes(words, { w: 300, h: 200 }, { w: 300, h: 200 })
    expect(boxes[0].left).toBe(10)
    expect(boxes[0].width).toBe(100)
  })

  it('退化尺寸返回空', () => {
    expect(layoutOcrBoxes(words, { w: 0, h: 0 }, { w: 10, h: 10 })).toEqual([])
  })
})

describe('ocrText', () => {
  it('拼接全部词为可复制文本', () => {
    expect(ocrText(words)).toBe('苹果 Banana')
  })
})
