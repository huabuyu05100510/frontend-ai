import { describe, it, expect } from 'vitest'
import { PageDataAPI } from '../pipeline/PageDataAPI'

const api = new PageDataAPI()

describe('PageDataAPI.getPage', () => {
  it('返回正确 naturalWidth / naturalHeight', () => {
    const page = api.getPage('invoice', 1)
    expect(page.naturalWidth).toBe(595)
    expect(page.naturalHeight).toBe(842)
  })

  it('每个 block 都有正值 bbox', () => {
    const page = api.getPage('invoice', 1)
    for (const block of page.blocks) {
      expect(block.bbox.w).toBeGreaterThan(0)
      expect(block.bbox.h).toBeGreaterThan(0)
    }
  })

  it('formula / image 类型的 block 不含 translation 字段', () => {
    const page = api.getPage('tech-doc', 1)
    for (const block of page.blocks) {
      if (block.type === 'formula' || block.type === 'image') {
        expect(block.translation).toBeUndefined()
      }
    }
  })

  it('blocks 数量大于 0', () => {
    const page = api.getPage('article', 1)
    expect(page.blocks.length).toBeGreaterThan(0)
  })

  it('所有 block.id 在同一页内唯一', () => {
    const page = api.getPage('invoice', 1)
    const ids = page.blocks.map(b => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('PageDataAPI.streamDocument', () => {
  it('最后一个事件是 DOC_COMPLETE', async () => {
    const events = []
    for await (const event of api.streamDocument('invoice')) {
      events.push(event)
    }
    expect(events.at(-1)?.type).toBe('DOC_COMPLETE')
  })

  it('PAGE_READY 事件按 pageNum 升序', async () => {
    const pageNums: number[] = []
    for await (const event of api.streamDocument('invoice')) {
      if (event.type === 'PAGE_READY') {
        pageNums.push(event.data.pageNum)
      }
    }
    expect(pageNums.length).toBeGreaterThan(0)
    for (let i = 1; i < pageNums.length; i++) {
      expect(pageNums[i]).toBeGreaterThan(pageNums[i - 1])
    }
  })

  it('DOC_COMPLETE.totalPages 与 PAGE_READY 数量一致', async () => {
    const events = []
    for await (const event of api.streamDocument('tech-doc')) {
      events.push(event)
    }
    const pageReadyCount = events.filter(e => e.type === 'PAGE_READY').length
    const complete = events.find(e => e.type === 'DOC_COMPLETE')
    expect(complete?.totalPages).toBe(pageReadyCount)
  })
})
