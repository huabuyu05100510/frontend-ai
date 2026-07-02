import { describe, it, expect } from 'vitest'
import { parseCentralDirectory, ZipArchive } from '../zip'

const enc = new TextEncoder()
const u16 = (n: number) => [n & 255, (n >> 8) & 255]
const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw')
  const s = new Response(data as BlobPart).body!.pipeThrough(cs)
  return new Uint8Array(await new Response(s).arrayBuffer())
}

/** 构造一个最小但合法的 ZIP（支持 stored=0 / deflate=8） */
async function makeZip(files: Array<{ name: string; text: string; method?: 0 | 8 }>): Promise<Uint8Array> {
  const locals: number[][] = []
  const centrals: number[][] = []
  let offset = 0
  for (const f of files) {
    const method = f.method ?? 0
    const raw = enc.encode(f.text)
    const data = method === 8 ? await deflateRaw(raw) : raw
    const nameB = enc.encode(f.name)
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(data.length), ...u32(raw.length),
      ...u16(nameB.length), ...u16(0),
      ...nameB, ...Array.from(data),
    ]
    const central = [
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(data.length), ...u32(raw.length),
      ...u16(nameB.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset),
      ...nameB,
    ]
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const cdStart = offset
  const cdBytes = centrals.flat()
  const eocd = [
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(cdBytes.length), ...u32(cdStart), ...u16(0),
  ]
  return new Uint8Array([...locals.flat(), ...cdBytes, ...eocd])
}

describe('parseCentralDirectory', () => {
  it('解析条目名称、方法与尺寸', async () => {
    const zip = await makeZip([
      { name: 'a.xml', text: 'hello', method: 0 },
      { name: 'word/document.xml', text: 'world!!', method: 8 },
    ])
    const entries = parseCentralDirectory(zip)
    expect(entries.map((e) => e.name)).toEqual(['a.xml', 'word/document.xml'])
    expect(entries[0].method).toBe(0)
    expect(entries[1].method).toBe(8)
    expect(entries[0].uncompressedSize).toBe(5)
  })
})

describe('ZipArchive', () => {
  it('读取 stored 条目', async () => {
    const zip = await makeZip([{ name: 'a.txt', text: 'stored-data', method: 0 }])
    const arc = await ZipArchive.open(zip)
    expect(await arc.text('a.txt')).toBe('stored-data')
  })

  it('读取 deflate 条目（解压还原）', async () => {
    const long = 'OOXML '.repeat(50)
    const zip = await makeZip([{ name: 'word/document.xml', text: long, method: 8 }])
    const arc = await ZipArchive.open(zip)
    expect(await arc.text('word/document.xml')).toBe(long)
  })

  it('names() 列出所有条目，has() 判断存在', async () => {
    const zip = await makeZip([
      { name: 'xl/workbook.xml', text: '<x/>' },
      { name: 'xl/sharedStrings.xml', text: '<sst/>' },
    ])
    const arc = await ZipArchive.open(zip)
    expect(arc.names().sort()).toEqual(['xl/sharedStrings.xml', 'xl/workbook.xml'])
    expect(arc.has('xl/workbook.xml')).toBe(true)
    expect(arc.has('nope')).toBe(false)
  })

  it('读取不存在条目抛错', async () => {
    const zip = await makeZip([{ name: 'a', text: 'x' }])
    const arc = await ZipArchive.open(zip)
    await expect(arc.bytes('missing')).rejects.toThrow()
  })
})
