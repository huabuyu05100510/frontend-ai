import { describe, it, expect } from 'vitest'
import { probeFile, extOf } from '../probeFile'
import { BlobSource } from '../SourceHandle'

function file(bytes: number[], name: string): BlobSource {
  return new BlobSource(new File([new Uint8Array(bytes)], name))
}

describe('extOf', () => {
  it('取小写扩展名', () => {
    expect(extOf('Report.PDF')).toBe('pdf')
    expect(extOf('a.b.docx')).toBe('docx')
    expect(extOf('noext')).toBe('')
    expect(extOf('archive.tar.gz')).toBe('gz')
  })
})

describe('probeFile（从真实字节探测）', () => {
  it('真实 PDF 文件 → paged', async () => {
    const r = await probeFile(file([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31], 'doc.pdf'))
    expect(r.realType).toBe('pdf')
    expect(r.category).toBe('paged')
    expect(r.trusted).toBe(true)
  })

  it('真实 PNG → raster', async () => {
    const r = await probeFile(file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'pic.png'))
    expect(r.realType).toBe('png')
    expect(r.category).toBe('raster')
  })

  it('OOXML docx（zip + word/ 标记）→ flow', async () => {
    const bytes = [0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]
    const marker = 'word/document.xml'
    for (let i = 0; i < marker.length; i++) bytes[30 + i] = marker.charCodeAt(i)
    const r = await probeFile(file(bytes, 'a.docx'))
    expect(r.realType).toBe('docx')
    expect(r.category).toBe('flow')
  })

  it('伪造：exe 改名 .jpg → unknown，不可信', async () => {
    const r = await probeFile(file([0x4d, 0x5a, 0x90, 0x00], '病毒.jpg'))
    expect(r.category).toBe('unknown')
    expect(r.trusted).toBe(false)
  })

  it('无魔数 txt 按扩展名 → flow', async () => {
    const r = await probeFile(file([0x68, 0x69], 'note.txt'))
    expect(r.category).toBe('flow')
    expect(r.realType).toBe('txt')
  })

  it('只读取文件头（不依赖整文件大小）', async () => {
    const big = new Uint8Array(10000)
    big.set([0x25, 0x50, 0x44, 0x46])
    const r = await probeFile(new BlobSource(new File([big], 'big.pdf')))
    expect(r.realType).toBe('pdf')
  })
})
