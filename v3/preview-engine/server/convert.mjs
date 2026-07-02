// ============================================================================
// convert — Office 文档转换
//   LibreOffice 唯一路径：docx/xlsx/pptx/doc/xls/ppt → PDF（100% 高保真）
//   无 LibreOffice 时返回明确错误 + 安装指引。
// ============================================================================

import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import { mkdirSync, statSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseXls } from './xlsLegacy.mjs'

const TARGET = { xls: 'xlsx', doc: 'docx', ppt: 'pptx' }
const CANDIDATES = ['soffice', 'libreoffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice']

// PDF 缓存目录（供 /pdf/:id 端点流式服务，支持 Range 请求）
const PDF_CACHE_DIR = path.join(os.tmpdir(), 'pdf-cache')
mkdirSync(PDF_CACHE_DIR, { recursive: true })

function cleanupOldPdfs() {
  try {
    const now = Date.now()
    const ttl = 30 * 60 * 1000 // 30 分钟
    for (const f of readdirSync(PDF_CACHE_DIR)) {
      try {
        const fp = path.join(PDF_CACHE_DIR, f)
        if (now - statSync(fp).mtimeMs > ttl) rmSync(fp)
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
}

export { PDF_CACHE_DIR }

export function findSoffice() {
  for (const c of CANDIDATES) {
    try {
      const r = spawnSync(c, ['--version'], { timeout: 5000 })
      if (r.status === 0) return c
    } catch {
      // 忽略，试下一个
    }
  }
  return null
}

export function convertWithSoffice(bin, bytes, ext) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cvt-'))
  try {
    const inFile = path.join(dir, 'in.' + ext)
    writeFileSync(inFile, Buffer.from(bytes))
    const target = TARGET[ext]
    const r = spawnSync(bin, ['--headless', '--convert-to', target, '--outdir', dir, inFile], { timeout: 60000 })
    if (r.status !== 0) throw new Error('LibreOffice 转换失败: ' + (r.stderr ? r.stderr.toString() : ''))
    const out = readdirSync(dir).find((f) => f.endsWith('.' + target))
    if (!out) throw new Error('LibreOffice 未产出目标文件')
    const data = readFileSync(path.join(dir, out))
    return { realType: target, base64: data.toString('base64') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 任意 Office 文档 → PDF（保存到缓存文件，返回 URL 供流式加载） */
export async function convertToPdf(bytes, ext) {
  const e = (ext || '').toLowerCase()
  const soffice = findSoffice()
  if (!soffice) {
    return {
      ok: false,
      reason: '高保真 PDF 转换需要 LibreOffice（本机未安装）。',
      install: 'brew install --cask libreoffice',
    }
  }
  try {
    cleanupOldPdfs()
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cvt-'))
    try {
      const inFile = path.join(dir, 'in.' + e)
      writeFileSync(inFile, Buffer.from(bytes))
      const r = spawnSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', dir, inFile], { timeout: 120000 })
      if (r.status !== 0) {
        return { ok: false, reason: `LibreOffice 转换失败：${r.stderr?.toString() || '未知错误'}` }
      }
      const out = readdirSync(dir).find((f) => f.endsWith('.pdf'))
      if (!out) {
        return { ok: false, reason: 'LibreOffice 未产出 PDF 文件' }
      }
      const pdfBuf = readFileSync(path.join(dir, out))
      const id = crypto.randomUUID()
      writeFileSync(path.join(PDF_CACHE_DIR, `${id}.pdf`), pdfBuf)
      return { ok: true, url: `/pdf/${id}.pdf` }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  } catch (err) {
    return { ok: false, reason: `PDF 转换失败：${String(err?.message ?? err)}` }
  }
}

/** 转换分发：返回结构化结果（ooxml 字节 base64 / 直接 sheet model / 不支持） */
export function convertLegacy(bytes, ext) {
  const e = (ext || '').toLowerCase()
  if (!TARGET[e]) return { ok: false, reason: `不支持的旧格式：.${e}` }

  const soffice = findSoffice()
  if (soffice) {
    const { realType, base64 } = convertWithSoffice(soffice, bytes, e)
    return { ok: true, format: 'ooxml', realType, base64, via: 'libreoffice' }
  }
  if (e === 'xls') {
    const model = parseXls(bytes)
    return { ok: true, format: 'model', kind: 'sheet', model, via: 'builtin-biff' }
  }
  return {
    ok: false,
    reason: `.${e} 为旧版二进制（CFB），高保真转换需服务端 LibreOffice（本机未安装）。`,
    install: 'brew install --cask libreoffice',
  }
}