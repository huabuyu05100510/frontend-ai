// ============================================================================
// cfb — Compound File Binary（OLE2 复合文档）读取，零依赖
//   旧版 Office(.doc/.xls/.ppt) 的容器格式。本模块负责按名取出内部流。
//   支持 v3(512B 扇区) 与 v4(4096B 扇区)、FAT/DIFAT 链、mini-FAT/mini-stream。
// ============================================================================

const ENDOFCHAIN = 0xfffffffe
const FREESECT = 0xffffffff

function u16(b, o) {
  return b[o] | (b[o + 1] << 8)
}
function u32(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
}

export function parseCfb(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  // 签名校验
  const SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  for (let i = 0; i < 8; i++) if (b[i] !== SIG[i]) throw new Error('CFB: 签名错误（非 OLE2 复合文档）')

  const sectorShift = u16(b, 30)
  const sectorSize = 1 << sectorShift // 512 或 4096
  const miniSectorShift = u16(b, 32)
  const miniSectorSize = 1 << miniSectorShift // 64
  const numFatSectors = u32(b, 44)
  const firstDirSector = u32(b, 48)
  const miniCutoff = u32(b, 56)
  const firstMiniFat = u32(b, 60)
  const numMiniFat = u32(b, 64)
  const firstDifat = u32(b, 68)
  const numDifat = u32(b, 72)

  const sectorOffset = (s) => 512 + s * sectorSize
  const readSector = (s) => b.subarray(sectorOffset(s), sectorOffset(s) + sectorSize)

  // 1) 收集 FAT 扇区位置（DIFAT：头部 109 个 + DIFAT 链）
  const fatSectors = []
  for (let i = 0; i < 109 && i < numFatSectors; i++) {
    const loc = u32(b, 76 + i * 4)
    if (loc !== FREESECT) fatSectors.push(loc)
  }
  let difatSec = firstDifat
  for (let i = 0; i < numDifat && difatSec !== ENDOFCHAIN && difatSec !== FREESECT; i++) {
    const sec = readSector(difatSec)
    const entries = sectorSize / 4 - 1
    for (let j = 0; j < entries; j++) {
      const loc = u32(sec, j * 4)
      if (loc !== FREESECT && fatSectors.length < numFatSectors) fatSectors.push(loc)
    }
    difatSec = u32(sec, sectorSize - 4)
  }

  // 2) 构建 FAT 全表
  const fat = []
  for (const fs of fatSectors) {
    const sec = readSector(fs)
    for (let j = 0; j < sectorSize / 4; j++) fat.push(u32(sec, j * 4))
  }

  const chain = (start, table) => {
    const out = []
    let s = start
    const seen = new Set()
    while (s !== ENDOFCHAIN && s !== FREESECT && s < table.length && !seen.has(s)) {
      seen.add(s)
      out.push(s)
      s = table[s]
    }
    return out
  }

  const readChainBytes = (start) => {
    const secs = chain(start, fat)
    const out = new Uint8Array(secs.length * sectorSize)
    secs.forEach((s, i) => out.set(readSector(s), i * sectorSize))
    return out
  }

  // 3) 目录项
  const dirBytes = readChainBytes(firstDirSector)
  const entries = []
  for (let p = 0; p + 128 <= dirBytes.length; p += 128) {
    const nameLen = u16(dirBytes, p + 64)
    const type = dirBytes[p + 66]
    if (type === 0) continue // unknown/empty
    let name = ''
    for (let i = 0; i < Math.max(0, nameLen - 2); i += 2) {
      const code = u16(dirBytes, p + i)
      if (code) name += String.fromCharCode(code)
    }
    const startSector = u32(dirBytes, p + 116)
    const size = u32(dirBytes, p + 120) + u32(dirBytes, p + 124) * 0x100000000
    entries.push({ name, type, startSector, size })
  }

  // 4) mini-stream（root 的链）+ mini-FAT
  const root = entries.find((e) => e.type === 5)
  const miniStream = root ? readChainBytes(root.startSector) : new Uint8Array(0)
  const miniFat = []
  if (firstMiniFat !== ENDOFCHAIN && numMiniFat > 0) {
    const mf = readChainBytes(firstMiniFat)
    for (let j = 0; j < mf.length / 4; j++) miniFat.push(u32(mf, j * 4))
  }

  const readMini = (start, size) => {
    const secs = chain(start, miniFat)
    const out = new Uint8Array(secs.length * miniSectorSize)
    secs.forEach((s, i) => out.set(miniStream.subarray(s * miniSectorSize, (s + 1) * miniSectorSize), i * miniSectorSize))
    return out.subarray(0, size)
  }

  const readStream = (name) => {
    const e = entries.find((x) => x.name === name && x.type === 2)
    if (!e) return null
    if (e.size >= miniCutoff) return readChainBytes(e.startSector).subarray(0, e.size)
    return readMini(e.startSector, e.size)
  }

  return {
    names: entries.filter((e) => e.type === 2).map((e) => e.name),
    readStream,
  }
}
