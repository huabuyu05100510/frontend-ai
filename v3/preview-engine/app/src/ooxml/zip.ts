// ============================================================================
// zip — 零依赖 ZIP 读取（OOXML 容器）
//   解析中央目录（纯逻辑，可测）+ 用 Web 标准 DecompressionStream 解压 deflate。
//   不校验 CRC（预览场景按需取 part，信任来源容器结构）。
// ============================================================================

export interface ZipEntry {
  name: string
  method: number // 0=stored, 8=deflate
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8)
}
function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
}

/** 从尾部回扫定位 EOCD（End Of Central Directory） */
function findEOCD(b: Uint8Array): number {
  // 最小 22 字节；注释最长 65535
  const min = 22
  const start = Math.max(0, b.length - (min + 0xffff))
  for (let i = b.length - min; i >= start; i--) {
    if (u32(b, i) === SIG_EOCD) return i
  }
  return -1
}

export function parseCentralDirectory(b: Uint8Array): ZipEntry[] {
  const eocd = findEOCD(b)
  if (eocd < 0) throw new Error('ZIP: 未找到 EOCD（非法或截断的 ZIP）')
  const total = u16(b, eocd + 10)
  let p = u32(b, eocd + 16) // 中央目录偏移
  const decoder = new TextDecoder('utf-8')
  const entries: ZipEntry[] = []
  for (let i = 0; i < total; i++) {
    if (u32(b, p) !== SIG_CENTRAL) throw new Error('ZIP: 中央目录项签名错误')
    const method = u16(b, p + 10)
    const compressedSize = u32(b, p + 20)
    const uncompressedSize = u32(b, p + 24)
    const nameLen = u16(b, p + 28)
    const extraLen = u16(b, p + 30)
    const commentLen = u16(b, p + 32)
    const localHeaderOffset = u32(b, p + 42)
    const name = decoder.decode(b.subarray(p + 46, p + 46 + nameLen))
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Response(data as BlobPart).body!.pipeThrough(ds)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

/** 读取条目原始数据：定位本地头跳过文件名/extra，再按方法解压 */
async function readEntry(b: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  const o = e.localHeaderOffset
  // 本地头：30 字节固定 + 文件名 + extra（本地头尺寸字段可能为 0，故用中央目录尺寸）
  const nameLen = u16(b, o + 26)
  const extraLen = u16(b, o + 28)
  const dataStart = o + 30 + nameLen + extraLen
  const comp = b.subarray(dataStart, dataStart + e.compressedSize)
  if (e.method === 0) return comp.slice()
  if (e.method === 8) return inflateRaw(comp)
  throw new Error(`ZIP: 不支持的压缩方法 ${e.method}`)
}

export class ZipArchive {
  private map = new Map<string, ZipEntry>()
  private constructor(
    private raw: Uint8Array,
    entries: ZipEntry[],
  ) {
    for (const e of entries) this.map.set(e.name, e)
  }

  static async open(bytes: Uint8Array): Promise<ZipArchive> {
    return new ZipArchive(bytes, parseCentralDirectory(bytes))
  }

  names(): string[] {
    return [...this.map.keys()]
  }
  has(name: string): boolean {
    return this.map.has(name)
  }

  async bytes(name: string): Promise<Uint8Array> {
    const e = this.map.get(name)
    if (!e) throw new Error(`ZIP: 条目不存在 ${name}`)
    return readEntry(this.raw, e)
  }

  async text(name: string): Promise<string> {
    return new TextDecoder('utf-8').decode(await this.bytes(name))
  }
}
