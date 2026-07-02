import { PDFiumLibrary } from '@hyzyla/pdfium'
import fs from 'fs'

async function main() {
  console.log('Init WASM...')
  const lib = await PDFiumLibrary.init()
  console.log('Load PDF...')
  const buf = fs.readFileSync('/tmp/wasm-test.pdf')
  const doc = await lib.loadDocument(new Uint8Array(buf))
  console.log(`pages: ${doc.getPageCount()}`)
  console.log('Render page 1...')
  const page = doc.getPage(0)
  console.log(`page size: ${page.width} x ${page.height}`)
  const result = await page.render({ scale: 1.5 })
  console.log(`result: width=${result.width}, height=${result.height}, dataLen=${result.data?.length}`)
  const nonZero = result.data?.filter(b => b !== 0).length || 0
  console.log(`nonZero bytes: ${nonZero} / ${result.data?.length} (${(nonZero / (result.data?.length || 1) * 100).toFixed(1)}%)`)
  doc.destroy()
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
