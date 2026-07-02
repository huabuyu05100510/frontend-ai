// 生成最小合法 3 页 PDF fixture（手写 PDF 1.4，无外部依赖）
// 每页含可见英文文字："Page One" / "Page Two" / "Page Three"
import fs from 'node:fs'
import path from 'node:path'

function build3PagePdf() {
  // 简化的固定版本 PDF：3 页，每页一段英文
  // 用纯 ASCII 文本确保跨 pdftotext 版本兼容
  const pages = ['Page One', 'Page Two', 'Page Three']
  const objs = []
  const offsets = []
  let body = '%PDF-1.4\n'

  function addObj(content) {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${objs.length + 1} 0 obj\n${content}\nendobj\n`
    objs.push(true)
    return objs.length
  }

  // 占位 catalog 跑一次（得到正确 offset）
  addObj('<< /Type /Catalog /Pages 2 0 R >>')
  // 重置 body 起始位置
  body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const positions = []
  let pos = Buffer.byteLength(body, 'latin1')

  function realAddObj(id, content) {
    positions[id - 1] = pos
    const chunk = `${id} 0 obj\n${content}\nendobj\n`
    body += chunk
    pos += Buffer.byteLength(chunk, 'latin1')
  }

  realAddObj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  realAddObj(2, '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>')

  // page 1
  realAddObj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 9 0 R >> >> >>')
  const c1 = `BT /F1 12 Tf 100 700 Td (${pages[0]}) Tj ET`
  realAddObj(4, `<< /Length ${c1.length} >>\nstream\n${c1}\nendstream`)
  // page 2
  realAddObj(5, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 9 0 R >> >> >>')
  const c2 = `BT /F1 12 Tf 100 700 Td (${pages[1]}) Tj ET`
  realAddObj(6, `<< /Length ${c2.length} >>\nstream\n${c2}\nendstream`)
  // page 3
  realAddObj(7, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 8 0 R /Resources << /Font << /F1 9 0 R >> >> >>')
  const c3 = `BT /F1 12 Tf 100 700 Td (${pages[2]}) Tj ET`
  realAddObj(8, `<< /Length ${c3.length} >>\nstream\n${c3}\nendstream`)
  // font
  realAddObj(9, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  const xrefOffset = pos
  body += 'xref\n0 10\n'
  body += '0000000000 65535 f \n'
  for (let i = 0; i < 9; i++) {
    body += String(positions[i]).padStart(10, '0') + ' 00000 n \n'
  }
  body += `trailer\n<< /Size 10 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  return Buffer.from(body, 'latin1')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2]
  if (!out) {
    console.error('usage: node build-fixture.mjs <out.pdf>')
    process.exit(1)
  }
  fs.writeFileSync(out, build3PagePdf())
  console.log('wrote', out, fs.statSync(out).size, 'bytes')
}

export { build3PagePdf }