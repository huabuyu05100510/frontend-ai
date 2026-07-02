import { describe, it, expect } from 'vitest'
import { probe } from '../FormatProbe'

/** 构造带魔数的文件头 */
function head(bytes: number[], padTo = 64): Uint8Array {
  const u = new Uint8Array(padTo)
  u.set(bytes.slice(0, padTo))
  return u
}

/** 在 zip 头后塞入一个 ASCII 标记，模拟 OOXML 目录项 */
function ooxml(marker: string): Uint8Array {
  const u = new Uint8Array(128)
  u.set([0x50, 0x4b, 0x03, 0x04]) // PK\x03\x04
  for (let i = 0; i < marker.length; i++) u[30 + i] = marker.charCodeAt(i)
  return u
}

describe('FormatProbe', () => {
  it('识别 PDF 魔数，归类为 paged，扩展名一致则可信', () => {
    const r = probe(head([0x25, 0x50, 0x44, 0x46, 0x2d]), 'pdf') // %PDF-
    expect(r.realType).toBe('pdf')
    expect(r.category).toBe('paged')
    expect(r.trusted).toBe(true)
  })

  it('PNG 魔数但扩展名声明为 jpg：真实类型 png，不可信但仍可预览', () => {
    const r = probe(head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'jpg')
    expect(r.realType).toBe('png')
    expect(r.category).toBe('raster')
    expect(r.trusted).toBe(false)
  })

  it('拦截伪造：exe(MZ) 改名为 .jpg → 类别 unknown、不可信', () => {
    const r = probe(head([0x4d, 0x5a, 0x90, 0x00]), 'jpg') // MZ
    expect(r.realType).toBe('exe')
    expect(r.category).toBe('unknown')
    expect(r.trusted).toBe(false)
  })

  it('OOXML：zip + word/ 标记 + .docx → docx，flow', () => {
    const r = probe(ooxml('word/document.xml'), 'docx')
    expect(r.container).toBe('ooxml')
    expect(r.realType).toBe('docx')
    expect(r.category).toBe('flow')
    expect(r.trusted).toBe(true)
  })

  it('OOXML：xl/ 标记 → xlsx，sheet', () => {
    const r = probe(ooxml('xl/workbook.xml'), 'xlsx')
    expect(r.realType).toBe('xlsx')
    expect(r.category).toBe('sheet')
  })

  it('OOXML：ppt/ 标记 → pptx，paged', () => {
    const r = probe(ooxml('ppt/presentation.xml'), 'pptx')
    expect(r.realType).toBe('pptx')
    expect(r.category).toBe('paged')
  })

  it('CFB 老 Office：D0CF11E0 + .doc → doc（服务端转换），flow', () => {
    const r = probe(head([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'doc')
    expect(r.container).toBe('cfb')
    expect(r.realType).toBe('doc')
    expect(r.category).toBe('flow')
  })

  it('MP4：偏移 4 处 ftyp → media，从 brand 提取 codecHints', () => {
    const bytes = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d] // ftyp isom
    const r = probe(head(bytes), 'mp4')
    expect(r.container).toBe('mp4box')
    expect(r.realType).toBe('mp4')
    expect(r.category).toBe('media')
    expect(r.codecHints).toContain('isom')
  })

  it('Matroska(mkv)：1A45DFA3 → media', () => {
    const r = probe(head([0x1a, 0x45, 0xdf, 0xa3]), 'mkv')
    expect(r.container).toBe('matroska')
    expect(r.realType).toBe('mkv')
    expect(r.category).toBe('media')
  })

  it('FLV：46 4C 56 → media', () => {
    const r = probe(head([0x46, 0x4c, 0x56, 0x01]), 'flv')
    expect(r.container).toBe('flv')
    expect(r.category).toBe('media')
  })

  it('无魔数的 TXT：按扩展名归类 flow，可信', () => {
    const r = probe(head([0x68, 0x65, 0x6c, 0x6c, 0x6f]), 'txt') // "hello"
    expect(r.realType).toBe('txt')
    expect(r.category).toBe('flow')
    expect(r.trusted).toBe(true)
  })

  it('无魔数的 SRT：按扩展名归类 subtitle', () => {
    const r = probe(head([0x31, 0x0a]), 'srt') // "1\n"
    expect(r.category).toBe('subtitle')
    expect(r.realType).toBe('srt')
  })

  it('JPEG 魔数 + .jpeg：raster，可信', () => {
    const r = probe(head([0xff, 0xd8, 0xff, 0xe0]), 'jpeg')
    expect(r.realType).toBe('jpg')
    expect(r.category).toBe('raster')
    expect(r.trusted).toBe(true)
  })

  it('MP3(ID3) → media', () => {
    const r = probe(head([0x49, 0x44, 0x33, 0x03]), 'mp3') // ID3
    expect(r.realType).toBe('mp3')
    expect(r.category).toBe('media')
  })

  it('空文件头不抛异常，归类 unknown', () => {
    const r = probe(new Uint8Array(0), 'bin')
    expect(r.category).toBe('unknown')
    expect(r.trusted).toBe(false)
  })
})
