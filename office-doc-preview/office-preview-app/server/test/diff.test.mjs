// 双栏对比 / 智检 — diff 引擎单元测试
// TDD 优先：先写测试，再写实现
// 模型：Claude MiniMax-M3
import { describe, it, expect } from 'vitest'
import { myersDiff, groupByHunk, summarizeErrors, charDiffToRenderTokens, splitParagraphs, myersDiffArray, paragraphDiff } from '../src/diff.mjs'

describe('myersDiff 基础不变式', () => {
  it('两个完全相同的字符串 → 全部 equal', () => {
    const ops = myersDiff('abc', 'abc')
    expect(ops.every(o => o.op === 'equal')).toBe(true)
    expect(ops.map(o => o.text).join('')).toBe('abc')
  })

  it('完全替换：从 a 到 b → 一删一插', () => {
    const ops = myersDiff('a', 'b')
    expect(ops).toEqual([
      { op: 'delete', text: 'a' },
      { op: 'insert', text: 'b' }
    ])
  })

  it('中间替换：abc → axc', () => {
    const ops = myersDiff('abc', 'axc')
    expect(ops).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'delete', text: 'b' },
      { op: 'insert', text: 'x' },
      { op: 'equal', text: 'c' }
    ])
  })

  it('纯插入：左短右长', () => {
    const ops = myersDiff('ac', 'abc')
    expect(ops).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'insert', text: 'b' },
      { op: 'equal', text: 'c' }
    ])
  })

  it('纯删除：左长右短', () => {
    const ops = myersDiff('abc', 'ac')
    expect(ops).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'delete', text: 'b' },
      { op: 'equal', text: 'c' }
    ])
  })

  it('【核心不变式】round-trip：删完等于左，插完等于右', () => {
    const left = 'the quick brown fox'
    const right = 'the slow brown dog'
    const ops = myersDiff(left, right)
    const reconstructedLeft = ops.filter(o => o.op !== 'insert').map(o => o.text).join('')
    const reconstructedRight = ops.filter(o => o.op !== 'delete').map(o => o.text).join('')
    expect(reconstructedLeft).toBe(left)
    expect(reconstructedRight).toBe(right)
  })

  it('空串到非空串：全部 insert', () => {
    const ops = myersDiff('', 'hello')
    expect(ops).toEqual([{ op: 'insert', text: 'hello' }])
  })

  it('非空串到空串：全部 delete', () => {
    const ops = myersDiff('hello', '')
    expect(ops).toEqual([{ op: 'delete', text: 'hello' }])
  })
})

describe('中文友好（智检典型场景）', () => {
  it('设计稿案例：既往开来 → 继往开来', () => {
    const ops = myersDiff('既往开来', '继往开来')
    expect(ops).toEqual([
      { op: 'delete', text: '既' },
      { op: 'insert', text: '继' },
      { op: 'equal', text: '往开来' }
    ])
  })

  it('设计稿案例：湖北省张家界市 → 湖南省张家界（错别字 + 多余字）', () => {
    const ops = myersDiff('湖北省张家界市', '湖南省张家界')
    const reconstructedLeft = ops.filter(o => o.op !== 'insert').map(o => o.text).join('')
    const reconstructedRight = ops.filter(o => o.op !== 'delete').map(o => o.text).join('')
    expect(reconstructedLeft).toBe('湖北省张家界市')
    expect(reconstructedRight).toBe('湖南省张家界')
  })

  it('设计稿案例：权利 → 权力', () => {
    const ops = myersDiff('权利', '权力')
    expect(ops).toEqual([
      { op: 'equal', text: '权' },
      { op: 'delete', text: '利' },
      { op: 'insert', text: '力' }
    ])
  })

  it('设计稿案例：机 → 急（错字）', () => {
    const ops = myersDiff('机不可失', '急不可失')
    expect(ops).toEqual([
      { op: 'delete', text: '机' },
      { op: 'insert', text: '急' },
      { op: 'equal', text: '不可失' }
    ])
  })

  it('Emoji 不丢失（UDM 段落含 emoji）', () => {
    const ops = myersDiff('智检 ✅', '智检 ❌')
    const reconstructedLeft = ops.filter(o => o.op !== 'insert').map(o => o.text).join('')
    const reconstructedRight = ops.filter(o => o.op !== 'delete').map(o => o.text).join('')
    expect(reconstructedLeft).toBe('智检 ✅')
    expect(reconstructedRight).toBe('智检 ❌')
  })

  it('中文标点修正：，。 → ,.', () => {
    const ops = myersDiff('你好，世界。', '你好,世界.')
    const reconstructedLeft = ops.filter(o => o.op !== 'insert').map(o => o.text).join('')
    const reconstructedRight = ops.filter(o => o.op !== 'delete').map(o => o.text).join('')
    expect(reconstructedLeft).toBe('你好，世界。')
    expect(reconstructedRight).toBe('你好,世界.')
  })
})

