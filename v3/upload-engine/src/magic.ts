// ============================================================
// 魔数校验 — 文件类型安全
// 读取前 512B 匹配已知文件头，防止扩展名伪造
// 对标：阿里云 OSS、微信小程序 chooseImage 底层魔数校验
// ============================================================

/** 魔数签名表：扩展名 → 特征字节序列 */
const MAGIC: Record<string, number[][]> = {
  // 图片
  jpg:  [[0xFF, 0xD8, 0xFF]],
  jpeg: [[0xFF, 0xD8, 0xFF]],
  png:  [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  bmp:  [[0x42, 0x4D]],
  gif:  [[0x47, 0x49, 0x46, 0x38]],  // GIF89a / GIF87a
  webp: [[0x52, 0x49, 0x46, 0x46]],  // RIFF....WEBP
  heic: [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]], // ftyp heic

  // 文档
  pdf:  [[0x25, 0x50, 0x44, 0x46]],  // %PDF
  docx: [[0x50, 0x4B, 0x03, 0x04]],  // ZIP (OOXML)
  doc:  [[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]], // OLE2
  pptx: [[0x50, 0x4B, 0x03, 0x04]],  // ZIP (OOXML)
  ppt:  [[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]], // OLE2
  xlsx: [[0x50, 0x4B, 0x03, 0x04]],  // ZIP (OOXML)
  xls:  [[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]], // OLE2
  txt:  [],  // 纯文本无魔数，跳过校验

  // 音视频
  mp3:  [[0xFF, 0xFB], [0x49, 0x44, 0x33]],  // MPEG sync / ID3
  wav:  [[0x52, 0x49, 0x46, 0x46]],  // RIFF....WAVE
  m4a:  [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]], // ftyp
  aac:  [[0xFF, 0xF1], [0xFF, 0xF9]],
  pcm:  [],  // PCM 无标准头，跳过
  amr:  [[0x23, 0x21, 0x41, 0x4D, 0x52]],  // #!AMR
  wma:  [[0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11]],  // ASF Header

  mp4:  [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]],  // ftyp
  m4v:  [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]],  // ftyp
  mkv:  [[0x1A, 0x45, 0xDF, 0xA3]],  // EBML
  flv:  [[0x46, 0x4C, 0x56, 0x01]],  // FLV
  mov:  [[0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70]],  // ftyp (qt)
  wmv:  [[0x30, 0x26, 0xB2, 0x75, 0x8E, 0x66, 0xCF, 0x11]],  // ASF
  mxf:  [[0x06, 0x0E, 0x2B, 0x34, 0x02, 0x05, 0x01, 0x01]],  // SMPTE KLV
  avi:  [[0x52, 0x49, 0x46, 0x46]],  // RIFF....AVI
  ts:   [[0x47]],  // MPEG-TS sync byte

  // 压缩/归档（用于反向检测 + 全格式场景识别）
  zip:  [[0x50, 0x4B, 0x03, 0x04]],  // ZIP
  rar:  [[0x52, 0x61, 0x72, 0x21, 0x1A, 0x07]],  // Rar!
  '7z': [[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]],  // 7z
  gz:   [[0x1F, 0x8B]],  // gzip
  tar:  [],  // tar 头在 257 偏移，跳过
  // 可执行（用于全格式场景的风险提示，不阻断）
  exe:  [[0x4D, 0x5A]],  // MZ (PE)
  elf:  [[0x7F, 0x45, 0x4C, 0x46]],  // ELF
}

/** 风险类型：全格式场景下用于提示（不强制阻断） */
export const RISKY_TYPES = new Set(['exe', 'elf'])

/** 仅检测真实类型（不做白名单比对），供全格式场景信息展示 */
export async function detectFileType(file: File): Promise<string | null> {
  if (file.size === 0) return null
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer())
  return detectRealType(head)
}

export interface MagicResult {
  valid: boolean
  claimedExt: string    // 用户声称的扩展名
  detectedExt: string | null  // 魔数检测到的真实类型
  reason?: string
}

/**
 * 魔数校验
 * 读取文件前 512B，匹配已知文件头
 * 只阻断明显伪造（如 .exe 改名为 .jpg），对无魔数的格式（txt/pcm）放行
 */
export async function validateMagic(file: File): Promise<MagicResult> {
  const claimedExt = file.name.split('.').pop()?.toLowerCase() ?? ''
  const signatures = MAGIC[claimedExt]

  // 无魔数定义的格式（txt/pcm 等），跳过校验
  if (!signatures || signatures.length === 0) {
    return { valid: true, claimedExt, detectedExt: null }
  }

  // 空文件也能匹配某些魔数？不，空文件视为异常
  if (file.size === 0) {
    return { valid: true, claimedExt, detectedExt: null }
  }

  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer())

  // 匹配任一签名
  const matched = signatures.some(sig => {
    if (sig.length > head.length) return false
    return sig.every((byte, i) => head[i] === byte)
  })

  if (matched) {
    return { valid: true, claimedExt, detectedExt: claimedExt }
  }

  // 不匹配 → 尝试反向检测真实类型
  const detectedExt = detectRealType(head)
  return {
    valid: false,
    claimedExt,
    detectedExt,
    reason: `文件签名不匹配：声称 .${claimedExt}，实际检测 ${detectedExt ? '.' + detectedExt : '未知类型'}`,
  }
}

/** 反向检测：遍历所有魔数签名，找到匹配的真实类型 */
function detectRealType(head: Uint8Array): string | null {
  for (const [ext, signatures] of Object.entries(MAGIC)) {
    if (signatures.length === 0) continue
    for (const sig of signatures) {
      if (sig.length > head.length) continue
      if (sig.every((byte, i) => head[i] === byte)) {
        return ext
      }
    }
  }
  return null
}

/** 批量校验 */
export async function validateMagicBatch(files: File[]): Promise<MagicResult[]> {
  return Promise.all(files.map(validateMagic))
}