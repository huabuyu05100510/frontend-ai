import type { ProbeResult, ContainerType, ViewModelCategory } from './types'

// ============================================================================
// FormatProbe — 前若干字节魔数 + 容器结构识别（不信任扩展名）
// ============================================================================

/** realType → 归一类别 */
const CATEGORY: Record<string, ViewModelCategory> = {
  pdf: 'paged',
  pptx: 'paged',
  ppt: 'paged',
  docx: 'flow',
  doc: 'flow',
  txt: 'flow',
  rtf: 'flow',
  xlsx: 'sheet',
  xls: 'sheet',
  csv: 'sheet',
  jpg: 'raster',
  png: 'raster',
  bmp: 'raster',
  gif: 'raster',
  webp: 'raster',
  mp4: 'media',
  m4v: 'media',
  mov: 'media',
  mkv: 'media',
  flv: 'media',
  avi: 'media',
  ts: 'media',
  wmv: 'media',
  mxf: 'media',
  mp3: 'media',
  wav: 'media',
  m4a: 'media',
  aac: 'media',
  amr: 'media',
  wma: 'media',
  s48: 'media',
  pcm: 'media',
  srt: 'subtitle',
  vtt: 'subtitle',
  ass: 'subtitle',
}

/** 无魔数、仅凭扩展名判定的格式（纯文本类） */
const EXT_ONLY = new Set([
  'txt',
  'srt',
  'vtt',
  'ass',
  'csv',
  'amr',
  'wma',
  's48',
  'pcm',
  'aac',
  'avi',
  'ts',
  'wmv',
  'mxf',
  'm4a',
])

function normExt(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, '')
  if (e === 'jpeg') return 'jpg'
  return e
}

function startsWith(head: Uint8Array, sig: number[], offset = 0): boolean {
  if (head.length < offset + sig.length) return false
  for (let i = 0; i < sig.length; i++) {
    if (head[offset + i] !== sig[i]) return false
  }
  return true
}

/** 把字节区间转 latin1 字符串（用于扫描 OOXML 目录标记 / ftyp brand） */
function ascii(head: Uint8Array, start: number, len: number): string {
  let s = ''
  const end = Math.min(head.length, start + len)
  for (let i = start; i < end; i++) s += String.fromCharCode(head[i])
  return s
}

interface Detected {
  realType: string
  container: ContainerType
  codecHints?: string[]
}

/** 仅凭魔数检测真实类型与容器，无法判定时返回 null */
function detectByMagic(head: Uint8Array): Detected | null {
  if (head.length === 0) return null

  // 可执行文件（伪造拦截）
  if (startsWith(head, [0x4d, 0x5a])) return { realType: 'exe', container: 'raw' }

  // PDF
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return { realType: 'pdf', container: 'raw' }

  // 图片
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { realType: 'png', container: 'raw' }
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { realType: 'jpg', container: 'raw' }
  // BMP：验证 DIB 头大小字段（偏移 14，合法值 12/40/108/124），防止两字节"BM"误判
  if (startsWith(head, [0x42, 0x4d]) && head.length >= 18) {
    const dib = head[14] | (head[15] << 8) | (head[16] << 16) | (head[17] << 24)
    if (dib === 12 || dib === 40 || dib === 108 || dib === 124) {
      return { realType: 'bmp', container: 'raw' }
    }
  }
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return { realType: 'gif', container: 'raw' }

  // OOXML / ZIP
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    const text = ascii(head, 0, head.length)
    if (text.includes('word/')) return { realType: 'docx', container: 'ooxml' }
    if (text.includes('xl/')) return { realType: 'xlsx', container: 'ooxml' }
    if (text.includes('ppt/')) return { realType: 'pptx', container: 'ooxml' }
    return { realType: 'zip', container: 'zip' }
  }

  // CFB（老 Office）
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    return { realType: 'cfb', container: 'cfb' }

  // MP4 family：偏移 4 处 'ftyp'
  if (startsWith(head, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = ascii(head, 8, 4).trim()
    let realType = 'mp4'
    if (brand.startsWith('qt')) realType = 'mov'
    else if (brand.toUpperCase().startsWith('M4V')) realType = 'm4v'
    return { realType, container: 'mp4box', codecHints: brand ? [brand] : [] }
  }

  // Matroska / WebM
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]))
    return { realType: 'mkv', container: 'matroska' }

  // FLV
  if (startsWith(head, [0x46, 0x4c, 0x56])) return { realType: 'flv', container: 'flv' }

  // 音频
  if (startsWith(head, [0x49, 0x44, 0x33])) return { realType: 'mp3', container: 'raw' } // ID3
  if (startsWith(head, [0xff, 0xfb]) || startsWith(head, [0xff, 0xf3]) || startsWith(head, [0xff, 0xf2]))
    return { realType: 'mp3', container: 'raw' }
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && ascii(head, 8, 4) === 'WAVE')
    return { realType: 'wav', container: 'raw' }

  return null
}

/**
 * 探测文件真实类型。
 * @param head 文件前若干字节（建议 ≥ 64B，OOXML 建议 ≥ 4KB）
 * @param ext  申报扩展名
 */
export function probe(head: Uint8Array, ext: string): ProbeResult {
  const declared = normExt(ext)
  const detected = detectByMagic(head)

  let realType: string
  let container: ContainerType
  let codecHints: string[] | undefined

  if (detected) {
    realType = detected.realType
    container = detected.container
    codecHints = detected.codecHints
    // CFB 仅靠魔数无法区分 doc/xls/ppt，借助扩展名细化
    if (realType === 'cfb') {
      realType = ['doc', 'xls', 'ppt'].includes(declared) ? declared : 'cfb'
    }
    // zip 无 OOXML 标记时，若扩展名是 OOXML 则信任扩展名
    if (realType === 'zip' && ['docx', 'xlsx', 'pptx'].includes(declared)) {
      realType = declared
      container = 'ooxml'
    }
  } else if (EXT_ONLY.has(declared)) {
    // 纯文本/无固定魔数格式：按扩展名归类
    realType = declared
    container = 'raw'
  } else {
    realType = 'unknown'
    container = null
  }

  const category: ViewModelCategory = CATEGORY[realType] ?? 'unknown'
  const trusted = realType === declared && category !== 'unknown'

  return { ext: declared, realType, container, category, trusted, codecHints }
}
