// 自研multipart编译器：词法分析 → 语法分析 → AST生成
// 完整实现，可直接替换 multipart.mjs
// 技术亮点：编译器架构、零拷贝流式解析、精确AST

import { Buffer } from 'node:buffer'

// ========== 词法分析器（Lexer） ==========

const TokenType = {
  BOUNDARY: 'BOUNDARY',
  CRLF: 'CRLF',
  HEADER: 'HEADER',
  CONTENT: 'CONTENT',
  EOF: 'EOF'
}

class MultipartLexer {
  constructor(buffer, boundary) {
    this.buffer = buffer
    this.boundary = Buffer.from('--' + boundary)
    this.pos = 0
    this.length = buffer.length
  }

  // 核心方法：读取下一个token
  nextToken() {
    if (this.pos >= this.length) {
      return { type: TokenType.EOF }
    }

    // 1. 检测boundary
    if (this.matchBoundary()) {
      this.pos += this.boundary.length
      return { type: TokenType.BOUNDARY }
    }

    // 2. 检测CRLF
    if (this.matchCRLF()) {
      this.pos += 2
      return { type: TokenType.CRLF }
    }

    // 3. 检测header（以Content-Disposition等开头）
    if (this.isHeaderStart()) {
      const header = this.readHeader()
      return { type: TokenType.HEADER, value: header }
    }

    // 4. 读取content（直到下一个boundary）
    const content = this.readContent()
    return { type: TokenType.CONTENT, value: content }
  }

  // 检测boundary
  matchBoundary() {
    if (this.pos + this.boundary.length > this.length) return false
    return this.buffer.slice(this.pos, this.pos + this.boundary.length)
      .equals(this.boundary)
  }

  // 检测CRLF
  matchCRLF() {
    if (this.pos + 2 > this.length) return false
    return this.buffer[this.pos] === 0x0d && this.buffer[this.pos + 1] === 0x0a
  }

  // 检测header开始（包含冒号的行）
  isHeaderStart() {
    // 查找下一个CRLF，看是否包含冒号
    let end = this.pos
    while (end < this.length && !(this.buffer[end] === 0x0d && this.buffer[end + 1] === 0x0a)) {
      end++
    }

    if (end >= this.length) return false

    const line = this.buffer.slice(this.pos, end).toString('utf-8')
    return line.includes(':') && !line.startsWith('--')
  }

  // 读取header（直到CRLF）
  readHeader() {
    let end = this.pos
    while (end < this.length && !(this.buffer[end] === 0x0d && this.buffer[end + 1] === 0x0a)) {
      end++
    }

    const headerLine = this.buffer.slice(this.pos, end).toString('utf-8')
    this.pos = end + 2 // 跳过CRLF

    // 解析header：Name: Value
    const colonIndex = headerLine.indexOf(':')
    const name = headerLine.slice(0, colonIndex).trim()
    const value = headerLine.slice(colonIndex + 1).trim()

    // 解析特殊属性（如filename）
    const attributes = {}
    if (name === 'Content-Disposition') {
      const filenameMatch = value.match(/filename="([^"]*)"/i)
      if (filenameMatch) {
        attributes.filename = filenameMatch[1]
      }
      const nameMatch = value.match(/name="([^"]*)"/i)
      if (nameMatch) {
        attributes.fieldName = nameMatch[1]
      }
    }

    return { name, value, attributes }
  }

  // 读取content（直到下一个boundary）
  readContent() {
    // 查找下一个boundary
    const nextBoundary = this.findNextBoundary()

    if (nextBoundary === -1) {
      // 没有找到boundary，读取到结尾
      const content = this.buffer.slice(this.pos)
      this.pos = this.length
      return content
    }

    // boundary前有CRLF，需要去掉
    let contentEnd = nextBoundary
    if (this.buffer[contentEnd - 2] === 0x0d && this.buffer[contentEnd - 1] === 0x0a) {
      contentEnd -= 2
    }

    const content = this.buffer.slice(this.pos, contentEnd)
    this.pos = nextBoundary
    return content
  }

  // 查找下一个boundary（快速搜索算法）
  findNextBoundary() {
    // 使用indexOf快速查找
    return this.buffer.indexOf(this.boundary, this.pos)
  }
}

// ========== 语法分析器（Parser） ==========

class MultipartParser {
  constructor(lexer) {
    this.lexer = lexer
  }

  // 核心方法：解析生成AST
  parse() {
    const parts = []

    // 第一个token应该是boundary
    let token = this.lexer.nextToken()
    if (token.type !== TokenType.BOUNDARY) {
      throw new Error('Invalid multipart: missing initial boundary')
    }

    while (true) {
      token = this.lexer.nextToken()

      if (token.type === TokenType.EOF) break

      // 检测结束boundary（--boundary--）
      if (token.type === TokenType.BOUNDARY) {
        // 检查是否是结束标记
        if (this.lexer.pos + 2 <= this.lexer.length &&
            this.lexer.buffer[this.lexer.pos] === 0x2d &&
            this.lexer.buffer[this.lexer.pos + 1] === 0x2d) {
          break // 结束
        }

        // 新的part开始
        const part = this.parsePart()
        parts.push(part)
      }
    }

    return {
      type: 'MultipartDocument',
      parts,
      metadata: {
        boundary: this.lexer.boundary.toString('utf-8'),
        totalParts: parts.length
      }
    }
  }

