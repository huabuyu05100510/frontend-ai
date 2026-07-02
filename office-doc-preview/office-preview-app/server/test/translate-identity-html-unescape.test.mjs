// translate.mjs — identity mock HTML 实体解码测试（v4.1.2）
// 模型：claude-sonnet-4-6
//
// v4.1.1 bug：readPageTextFromTextDir 提取的是 HTML 原文（含 &lt; &gt; &amp; 等）
//           → 与 PDFium 提取的 run.str（已解码）不匹配
//           → buildFullDocTextLayer 退化为 runToSpan（无 per-char idx）
// v4.1.2 修复：提取后做 HTML 实体解码

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { buildIdentityPagesFromTask } from '../src/translate.mjs'

let tmpDir
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-identity-html-'))
})
afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

describe('buildIdentityPagesFromTask v4.1.2 — HTML 实体解码', () => {
  it('1. textDir 里的 &lt; 应当解码为 <（与 PDFium run.str 对齐）', () => {
    const html = '<div class="pdf-text-layer">' +
      '<span>负责性能优化，确保关键页面90分位FCP&lt;1000ms</span>' +
      '<span>，LCP&lt;2000ms</span>' +
      '</div>'
    const textDir = path.join(tmpDir, 'text')
    fs.mkdirSync(textDir, { recursive: true })
    fs.writeFileSync(path.join(textDir, 'page-001.html'), html, 'utf-8')

    const task = {
      id: 'task-test', ext: 'docx', previewExt: 'docx',
      textDir,
      pages: [{ page: 1, width: 991, height: 1401 }],
    }
    const pages = buildIdentityPagesFromTask(task, 'en')
    // 解码后 &lt; → <，这样与 PDFium 提的 run.str 匹配
    expect(pages[0].sourceText).toBe('负责性能优化，确保关键页面90分位FCP<1000ms，LCP<2000ms')
  })

  it('2. textDir 里的 &amp; &gt; &quot; 全部解码', () => {
    const html = '<div class="pdf-text-layer">' +
      '<span>AT&amp;T</span>' +
      '<span>5 &gt; 3</span>' +
      '<span>他说&quot;你好&quot;</span>' +
      '</div>'
    const textDir = path.join(tmpDir, 'text')
    fs.mkdirSync(textDir, { recursive: true })
    fs.writeFileSync(path.join(textDir, 'page-001.html'), html, 'utf-8')

    const task = {
      id: 'task-test', ext: 'docx', previewExt: 'docx',
      textDir,
      pages: [{ page: 1, width: 991, height: 1401 }],
    }
    const pages = buildIdentityPagesFromTask(task, 'en')
    expect(pages[0].sourceText).toBe('AT&T5 > 3他说"你好"')
  })

  it('3. 没有 HTML 实体的文本应原样返回', () => {
    const html = '<div class="pdf-text-layer"><span>郭亚平</span><span>前端工程师</span></div>'
    const textDir = path.join(tmpDir, 'text')
    fs.mkdirSync(textDir, { recursive: true })
    fs.writeFileSync(path.join(textDir, 'page-001.html'), html, 'utf-8')

    const task = {
      id: 'task-test', ext: 'docx', previewExt: 'docx',
      textDir,
      pages: [{ page: 1, width: 991, height: 1401 }],
    }
    const pages = buildIdentityPagesFromTask(task, 'en')
    expect(pages[0].sourceText).toBe('郭亚平前端工程师')
  })
})
