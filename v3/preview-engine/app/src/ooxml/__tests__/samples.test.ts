import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadDocx } from '../docx'
import { loadXlsx } from '../xlsx'
import { loadPptx } from '../pptx'

// 用真实生成的样例文件（preview-engine/samples）跑通真实 loader（缺失则跳过）
const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../samples')
const read = (f: string) => new Uint8Array(readFileSync(path.join(SAMPLES, f)))
const has = (f: string) => existsSync(path.join(SAMPLES, f))

describe('真实样例文件端到端', () => {
  it.skipIf(!has('sample.docx'))('loadDocx：标题/对齐/表格/图片块', async () => {
    const blocks = await loadDocx(read('sample.docx'))
    const types = blocks.map((b) => b.type)
    expect(types).toContain('heading')
    expect(types).toContain('table')
    expect(types).toContain('image')
    const centered = blocks.find((b) => (b.type === 'paragraph' || b.type === 'heading') && b.align === 'center')
    expect(centered).toBeTruthy()
    const img = blocks.find((b) => b.type === 'image')
    expect(img && img.type === 'image' && img.target).toBe('word/media/image1.png')
  })

  it.skipIf(!has('sample.xlsx'))('loadXlsx：共享串与数值', async () => {
    const m = await loadXlsx(read('sample.xlsx'))
    expect(m.cells.get('0,0')?.text).toBe('名称')
    expect(m.cells.get('1,0')?.text).toBe('苹果')
    expect(m.cells.get('1,1')?.text).toBe('3')
  })

  it.skipIf(!has('sample.pptx'))('loadPptx：两页文本', async () => {
    const slides = await loadPptx(read('sample.pptx'))
    expect(slides.length).toBe(2)
    expect(slides[0].texts[0].text).toContain('第一页')
    expect(slides[1].texts[0].text).toContain('第二页')
  })
})
