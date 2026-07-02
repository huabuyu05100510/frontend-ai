// ============================================================================
// SourceHandle — 惰性字节读取抽象
//   预览引擎只面向「按需读取的字节流」，不要求把整文件读进内存。
//   BlobSource 用 Blob.slice（零拷贝视图）实现，1GB 文件也只在读时取片段。
// ============================================================================

export interface SourceHandle {
  readonly size: number
  readonly name: string
  /** 前 n 字节（探测/魔数用） */
  readHead(n: number): Promise<Uint8Array>
  /** 任意区间 [start, end) */
  slice(start: number, end: number): Promise<Uint8Array>
  /** 原始 Blob，供 <img>/<video>/createObjectURL 等原生消费 */
  blob(): Blob
  /** 全量文本解码 */
  text(): Promise<string>
}

async function blobBytes(b: Blob): Promise<Uint8Array> {
  if (typeof b.arrayBuffer === 'function') return new Uint8Array(await b.arrayBuffer())
  // 环境兜底：部分 jsdom 的 Blob 无 arrayBuffer，用 FileReader 读取真实字节
  if (typeof FileReader !== 'undefined') {
    return await new Promise<Uint8Array>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer))
      fr.onerror = () => reject(fr.error)
      fr.readAsArrayBuffer(b)
    })
  }
  return new Uint8Array(await new Response(b as BlobPart).arrayBuffer())
}

export class BlobSource implements SourceHandle {
  private _blob: Blob
  readonly name: string

  constructor(file: Blob, name?: string) {
    this._blob = file
    this.name = name ?? (file instanceof File ? file.name : '')
  }

  get size(): number {
    return this._blob.size
  }

  async readHead(n: number): Promise<Uint8Array> {
    const end = Math.min(n, this._blob.size)
    return blobBytes(this._blob.slice(0, end))
  }

  async slice(start: number, end: number): Promise<Uint8Array> {
    return blobBytes(this._blob.slice(start, end))
  }

  blob(): Blob {
    return this._blob
  }

  async text(): Promise<string> {
    if (typeof this._blob.text === 'function') return this._blob.text()
    return new TextDecoder().decode(await blobBytes(this._blob))
  }
}