describe('性能（O(ND) Myers diff）', () => {
  it('100KB 文本 < 200ms（线性增长，不爆炸）', () => {
    const left = '中文字符测试'.repeat(10000)  // 60KB
    const right = left.slice(0, 50000) + '改动' + left.slice(50000)
    const t0 = Date.now()
    const ops = myersDiff(left, right)
    const ms = Date.now() - t0
    expect(ms).toBeLessThan(200)
    // round-trip 仍然成立
    expect(ops.filter(o => o.op !== 'insert').map(o => o.text).join('')).toBe(left)
  })

  it('【压力】两份几乎完全不同的大文本（高 D） < 500ms', () => {
    const left = 'a'.repeat(5000)
    const right = 'b'.repeat(5000)
    const t0 = Date.now()
    const ops = myersDiff(left, right)
    const ms = Date.now() - t0
    expect(ms).toBeLessThan(500)
    expect(ops.length).toBe(2)
    expect(ops[0].op).toBe('delete')
    expect(ops[1].op).toBe('insert')
  })
})

describe('groupByHunk（错误聚类）', () => {
  it('将连续 delete+insert 合并为 1 个错误条目', () => {
    const ops = [
      { op: 'equal', text: '你好' },
      { op: 'delete', text: '既' },
      { op: 'insert', text: '继' },
      { op: 'equal', text: '往开来' }
    ]
    const groups = groupByHunk(ops)
    expect(groups).toEqual([
      { kind: 'equal', text: '你好' },
      { kind: 'change', original: '既', corrected: '继' },
      { kind: 'equal', text: '往开来' }
    ])
  })

  it('纯删除（无对应插入）聚为 1 个 change（corrected=""）', () => {
    const ops = [
      { op: 'equal', text: '权' },
      { op: 'delete', text: '利' },
      { op: 'equal', text: '是好的' }
    ]
    const groups = groupByHunk(ops)
    expect(groups).toEqual([
      { kind: 'equal', text: '权' },
      { kind: 'change', original: '利', corrected: '' },
      { kind: 'equal', text: '是好的' }
    ])
  })

  it('纯插入（无对应删除）聚为 1 个 change（original=""）', () => {
    const ops = [
      { op: 'equal', text: '权' },
      { op: 'insert', text: '力' },
      { op: 'equal', text: '是好的' }
    ]
    const groups = groupByHunk(ops)
    expect(groups).toEqual([
      { kind: 'equal', text: '权' },
      { kind: 'change', original: '', corrected: '力' },
      { kind: 'equal', text: '是好的' }
    ])
  })
})

describe('summarizeErrors（提取错误列表）', () => {
  it('从 diff ops 中抽取所有错误条目（含 ID + 原文 + 改正）', () => {
    const ops = [
      { op: 'equal', text: '权' },
      { op: 'delete', text: '利' },
      { op: 'insert', text: '力' },
      { op: 'equal', text: ' ' },
      { op: 'delete', text: '既' },
      { op: 'insert', text: '继' },
      { op: 'equal', text: '往开来' }
    ]
    const errors = summarizeErrors(ops)
    expect(errors).toHaveLength(2)
    expect(errors[0]).toMatchObject({ id: 'e1', original: '利', corrected: '力' })
    expect(errors[1]).toMatchObject({ id: 'e2', original: '既', corrected: '继' })
  })

  it('无错误时返回空数组', () => {
    const errors = summarizeErrors([{ op: 'equal', text: 'perfect' }])
    expect(errors).toEqual([])
  })
})

describe('charDiffToRenderTokens（前端渲染 token）', () => {
  it('返回带 type 标记的 token 数组，用于 React 渲染高亮', () => {
    const ops = [
      { op: 'equal', text: '权' },
      { op: 'delete', text: '利' },
      { op: 'insert', text: '力' }
    ]
    const tokens = charDiffToRenderTokens(ops)
    expect(tokens).toEqual([
      { type: 'equal', text: '权' },
      { type: 'delete', text: '利' },
      { type: 'insert', text: '力' }
    ])
  })

  it('【契约】type 取值只能是 equal/delete/insert（前端 switch 完备性）', () => {
    const ops = myersDiff('a', 'b')
    const tokens = charDiffToRenderTokens(ops)
    for (const t of tokens) {
      expect(['equal', 'delete', 'insert']).toContain(t.type)
    }
  })
})

