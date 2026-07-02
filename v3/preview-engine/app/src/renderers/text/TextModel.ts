// ============================================================================
// TextModel — 文本解码 + 行索引（配合 CumulativeIndex 做行虚拟化）
// ============================================================================

export class TextModel {
  private lines: string[]

  constructor(text: string) {
    // 归一 CRLF/CR → LF 后按行切分
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    this.lines = normalized.split('\n')
  }

  static decode(bytes: Uint8Array): string {
    if (bytes.length === 0) return ''
    // 去除 UTF-8 BOM
    const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    const view = hasBom ? bytes.subarray(3) : bytes
    return new TextDecoder('utf-8').decode(view)
  }

  get lineCount(): number {
    return this.lines.length
  }

  /** 取 [start, end] 闭区间的行（越界自动夹紧） */
  getLines(start: number, end: number): string[] {
    const s = Math.max(0, start)
    const e = Math.min(this.lines.length - 1, end)
    if (e < s) return []
    return this.lines.slice(s, e + 1)
  }

  line(i: number): string {
    return this.lines[i] ?? ''
  }
}
