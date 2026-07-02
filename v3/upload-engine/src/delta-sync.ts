// ============================================================
// Delta 增量同步 — rsync 算法
// CDC 分片 → 弱哈希快速比对 → 强哈希确认 → 仅上传差量
// 对标：Dropbox / Google Drive / rsync
// 100MB 文档改 1 页 → 只传 ~2MB 差量，节省 98% 带宽
// ============================================================

import { cdcChunk, rabinWeakHash, strongHash } from './cdc'

interface ChunkSignature {
  index: number
  weakHash: number
  strongHash: string
  offset: number
  size: number
}

interface DeltaResult {
  matchedChunks: number[]     // 服务端已有的分片索引
  newChunks: ArrayBuffer[]    // 需要上传的新分片
  assembly: AssemblyInstruction[]  // 组装指令
  savedBytes: number          // 节省的字节数
  totalBytes: number
}

interface AssemblyInstruction {
  type: 'copy' | 'upload'
  chunkIndex?: number  // 服务端已有分片索引（copy）
  newData?: ArrayBuffer  // 新数据（upload）
  offset: number
  size: number
}

/**
 * Delta 增量同步
 *
 * 流程：
 * 1. 客户端 CDC 分片 → 计算每片弱哈希 + 强哈希
 * 2. 发送弱哈希列表给服务端
 * 3. 服务端匹配已有分片 → 返回已有分片索引列表
 * 4. 客户端仅上传新分片 + 组装指令
 */
export class DeltaSync {
  private serverChunks = new Map<number, ChunkSignature>()

  /**
   * 客户端：计算新文件的签名列表
   */
  async computeSignatures(file: ArrayBuffer): Promise<ChunkSignature[]> {
    const chunks = cdcChunk(file)
    const signatures: ChunkSignature[] = []

    for (let i = 0; i < chunks.length; i++) {
      const data = new Uint8Array(chunks[i])
      signatures.push({
        index: i,
        weakHash: rabinWeakHash(data),
        strongHash: await strongHash(chunks[i]),
        offset: signatures.reduce((sum, s) => sum + s.size, 0),
        size: chunks[i].byteLength,
      })
    }

    return signatures
  }

  /**
   * 服务端模拟：匹配已有分片
   * 生产环境：POST 弱哈希列表 → 服务端查 CDC 分片索引 → 返回匹配结果
   */
  async matchOnServer(
    clientSignatures: ChunkSignature[],
    knownStrongHashes: Set<string>,
  ): Promise<Set<number>> {
    const matched = new Set<number>()

    for (const sig of clientSignatures) {
      if (knownStrongHashes.has(sig.strongHash)) {
        matched.add(sig.index)
      }
    }

    return matched
  }

  /**
   * 客户端：生成差量（仅上传新分片 + 组装指令）
   */
  async generateDelta(
    file: ArrayBuffer,
    clientSignatures: ChunkSignature[],
    serverMatchedChunks: Set<number>,
  ): Promise<DeltaResult> {
    const chunks = cdcChunk(file)
    const newChunks: ArrayBuffer[] = []
    const assembly: AssemblyInstruction[] = []
    let totalBytes = 0
    let savedBytes = 0

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      totalBytes += chunk.byteLength

      if (serverMatchedChunks.has(i)) {
        // 服务端已有 → copy 指令
        assembly.push({
          type: 'copy',
          chunkIndex: i,
          offset: clientSignatures[i].offset,
          size: chunk.byteLength,
        })
        savedBytes += chunk.byteLength
      } else {
        // 新分片 → upload 指令
        newChunks.push(chunk)
        assembly.push({
          type: 'upload',
          newData: chunk,
          offset: clientSignatures[i].offset,
          size: chunk.byteLength,
        })
      }
    }

    return {
      matchedChunks: Array.from(serverMatchedChunks),
      newChunks,
      assembly,
      savedBytes,
      totalBytes,
    }
  }

  /**
   * 全量回退：当差量计算失败时，退回全量上传
   */
  fallbackFullUpload(file: ArrayBuffer): DeltaResult {
    return {
      matchedChunks: [],
      newChunks: [file],
      assembly: [{ type: 'upload', newData: file, offset: 0, size: file.byteLength }],
      savedBytes: 0,
      totalBytes: file.byteLength,
    }
  }
}

/**
 * 客户端-服务端交互协议
 *
 * 请求：POST /api/upload/delta-match
 * Body: { weakHashes: number[], strongHashes: string[], sizes: number[] }
 *
 * 响应：
 * {
 *   matched: number[],          // 服务端已有的分片索引
 *   sessionId: string,          // 本次 delta 会话 ID
 * }
 *
 * 然后客户端 POST /api/upload/delta-upload
 * Body: multipart: { newChunks[], assembly: AssemblyInstruction[], sessionId }
 */
export const DeltaProtocol = {
  async matchSignatures(
    url: string,
    signatures: ChunkSignature[],
    headers?: Record<string, string>,
  ): Promise<{ matched: number[]; sessionId: string }> {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        weakHashes: signatures.map(s => s.weakHash),
        strongHashes: signatures.map(s => s.strongHash),
        sizes: signatures.map(s => s.size),
      }),
    })
    return resp.json()
  },

  async uploadDelta(
    url: string,
    delta: DeltaResult,
    sessionId: string,
    headers?: Record<string, string>,
  ): Promise<{ url: string }> {
    const form = new FormData()
    form.append('sessionId', sessionId)
    form.append('assembly', JSON.stringify(delta.assembly))

    for (let i = 0; i < delta.newChunks.length; i++) {
      form.append('newChunks', new Blob([delta.newChunks[i]]), `chunk_${i}`)
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: form,
    })
    return resp.json()
  },
}