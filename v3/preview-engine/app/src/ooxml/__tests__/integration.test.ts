import { describe, it, expect } from 'vitest'
import { loadDocx } from '../docx'
import { loadXlsx } from '../xlsx'
import { loadPptx } from '../pptx'

// 用真实 deflate 压缩造出合法 OOXML zip 字节，验证 ZIP→解压→解析 全链路
const enc = new TextEncoder()
const u16 = (n: number) => [n & 255, (n >> 8) & 255]
const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw')
  const s = new Response(data as BlobPart).body!.pipeThrough(cs)
  return new Uint8Array(await new Response(s).arrayBuffer())
}

async function makeOoxml(parts: Record<string, string>): Promise<Uint8Array> {
  const files = Object.entries(parts)
  const locals: number[][] = []
  const centrals: number[][] = []
  let offset = 0
  for (const [name, text] of files) {
    const raw = enc.encode(text)
    const data = await deflateRaw(raw)
    const nameB = enc.encode(name)
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(8),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(data.length), ...u32(raw.length),
      ...u16(nameB.length), ...u16(0), ...nameB, ...Array.from(data),
    ]
    const central = [
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(8),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(data.length), ...u32(raw.length),
      ...u16(nameB.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameB,
    ]
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const cdBytes = centrals.flat()
  const eocd = [
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(cdBytes.length), ...u32(offset), ...u16(0),
  ]
  return new Uint8Array([...locals.flat(), ...cdBytes, ...eocd])
}

describe('OOXML 端到端（真实 zip 字节）', () => {
  it('loadDocx', async () => {
    const xml =
      '<w:document xmlns:w="x"><w:body>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>报告</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>这是一段正文。</w:t></w:r></w:p>' +
      '</w:body></w:document>'
    const bytes = await makeOoxml({ 'word/document.xml': xml })
    const blocks = await loadDocx(bytes)
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph'])
  })

  it('loadXlsx', async () => {
    const bytes = await makeOoxml({
      'xl/sharedStrings.xml': '<sst><si><t>名称</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>',
    })
    const m = await loadXlsx(bytes)
    expect(m.cells.get('0,0')?.text).toBe('名称')
    expect(m.cells.get('0,1')?.text).toBe('42')
  })

  it('loadPptx', async () => {
    const bytes = await makeOoxml({
      'ppt/slides/slide1.xml':
        '<p:sld xmlns:p="x" xmlns:a="y"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>第一页</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    })
    const slides = await loadPptx(bytes)
    expect(slides).toHaveLength(1)
    expect(slides[0].texts[0].text).toBe('第一页')
  })
})