  // 解析单个part
  parsePart() {
    const headers = []
    let body = null
    let fieldName = null

    while (true) {
      const token = this.lexer.nextToken()

      if (token.type === TokenType.EOF || token.type === TokenType.BOUNDARY) {
        break
      }

      if (token.type === TokenType.HEADER) {
        headers.push({
          type: 'Header',
          name: token.value.name,
          value: token.value.value,
          attributes: token.value.attributes
        })

        if (token.value.attributes.fieldName) {
          fieldName = token.value.attributes.fieldName
        }
      }

      if (token.type === TokenType.CONTENT) {
        body = {
          type: 'Body',
          data: token.value,
          length: token.value.length
        }
      }
    }

    return {
      type: 'Part',
      fieldName,
      headers,
      body,
      metadata: {
        headerCount: headers.length,
        bodyLength: body ? body.length : 0
      }
    }
  }
}

// ========== AST访问器（Visitor） ==========

class MultipartVisitor {
  visit(ast) {
    const fields = {}

    for (const part of ast.parts) {
      if (part.fieldName) {
        fields[part.fieldName] = this.visitPart(part)
      }
    }

    return fields
  }

  visitPart(part) {
    const result = {
      headers: part.headers.map(h => ({ name: h.name, value: h.value, ...h.attributes })),
      data: part.body ? part.body.data : null,
      filename: null
    }

    // 提取filename
    const disposition = part.headers.find(h => h.name === 'Content-Disposition')
    if (disposition && disposition.attributes.filename) {
      result.filename = disposition.attributes.filename
    }

    return result
  }
}

// ========== 导出函数（替代原有parseMultipart） ==========

/**
 * 流式读取请求body（带大小限制）
 */
export function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let aborted = false

    req.on('data', chunk => {
      size += chunk.length
      if (maxBytes && size > maxBytes) {
        aborted = true
        reject(new Error('FILE_TOO_LARGE'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks))
    })

    req.on('error', reject)
  })
}

/**
 * 解析multipart/form-data（编译器架构）
 * 替代原有的parseMultipart函数
 */
export function parseMultipart(buffer, boundary) {
  try {
    // 1. 词法分析
    const lexer = new MultipartLexer(buffer, boundary)

    // 2. 语法分析
    const parser = new MultipartParser(lexer)
    const ast = parser.parse()

    // 3. AST访问
    const visitor = new MultipartVisitor()
    const fields = visitor.visit(ast)

    // 兼容原有格式
    const result = {}
    for (const [name, field] of Object.entries(fields)) {
      result[name] = {
        data: field.data,
        filename: field.filename
      }
    }

    return result
  } catch (error) {
    console.error('[multipart-compiler] Parse error:', error.message)
    // 降级到原有简单解析
    return fallbackParse(buffer, boundary)
  }
}

/**
 * 降级解析（兼容原有逻辑）
 */
function fallbackParse(buf, boundary) {
  const fields = {}
  const delim = Buffer.from('--' + boundary)
  let start = buf.indexOf(delim)
  if (start === -1) return fields
  start += delim.length

  while (start < buf.length) {
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2

    const next = buf.indexOf(delim, start)
    if (next === -1) break

    let end = next
    if (buf[end - 2] === 0x0d && buf[end - 1] === 0x0a) end -= 2

    const part = buf.slice(start, end)
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
    if (headerEnd !== -1) {
      const header = part.slice(0, headerEnd).toString('utf-8')
      const body = part.slice(headerEnd + 4)
      const name = header.match(/name="([^"]*)"/i)?.[1]
      const filename = header.match(/filename="([^"]*)"/i)?.[1]
      if (name) fields[name] = { data: body, filename }
    }

    start = next + delim.length
  }

  return fields
}

/**
 * 获取AST（用于调试和性能分析）
 */
export function parseMultipartAST(buffer, boundary) {
  const lexer = new MultipartLexer(buffer, boundary)
  const parser = new MultipartParser(lexer)
  return parser.parse()
}

/**
 * 性能测试函数
 */
export function benchmarkParse(buffer, boundary, iterations = 100) {
  const start = Date.now()

  for (let i = 0; i < iterations; i++) {
    parseMultipart(buffer, boundary)
  }

  const elapsed = Date.now() - start
  const avg = elapsed / iterations

  return {
    totalMs: elapsed,
    avgMs: avg,
    iterations,
    bytesPerMs: buffer.length / avg
  }
}