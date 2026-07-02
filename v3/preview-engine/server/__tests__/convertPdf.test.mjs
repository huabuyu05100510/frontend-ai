// TDD: test convertToPdf — LibreOffice 唯一路径，URL 流式返回
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { findSoffice, PDF_CACHE_DIR } from '../convert.mjs'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const sofficeAvailable = findSoffice() !== null

// 生成一个最小有效 OOXML 文件（ZIP 包），LibreOffice 可打开
async function makeMinimalOoxml(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'testooxml-'))
  try {
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(dir, filePath)
      await mkdir(path.dirname(fullPath), { recursive: true })
      writeFileSync(fullPath, content)
    }
    const outPath = path.join(dir, 'out.zip')
    const r = spawnSync('zip', ['-r', outPath, '.'], { cwd: dir, timeout: 10000 })
    if (r.status !== 0) throw new Error('zip failed: ' + r.stderr?.toString())
    return readFileSync(outPath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function makeMinimalDocx() {
  return makeMinimalOoxml({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
    'word/document.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>Hello World</w:t></w:r></w:p></w:body>' +
      '</w:document>',
  })
}

async function makeMinimalXlsx() {
  return makeMinimalOoxml({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>' +
      '</workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>',
    'xl/worksheets/sheet1.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hello</t></is></c></row></sheetData>' +
      '</worksheet>',
  })
}

async function makeMinimalPptx() {
  return makeMinimalOoxml({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
      '</Relationships>',
    'ppt/presentation.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>' +
      '<p:sldSz cx="12192000" cy="6858000"/>' +
      '</p:presentation>',
    'ppt/_rels/presentation.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
      '</Relationships>',
    'ppt/slides/slide1.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      '<p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:cNvSpPr><p:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr>' +
      '<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="10000000" cy="2000000"/></a:xfrm></p:spPr>' +
      '<p:txBody><a:bodyPr/><a:p><a:r><a:t>Hello</a:t></a:r></a:p></p:txBody>' +
      '</p:sp></p:spTree></p:cSld>' +
      '</p:sld>',
  })
}

describe('convertToPdf', () => {

  // ── 错误格式验证 ────────────────────────────────────────────────────────────
  it('returns error for unknown format', async () => {
    const { convertToPdf } = await import('../convert.mjs')
    const result = await convertToPdf(Buffer.from('not a real doc'), 'xyz')
    assert.ok('ok' in result)
    if (!result.ok) {
      assert.ok(typeof result.reason === 'string')
      assert.ok(result.reason.length > 0)
    }
  })

  // ── DOCX → PDF 集成测试 ────────────────────────────────────────────────────
  const docxTest = sofficeAvailable ? it : it.skip
  docxTest('DOCX → PDF via LibreOffice', async () => {
    const { convertToPdf } = await import('../convert.mjs')
    const bytes = await makeMinimalDocx()
    const result = await convertToPdf(bytes, 'docx')
    assert.ok(result.ok, `expected ok, got: ${JSON.stringify(result)}`)
    assert.ok(result.url, 'no url')
    assert.ok(result.url.startsWith('/pdf/'), `unexpected url: ${result.url}`)
    // 验证 PDF 文件存在于磁盘
    const filePath = path.join(PDF_CACHE_DIR, path.basename(result.url))
    const pdfBytes = readFileSync(filePath)
    assert.strictEqual(pdfBytes.slice(0, 4).toString(), '%PDF', 'not a PDF')
    assert.ok(pdfBytes.length > 500, `PDF too small: ${pdfBytes.length}`)
  })

  // ── XLSX → PDF 集成测试 ────────────────────────────────────────────────────
  const xlsxTest = sofficeAvailable ? it : it.skip
  xlsxTest('XLSX → PDF via LibreOffice', async () => {
    const { convertToPdf } = await import('../convert.mjs')
    const bytes = await makeMinimalXlsx()
    const result = await convertToPdf(bytes, 'xlsx')
    assert.ok(result.ok, `expected ok, got: ${JSON.stringify(result)}`)
    assert.ok(result.url, 'no url')
    const filePath = path.join(PDF_CACHE_DIR, path.basename(result.url))
    const pdfBytes = readFileSync(filePath)
    assert.strictEqual(pdfBytes.slice(0, 4).toString(), '%PDF', 'not a PDF')
  })

  // ── PPTX → PDF 集成测试 ────────────────────────────────────────────────────
  const pptxTest = sofficeAvailable ? it : it.skip
  pptxTest('PPTX → PDF via LibreOffice', async () => {
    const { convertToPdf } = await import('../convert.mjs')
    const bytes = await makeMinimalPptx()
    const result = await convertToPdf(bytes, 'pptx')
    assert.ok(result.ok, `expected ok, got: ${JSON.stringify(result)}`)
    assert.ok(result.url, 'no url')
    const filePath = path.join(PDF_CACHE_DIR, path.basename(result.url))
    const pdfBytes = readFileSync(filePath)
    assert.strictEqual(pdfBytes.slice(0, 4).toString(), '%PDF', 'not a PDF')
  })
})