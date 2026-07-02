// translate.mjs — identity mock 真实文本提取（v4.1.1）
// 模型：claude-sonnet-4-6
//
// v4.0 bug：task.pages[i] 没有 text 字段（实际数据中只有 url/textUrl/textWords/bytes/width/height）
//           → buildIdentityPagesFromTask 拿不到真实文本
//           → sourceText='' 导致 v6 文字层 per-char spans 全失效
// v4.1.1 修复：当 p.text 缺失时，从 task.textDir/page-NNN.html 读 v4 文字层 strip 标签
//
// 验证：
//   1. textDir 存在 + page-001.html 有内容 → 自动提取该页文本
//   2. textDir 不存在 → 降级 sourceText=''
//   3. textDir 存在但 page 文件缺失 → 降级 sourceText=''
//   4. 提取后的文本用于 charMap 长度计算（per-char）

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { buildIdentityPagesFromTask } from '../src/translate.mjs'

function makePage({ idx = 1, width = 794, height = 1123, text = null } = {}) {
  return {
    page: idx,
    url: `/api/files/task-test?as=page&n=${idx}`,
    textUrl: `/api/files/task-test?as=text&n=${idx}`,
    textWords: text ? text.length : 0,
    bytes: 1024,
    width,
    height,
    ...(text ? { text } : {}),  // v4.0 fixture: 有 text 字段
  }
}

let tmpDir
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-identity-textdir-'))
})
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

describe('buildIdentityPagesFromTask v4.1.1 — textDir fallback 文本提取', () => {
  it('1. textDir 不存在 → 降级 sourceText=""（保持向后兼容）', () => {
    const task = {
      id: 'task-test', ext: 'docx', previewExt: 'docx',
      pages: [makePage({ idx: 1 })],  // 无 text 字段
    }
    const pages = buildIdentityPagesFromTask(task, 'en')
    expect(pages[0].sourceText).toBe('')
    expect(pages[0].charMap).toEqual([])
  })

  it('2. textDir 存在 + page-001.html 有 v4 文字层 → 提取真实文本', () => {
    // 模拟 v4 文字层：每个 span 一个 PDFium run
    const html = '<div class="pdf-text-layer" data-pdfium="4" data-page-w="991" data-page-h="1401">' +
      '<span style="position:absolute;left:100px;top:100px">郭亚平</span>' +
      '<span style="position:absolute;left:200px;top:150px">求职岗位</span>' +
      '<span style="position:absolute;left:300px;top:200px">前端工程师</span>' +
      '</div>'
    const textDir = path.join(tmpDir, 'text')
    fs.mkdirSync(textDir, { recursive: true })
    fs.writeFileSync(path.join(textDir, 'page-001.html'), html, 'utf-8')

    const task = {
      id: 'task-test', ext: 'docx', previewExt: 'docx',
      textDir,
      pages: [makePage({ idx: 1 })],
    }
    const pages = buildIdentityPagesFromTask(task, 'en')
    // 顺序拼接每个 span 的 str（中间不加空格，与 charMap 字符数对应）
    expect(pages[0].sourceText).toBe('郭亚平求职岗位前端工程师')
    expect(pages[0].targetText).toBe('郭亚平求职岗位前端工程师')  // identity
  })

  it('3. 多页 + textDir → 每页独立提取', () => {
    const textDir = path.join(tmpDir, 'text')
    fs.mkdirSync(textDir, { recursive: true })
    fs.writeFileSync(path.join(textDir, 'page-001.html'),
      '<div class="pdf-text-layer"><span>第一页</span></div>', 'utf-8')
    fs.writeFileSync(path.join(textDir, 'page-002.html'),
      '<div class="pdf-text-layer"><span>第二页内容</span></div>', 'utf-8')

    const task = {
      id: 'task-test', ext: 'docx', previewExt: 'docx',
      textDir,
      pages: [makePage({ idx: 1 }), makePage({ idx: 2 })],
    }
    const pages = buildIdentityPagesFromTask(task, 'en')
    expect(pages).toHaveLength(2)
    expect(pages[0].sourceText).toBe('第一页')
    expect(pages[1].sourceText).toBe('第二页内容')
  })

  it('4. charMap 长度 = sourceText 字符数（per-char 粒度）', () => {
    const textDir = path.join(tmpDir, 'text')
    fs.mkdirSync(textDir, { recursive: true })
    fs.writeFileSync(path.join(textDir, 'page-001.html'),
      '<div class="pdf-text-layer"><span>你好世界</span></div>', 'utf-8')  // 4 chars

    const task = {
      id: 'task-test', ext: 'docx', previewExt: 'docx',
      textDir,
      pages: [makePage({ idx: 1 })],
    }
    const pages = buildIdentityPagesFromTask(task, 'en')
    expect(pages[0].charMap).toHaveLength(4)
    expect(pages[0].charMap[0]).toEqual({ srcStart: 0, srcEnd: 1, tgtStart: 0, tgtEnd: 1 })
    expect(pages[0].charMap[3]).toEqual({ srcStart: 3, srcEnd: 4, tgtStart: 3, tgtEnd: 4 })
  })

  it('5. textDir 存在但 page-001.html 缺失 → 降级 sourceText=""', () => {
    const textDir = path.join(tmpDir, 'text')
    fs.mkdirSync(textDir, { recursive: true })
    // 不写 page-001.html
    const task = {
      id: 'task-test', ext: 'docx', previewExt: 'docx',
      textDir,
      pages: [makePage({ idx: 1 })],
    }
    const pages = buildIdentityPagesFromTask(task, 'en')
    expect(pages[0].sourceText).toBe('')
    expect(pages[0].charMap).toEqual([])
  })

  it('6. page text 字段优先于 textDir（fixture 兼容）', () => {
    const textDir = path.join(tmpDir, 'text')
    fs.mkdirSync(textDir, { recursive: true })
    fs.writeFileSync(path.join(textDir, 'page-001.html'),
      '<div class="pdf-text-layer"><span>从textDir来的</span></div>', 'utf-8')

    const task = {
      id: 'task-test', ext: 'docx', previewExt: 'docx',
      textDir,
      pages: [makePage({ idx: 1, text: 'p.text 优先' })],
    }
    const pages = buildIdentityPagesFromTask(task, 'en')
    // p.text 字段存在则优先用，忽略 textDir
    expect(pages[0].sourceText).toBe('p.text 优先')
  })
})
