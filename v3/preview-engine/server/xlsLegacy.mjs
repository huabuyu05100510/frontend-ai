// ============================================================================
// xlsLegacy — 旧版 .xls(BIFF8) → 结构化 sheet model，零依赖
//   解析 Workbook 流的 BIFF 记录：SST/LABELSST/RK/MULRK/NUMBER/LABEL/BOUNDSHEET。
//   处理 SST 跨 CONTINUE 记录与字符串边界重置压缩标志。
// ============================================================================

import { parseCfb } from './cfb.mjs'

const REC = {
  BOF: 0x0809,
  EOF: 0x000a,
  BOUNDSHEET: 0x0085,
  SST: 0x00fc,
  CONTINUE: 0x003c,
  LABELSST: 0x00fd,
  LABEL: 0x0204,
  RK: 0x027e,
  MULRK: 0x00bd,
  NUMBER: 0x0203,
}

const u16 = (b, o) => b[o] | (b[o + 1] << 8)
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

function rkToNumber(rk) {
  const cents = rk & 1
  let val
  if (rk & 2) {
    val = rk | 0 // 32 位有符号
    val >>= 2
  } else {
    const buf = Buffer.alloc(8)
    buf.writeUInt32LE(0, 0)
    buf.writeUInt32LE(rk & 0xfffffffc, 4)
    val = buf.readDoubleLE(0)
  }
  return cents ? val / 100 : val
}

function numText(n) {
  if (Number.isInteger(n)) return String(n)
  return String(Math.round(n * 1e10) / 1e10)
}

/** 定长 unicode 串（cch 为 u16），返回 {str, end} */
function readUnicodeStr(b, off) {
  const cch = u16(b, off)
  const grbit = b[off + 2]
  let p = off + 3
  const wide = grbit & 0x01
  let str = ''
  for (let i = 0; i < cch; i++) {
    if (wide) {
      str += String.fromCharCode(u16(b, p))
      p += 2
    } else {
      str += String.fromCharCode(b[p])
      p += 1
    }
  }
  return { str, end: p }
}

/** 短 unicode 串（cch 为 u8），用于 BOUNDSHEET 名称 */
function readShortStr(b, off) {
  const cch = b[off]
  const grbit = b[off + 1]
  let p = off + 2
  const wide = grbit & 0x01
  let str = ''
  for (let i = 0; i < cch; i++) {
    if (wide) {
      str += String.fromCharCode(u16(b, p))
      p += 2
    } else {
      str += String.fromCharCode(b[p])
      p += 1
    }
  }
  return str
}

// SST 跨段读取器：char 数据跨段时段首有新的压缩标志字节
class SstReader {
  constructor(segments) {
    this.segs = segments
    this.si = 0
    this.off = 0
  }
  _ensure() {
    while (this.si < this.segs.length && this.off >= this.segs[this.si].length) {
      this.si++
      this.off = 0
    }
  }
  atEnd() {
    this._ensure()
    return this.si >= this.segs.length
  }
  u8() {
    this._ensure()
    return this.segs[this.si][this.off++]
  }
  u16v() {
    return this.u8() | (this.u8() << 8)
  }
  u32v() {
    return (this.u16v() | (this.u16v() << 16)) >>> 0
  }
  readChars(cch, wide) {
    let str = ''
    let remaining = cch
    while (remaining > 0) {
      this._ensure()
      if (this.si >= this.segs.length) break
      const seg = this.segs[this.si]
      // 读尽当前段内可用字符
      while (remaining > 0 && this.off < seg.length) {
        if (wide) {
          if (this.off + 2 > seg.length) break // 半个字符落在段尾 → 交给跨段逻辑
          str += String.fromCharCode(seg[this.off] | (seg[this.off + 1] << 8))
          this.off += 2
        } else {
          str += String.fromCharCode(seg[this.off])
          this.off += 1
        }
        remaining--
      }
      if (remaining > 0) {
        // 跨入下一段：段首是新的压缩标志
        this.si++
        this.off = 0
        this._ensure()
        if (this.si >= this.segs.length) break
        wide = this.u8() & 0x01
      }
    }
    return str
  }
}

function parseSst(segments) {
  const r = new SstReader(segments)
  r.u32v() // total
  const unique = r.u32v()
  const out = []
  for (let i = 0; i < unique && !r.atEnd(); i++) {
    const cch = r.u16v()
    const grbit = r.u8()
    const wide = grbit & 0x01
    const rich = grbit & 0x08
    const ext = grbit & 0x04
    const cRun = rich ? r.u16v() : 0
    const cbExt = ext ? r.u32v() : 0
    out.push(r.readChars(cch, wide))
    for (let k = 0; k < cRun; k++) r.u32v() // 跳过富文本 run
    for (let k = 0; k < cbExt; k++) r.u8() // 跳过 ext
  }
  return out
}

/** .xls 字节 → { name, rows, cols, cells:[{r,c,text}] } */
export function parseXls(buf) {
  const cfb = parseCfb(buf)
  const stream = cfb.readStream('Workbook') || cfb.readStream('Book')
  if (!stream) throw new Error('XLS: 未找到 Workbook/Book 流')

  const records = []
  let p = 0
  while (p + 4 <= stream.length) {
    const type = u16(stream, p)
    const len = u16(stream, p + 2)
    records.push({ type, data: stream.subarray(p + 4, p + 4 + len) })
    p += 4 + len
  }

  let sst = []
  for (let i = 0; i < records.length; i++) {
    if (records[i].type === REC.SST) {
      const segs = [records[i].data]
      let j = i + 1
      while (j < records.length && records[j].type === REC.CONTINUE) segs.push(records[j++].data)
      sst = parseSst(segs)
      break
    }
  }

  let name = 'Sheet1'
  const bs = records.find((r) => r.type === REC.BOUNDSHEET)
  if (bs && bs.data.length > 6) name = readShortStr(bs.data, 6) || name

  const cells = []
  let maxR = -1
  let maxC = -1
  const put = (rr, cc, text) => {
    if (text === '' || text == null) return
    cells.push({ r: rr, c: cc, text: String(text) })
    if (rr > maxR) maxR = rr
    if (cc > maxC) maxC = cc
  }

  for (const rec of records) {
    const d = rec.data
    if (rec.type === REC.LABELSST) {
      put(u16(d, 0), u16(d, 2), sst[u32(d, 6)] ?? '')
    } else if (rec.type === REC.RK) {
      put(u16(d, 0), u16(d, 2), numText(rkToNumber(u32(d, 6))))
    } else if (rec.type === REC.NUMBER) {
      put(u16(d, 0), u16(d, 2), numText(Buffer.from(d.subarray(6, 14)).readDoubleLE(0)))
    } else if (rec.type === REC.LABEL) {
      put(u16(d, 0), u16(d, 2), readUnicodeStr(d, 6).str)
    } else if (rec.type === REC.MULRK) {
      const row = u16(d, 0)
      const colFirst = u16(d, 2)
      const n = (d.length - 6) / 6
      for (let k = 0; k < n; k++) {
        const rk = u32(d, 4 + k * 6 + 2)
        put(row, colFirst + k, numText(rkToNumber(rk)))
      }
    }
  }

  return { name, rows: maxR + 1, cols: maxC + 1, cells }
}
