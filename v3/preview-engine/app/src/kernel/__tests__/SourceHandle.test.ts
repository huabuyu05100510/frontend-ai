import { describe, it, expect } from 'vitest'
import { BlobSource } from '../SourceHandle'

function blob(bytes: number[], type = 'application/octet-stream'): Blob {
  return new Blob([new Uint8Array(bytes)], { type })
}

describe('BlobSource（惰性字节读取）', () => {
  it('size / name 正确', () => {
    const s = new BlobSource(blob([1, 2, 3, 4, 5]), 'a.bin')
    expect(s.size).toBe(5)
    expect(s.name).toBe('a.bin')
  })

  it('从 File 取 name', () => {
    const f = new File([new Uint8Array([0])], 'doc.pdf', { type: 'application/pdf' })
    const s = new BlobSource(f)
    expect(s.name).toBe('doc.pdf')
  })

  it('readHead 截取前 n 字节', async () => {
    const s = new BlobSource(blob([10, 20, 30, 40, 50]))
    const head = await s.readHead(3)
    expect(Array.from(head)).toEqual([10, 20, 30])
  })

  it('readHead 超过文件大小时返回全部', async () => {
    const s = new BlobSource(blob([1, 2]))
    const head = await s.readHead(100)
    expect(Array.from(head)).toEqual([1, 2])
  })

  it('slice 取指定区间', async () => {
    const s = new BlobSource(blob([0, 1, 2, 3, 4, 5, 6, 7]))
    const part = await s.slice(2, 5)
    expect(Array.from(part)).toEqual([2, 3, 4])
  })

  it('text() 解码为字符串', async () => {
    const s = new BlobSource(new Blob(['hello 世界']))
    expect(await s.text()).toBe('hello 世界')
  })

  it('blob() 返回原始 Blob 供原生标签使用', () => {
    const b = blob([1])
    const s = new BlobSource(b)
    expect(s.blob()).toBe(b)
  })

  it('空文件 readHead 返回空', async () => {
    const s = new BlobSource(blob([]))
    expect(s.size).toBe(0)
    expect((await s.readHead(8)).length).toBe(0)
  })
})
