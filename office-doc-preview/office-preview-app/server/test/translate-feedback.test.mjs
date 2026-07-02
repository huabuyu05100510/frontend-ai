// server/test/translate-feedback.test.mjs
// 模型：claude-sonnet-4-6
// Phase B.1: translate-feedback 模块 + retranslate 端点 + translate() 扩展
//
// 覆盖：
//   - loadAnnotations: 读 JSONL + 过滤已删除 + 损坏行容错
//   - extractAltTgt / extractSegmentId: 字段防御式提取
//   - mergeGlossaryWithFeedback: alt_trans → glossary 合并 + 去重
//   - collectRetargetSegments: seg_rating<3 → segmentId 集合
//   - summarizeAnnotations: 统计 altTrans / segRatingLow / alignFix

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { CONFIG } from '../src/config.mjs'

let tmpDir

beforeEach(() => {
  // 临时重写 DERIVED_DIR 以隔离每个测试
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-fb-'))
  CONFIG.DERIVED_DIR = tmpDir
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

const {
  loadAnnotations,
  extractAltTgt,
  extractSegmentId,
  mergeGlossaryWithFeedback,
  collectRetargetSegments,
  summarizeAnnotations,
} = await import('../src/translate-feedback.mjs')

function makeAnno(overrides) {
  return {
    id: 'a_' + Math.random().toString(36).slice(2, 8),
    kind: 'alt_trans',
    taskId: 't_x',
    srcSegmentId: 'seg:p1s0',
    srcText: '前端工程师',
    tgtText: 'frontend developer',
    payload: { altTgt: 'Front-End Engineer' },
    createdAt: Date.now(),
    removed: false,
    ...overrides,
  }
}

function writeJsonl(taskId, items) {
  const dir = path.join(tmpDir, 'translate-annotations')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${taskId}.jsonl`)
  const lines = items.map((it) => JSON.stringify(it)).join('\n')
  fs.writeFileSync(file, lines + '\n', 'utf8')
}

describe('loadAnnotations', () => {
  it('空文件：返回空数组', () => {
    writeJsonl('t_empty', [])
    expect(loadAnnotations('t_empty')).toEqual([])
  })

  it('文件不存在：返回空数组', () => {
    expect(loadAnnotations('t_nonexistent')).toEqual([])
  })

  it('正常 JSONL：返回所有未删除项', () => {
    const items = [makeAnno({ id: 'a1' }), makeAnno({ id: 'a2' })]
    writeJsonl('t1', items)
    const out = loadAnnotations('t1')
    expect(out.length).toBe(2)
    expect(out[0].id).toBe('a1')
    expect(out[1].id).toBe('a2')
  })

  it('损坏行：跳过不抛错', () => {
    const dir = path.join(tmpDir, 'translate-annotations')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 't_bad.jsonl')
    fs.writeFileSync(
      file,
      JSON.stringify(makeAnno({ id: 'a1' })) + '\n' +
      '{not valid json\n' +
      JSON.stringify(makeAnno({ id: 'a2' })) + '\n',
      'utf8',
    )
    const out = loadAnnotations('t_bad')
    expect(out.length).toBe(2)
  })

  it('removed:true 字段被过滤', () => {
    const items = [makeAnno({ id: 'a1' }), makeAnno({ id: 'a2', removed: true })]
    writeJsonl('t_rm', items)
    const out = loadAnnotations('t_rm')
    expect(out.length).toBe(1)
    expect(out[0].id).toBe('a1')
  })
})

describe('extractAltTgt / extractSegmentId', () => {
  it('extractAltTgt：优先 payload.altTgt', () => {
    const a = makeAnno({ payload: { altTgt: 'from-payload' }, tgtText: 'from-tgt' })
    expect(extractAltTgt(a)).toBe('from-payload')
  })
  it('extractAltTgt：fallback 到 tgtText', () => {
    const a = makeAnno({ payload: {}, tgtText: 'from-tgt' })
    expect(extractAltTgt(a)).toBe('from-tgt')
  })
  it('extractAltTgt：fallback 到 payload.text', () => {
    const a = makeAnno({ payload: { text: 'from-text' }, tgtText: '' })
    expect(extractAltTgt(a)).toBe('from-text')
  })
  it('extractAltTgt：全部为空 → null', () => {
    const a = makeAnno({ payload: {}, tgtText: '' })
    expect(extractAltTgt(a)).toBe(null)
  })
  it('extractSegmentId：优先 srcSegmentId', () => {
    expect(extractSegmentId(makeAnno({ srcSegmentId: 'p1', domPath: 'p2' }))).toBe('p1')
  })
  it('extractSegmentId：fallback 到 domPath', () => {
    expect(extractSegmentId(makeAnno({ srcSegmentId: null, domPath: 'p2' }))).toBe('p2')
  })
})

describe('mergeGlossaryWithFeedback', () => {
  it('空 feedback → 保持原 glossary', () => {
    const g = [{ source: 'a', target: 'A' }]
    expect(mergeGlossaryWithFeedback(g, [])).toEqual([{ source: 'a', target: 'A' }])
  })
  it('alt_trans → 追加到 glossary', () => {
    const g = [{ source: 'a', target: 'A' }]
    const fb = [makeAnno({ srcText: 'x', payload: { altTgt: 'X' } })]
    const out = mergeGlossaryWithFeedback(g, fb)
    expect(out.length).toBe(2)
    expect(out[1]).toEqual({ source: 'x', target: 'X' })
  })
  it('非 alt_trans → 忽略', () => {
    const g = [{ source: 'a', target: 'A' }]
    const fb = [makeAnno({ kind: 'seg_rating', srcText: 'x', payload: { rating: 1 } })]
    const out = mergeGlossaryWithFeedback(g, fb)
    expect(out.length).toBe(1)
  })
  it('altTgt 为空 → 忽略', () => {
    const g = [{ source: 'a', target: 'A' }]
    const fb = [makeAnno({ srcText: 'x', payload: { altTgt: '' }, tgtText: '' })]
    const out = mergeGlossaryWithFeedback(g, fb)
    expect(out.length).toBe(1)
  })
  it('srcText 为空 → 忽略', () => {
    const g = [{ source: 'a', target: 'A' }]
    const fb = [makeAnno({ srcText: '', payload: { altTgt: 'X' } })]
    const out = mergeGlossaryWithFeedback(g, fb)
    expect(out.length).toBe(1)
  })
  it('alt_trans source 重复 → 后写覆盖（last-write-wins）', () => {
    const g = [{ source: 'a', target: 'A' }]
    const fb = [
      makeAnno({ id: 'a1', srcText: 'a', payload: { altTgt: 'A1' } }),
      makeAnno({ id: 'a2', srcText: 'a', payload: { altTgt: 'A2' } }),
    ]
    const out = mergeGlossaryWithFeedback(g, fb)
    expect(out.length).toBe(1)
    expect(out[0].target).toBe('A2')
  })
})

describe('collectRetargetSegments', () => {
  it('seg_rating<3 → 收集 srcSegmentId', () => {
    const fb = [
      makeAnno({ kind: 'seg_rating', srcSegmentId: 'p1s0', payload: { rating: 1 } }),
      makeAnno({ kind: 'seg_rating', srcSegmentId: 'p1s1', payload: { rating: 3 } }),
      makeAnno({ kind: 'seg_rating', srcSegmentId: 'p1s2', payload: { rating: 2 } }),
    ]
    const set = collectRetargetSegments(fb)
    expect([...set].sort()).toEqual(['p1s0', 'p1s2'])
  })
  it('其他 kind 忽略', () => {
    const fb = [makeAnno({ kind: 'alt_trans' })]
    expect(collectRetargetSegments(fb).size).toBe(0)
  })
})

describe('summarizeAnnotations', () => {
  it('正确统计 3 种 kind', () => {
    const fb = [
      makeAnno({ kind: 'alt_trans' }),
      makeAnno({ kind: 'alt_trans' }),
      makeAnno({ kind: 'seg_rating', payload: { rating: 1 } }),
      makeAnno({ kind: 'align_fix' }),
    ]
    const s = summarizeAnnotations(fb)
    expect(s.altTrans).toBe(2)
    expect(s.segRatingLow).toBe(1)
    expect(s.alignFix).toBe(1)
  })
})