describe('splitParagraphs（段落分割）', () => {
  it('单换行文档：每行是一个段落', () => {
    const paras = splitParagraphs('第一段\n第二段\n第三段')
    expect(paras).toEqual(['第一段', '第二段', '第三段'])
  })

  it('双换行文档（正式文档）：按段落分割', () => {
    const text = '第一段\n\n第二段\n\n第三段'
    const paras = splitParagraphs(text)
    expect(paras).toEqual(['第一段', '第二段', '第三段'])
  })

  it('过滤空行', () => {
    const paras = splitParagraphs('  \n段落一\n\n段落二\n  ')
    expect(paras).toContain('段落一')
    expect(paras).toContain('段落二')
    expect(paras.every(p => p.trim().length > 0)).toBe(true)
  })

  it('空字符串返回空数组', () => {
    expect(splitParagraphs('')).toEqual([])
    expect(splitParagraphs(null)).toEqual([])
  })

  it('Windows 换行（\\r\\n）同样支持', () => {
    const paras = splitParagraphs('段落A\r\n段落B\r\n段落C')
    expect(paras).toEqual(['段落A', '段落B', '段落C'])
  })
})

describe('myersDiffArray（段落级 Myers diff）', () => {
  it('相同段落数组 → 全部 equal', () => {
    const A = ['段落一', '段落二']
    const B = ['段落一', '段落二']
    const ops = myersDiffArray(A, B)
    expect(ops.every(o => o.op === 'equal')).toBe(true)
  })

  it('纯插入：空左，有右', () => {
    const ops = myersDiffArray([], ['新段落'])
    expect(ops).toEqual([{ op: 'insert', text: '新段落' }])
  })

  it('纯删除：有左，空右', () => {
    const ops = myersDiffArray(['旧段落'], [])
    expect(ops).toEqual([{ op: 'delete', text: '旧段落' }])
  })

  it('round-trip 不变式：filter 后还原原数组', () => {
    const A = ['第一段', '第二段', '第三段']
    const B = ['第一段', '改后的第二段', '第三段']
    const ops = myersDiffArray(A, B)
    const leftOut = ops.filter(o => o.op !== 'insert').map(o => o.text)
    const rightOut = ops.filter(o => o.op !== 'delete').map(o => o.text)
    expect(leftOut).toEqual(A)
    expect(rightOut).toEqual(B)
  })
})

describe('paragraphDiff（段落级 diff 产生 ParagraphDiffBlock[]）', () => {
  it('相同文本 → 全部 equal block', () => {
    const blocks = paragraphDiff('段落一\n段落二', '段落一\n段落二')
    expect(blocks.every(b => b.kind === 'equal')).toBe(true)
    expect(blocks.length).toBeGreaterThan(0)
  })

  it('一段变化 → 产生 change block，含 charOps', () => {
    const blocks = paragraphDiff('权利 既往开来', '权力 继往开来')
    // 只有一个段落（无换行），应该是一个 change block
    expect(blocks.length).toBe(1)
    expect(blocks[0].kind).toBe('change')
    expect(blocks[0].charOps).toBeTruthy()
    expect(blocks[0].leftText).toBe('权利 既往开来')
    expect(blocks[0].rightText).toBe('权力 继往开来')
  })

  it('新增段落 → insert block', () => {
    const blocks = paragraphDiff('段落A', '段落A\n新增段落')
    expect(blocks.some(b => b.kind === 'insert')).toBe(true)
    const ins = blocks.find(b => b.kind === 'insert')
    expect(ins.rightText).toBe('新增段落')
    expect(ins.leftText).toBe('')
  })

  it('删除段落 → delete block', () => {
    const blocks = paragraphDiff('段落A\n被删段落', '段落A')
    expect(blocks.some(b => b.kind === 'delete')).toBe(true)
    const del = blocks.find(b => b.kind === 'delete')
    expect(del.leftText).toBe('被删段落')
    expect(del.rightText).toBe('')
  })

  it('空字符串 → 空 blocks', () => {
    expect(paragraphDiff('', '')).toEqual([])
  })

  it('charOps round-trip：delete→左还原，insert→右还原', () => {
    const blocks = paragraphDiff('湖北省张家界市', '湖南省张家界')
    const changeBlock = blocks.find(b => b.kind === 'change')
    expect(changeBlock).toBeTruthy()
    const leftRecon = changeBlock.charOps.filter(o => o.op !== 'insert').map(o => o.text).join('')
    const rightRecon = changeBlock.charOps.filter(o => o.op !== 'delete').map(o => o.text).join('')
    expect(leftRecon).toBe('湖北省张家界市')
    expect(rightRecon).toBe('湖南省张家界')
  })
})
