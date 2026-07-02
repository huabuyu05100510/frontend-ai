// 生成真实样例文件（docx/xlsx/pptx/xls）到 ../samples，供拖入 demo 验证全链路。
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', 'samples')
mkdirSync(OUT, { recursive: true })

const enc = new TextEncoder()
const u16 = (n) => [n & 255, (n >> 8) & 255]
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]

async function deflateRaw(data) {
  const cs = new CompressionStream('deflate-raw')
  const s = new Response(data).body.pipeThrough(cs)
  return new Uint8Array(await new Response(s).arrayBuffer())
}

async function makeZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const f of files) {
    const raw = f.bytes instanceof Uint8Array ? f.bytes : enc.encode(f.text)
    const data = await deflateRaw(raw)
    const nameB = enc.encode(f.name)
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0), ...u32(0),
      ...u32(data.length), ...u32(raw.length), ...u16(nameB.length), ...u16(0), ...nameB, ...data,
    ]
    const central = [
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0), ...u32(0),
      ...u32(data.length), ...u32(raw.length), ...u16(nameB.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameB,
    ]
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const cd = centrals.flat()
  const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cd.length), ...u32(offset), ...u16(0)]
  return new Uint8Array([...locals.flat(), ...cd, ...eocd])
}

// ---- PNG（纯色，zlib 真压缩）----
const CRC = (() => {
  const t = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function makePng(w, h, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  const raw = Buffer.alloc(h * (1 + w * 3))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0 // filter none
    for (let x = 0; x < w; x++) {
      const o = y * (1 + w * 3) + 1 + x * 3
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
    }
  }
  return new Uint8Array(Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

const CT = (parts) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Default Extension="png" ContentType="image/png"/>${parts}</Types>`

// ---------------- DOCX（标题/对齐/表格/图片）----------------
async function genDocx() {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  const NS =
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  const drawing =
    '<w:r><w:drawing><wp:inline><wp:extent cx="2400000" cy="800000"/>' +
    '<a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:blipFill><a:blip r:embed="rId1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>' +
    '</wp:inline></w:drawing></w:r>'
  const doc =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W} ${NS}><w:body>` +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>预览引擎样例文档</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>这一段居中对齐。苹果 香蕉 橙子。</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>这一段右对齐。</w:t></w:r></w:p>' +
    '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>加粗</w:t></w:r><w:r><w:t> 普通 </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>斜体</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' + drawing + '</w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>名称</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>数量</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>苹果</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '</w:body></w:document>'
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>'
  const ct = CT('<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>')
  const pkgRels =
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  const zip = await makeZip([
    { name: '[Content_Types].xml', text: ct },
    { name: '_rels/.rels', text: pkgRels },
    { name: 'word/document.xml', text: doc },
    { name: 'word/_rels/document.xml.rels', text: rels },
    { name: 'word/media/image1.png', bytes: makePng(240, 80, [70, 130, 220]) },
  ])
  writeFileSync(path.join(OUT, 'sample.docx'), zip)
}

// ---------------- XLSX ----------------
async function genXlsx() {
  const sst = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5"><si><t>名称</t></si><si><t>数量</t></si><si><t>苹果</t></si><si><t>香蕉</t></si><si><t>橙子</t></si></sst>`
  const sheet =
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
    `<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>3</v></c></row>` +
    `<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>12</v></c></row>` +
    `<row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4"><v>7</v></c></row>` +
    `</sheetData></worksheet>`
  const wb = `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="水果" sheetId="1" r:id="rId1"/></sheets></workbook>`
  const ct = CT(
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
  )
  const zip = await makeZip([
    { name: '[Content_Types].xml', text: ct },
    { name: 'xl/workbook.xml', text: wb },
    { name: 'xl/sharedStrings.xml', text: sst },
    { name: 'xl/worksheets/sheet1.xml', text: sheet },
  ])
  writeFileSync(path.join(OUT, 'sample.xlsx'), zip)
}

// ---------------- PPTX ----------------
async function genPptx() {
  const sld = (texts) =>
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>` +
    texts
      .map(
        (t) =>
          `<p:sp><p:spPr><a:xfrm><a:off x="${t.x}" y="${t.y}"/><a:ext cx="6000000" cy="800000"/></a:xfrm></p:spPr>` +
          `<p:txBody><a:p><a:r><a:t>${t.s}</a:t></a:r></a:p></p:txBody></p:sp>`,
      )
      .join('') +
    `</p:spTree></p:cSld></p:sld>`
  const ct = CT(
    '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' +
      '<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>',
  )
  const zip = await makeZip([
    { name: '[Content_Types].xml', text: ct },
    { name: 'ppt/slides/slide1.xml', text: sld([{ s: '第一页标题', x: 500000, y: 400000 }, { s: '你好 世界', x: 500000, y: 1600000 }]) },
    { name: 'ppt/slides/slide2.xml', text: sld([{ s: '第二页：苹果 香蕉 橙子', x: 500000, y: 400000 }]) },
  ])
  writeFileSync(path.join(OUT, 'sample.pptx'), zip)
}

// ---------------- XLS（真实 CFB + BIFF8）----------------
function writeDirEntry(b, off, name, type, start, size) {
  for (let i = 0; i < name.length; i++) b.writeUInt16LE(name.charCodeAt(i), off + i * 2)
  b.writeUInt16LE((name.length + 1) * 2, off + 64)
  b[off + 66] = type
  b.writeUInt32LE(start, off + 116)
  b.writeUInt32LE(size, off + 120)
}
function buildCfb(streamName, data) {
  const b = Buffer.alloc(512 + 4 * 512, 0)
  ;[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((v, i) => (b[i] = v))
  b.writeUInt16LE(0x0003, 26)
  b.writeUInt16LE(9, 30)
  b.writeUInt16LE(6, 32)
  b.writeUInt32LE(1, 44)
  b.writeUInt32LE(1, 48)
  b.writeUInt32LE(0, 56)
  b.writeUInt32LE(0xfffffffe, 60)
  b.writeUInt32LE(0xfffffffe, 68)
  b.writeUInt32LE(0, 76)
  for (let i = 1; i < 109; i++) b.writeUInt32LE(0xffffffff, 76 + i * 4)
  const fatOff = 512
  for (let i = 0; i < 128; i++) b.writeUInt32LE(0xffffffff, fatOff + i * 4)
  b.writeUInt32LE(0xfffffffd, fatOff)
  b.writeUInt32LE(0xfffffffe, fatOff + 4)
  b.writeUInt32LE(3, fatOff + 8)
  b.writeUInt32LE(0xfffffffe, fatOff + 12)
  writeDirEntry(b, 1024, 'Root Entry', 5, 0xfffffffe, 0)
  writeDirEntry(b, 1024 + 128, streamName, 2, 2, data.length)
  Buffer.from(data).copy(b, 1536)
  return new Uint8Array(b)
}
const rec = (t, d) => [t & 255, (t >> 8) & 255, d.length & 255, (d.length >> 8) & 255, ...d]
const rkInt = (n) => {
  const rk = ((n << 2) | 2) >>> 0
  return [rk & 255, (rk >> 8) & 255, (rk >> 16) & 255, (rk >> 24) & 255]
}
const wideStr = (s) => {
  const out = [s.length & 255, (s.length >> 8) & 255, 1]
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    out.push(c & 255, (c >> 8) & 255)
  }
  return out
}
function genXls() {
  // SST: "名称","数量","苹果","香蕉" 全宽字符
  const strs = ['名称', '数量', '苹果', '香蕉']
  const sstData = [...u32(4), ...u32(4)]
  for (const s of strs) sstData.push(...wideStr(s))
  const biff = [
    ...rec(0x0809, [0, 0, 0, 0, 0, 0, 0, 0]),
    ...rec(0x0085, [0, 0, 0, 0, 0, 0, 6, 0, 83, 104, 101, 101, 116, 49]),
    ...rec(0x00fc, sstData),
    ...rec(0x00fd, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), // A1 名称
    ...rec(0x00fd, [0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), // B1 数量
    ...rec(0x00fd, [1, 0, 0, 0, 0, 0, 2, 0, 0, 0]), // A2 苹果
    ...rec(0x027e, [1, 0, 1, 0, 0, 0, ...rkInt(3)]), // B2 3
    ...rec(0x00fd, [2, 0, 0, 0, 0, 0, 3, 0, 0, 0]), // A3 香蕉
    ...rec(0x027e, [2, 0, 1, 0, 0, 0, ...rkInt(12)]), // B3 12
    ...rec(0x000a, []),
  ]
  writeFileSync(path.join(OUT, 'sample.xls'), buildCfb('Workbook', biff))
}

await genDocx()
await genXlsx()
await genPptx()
genXls()
console.log('样例已生成到', OUT)
