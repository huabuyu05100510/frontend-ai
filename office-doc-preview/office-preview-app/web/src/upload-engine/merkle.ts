// ============================================================
// Merkle Tree — 分片完整性校验
// 每片独立 SHA-256 → 构建 Merkle Tree → root hash 校验整体一致性
// 对标：AWS S3 Multipart Upload ETag (MD5 of concatenated MD5s)
//       BitTorrent / rsync 的 Merkle Tree 分片校验
// ============================================================

export interface MerkleNode {
  hash: string
  left?: MerkleNode
  right?: MerkleNode
}

export interface MerkleProof {
  leafIndex: number
  leafHash: string
  siblings: { hash: string; position: 'left' | 'right' }[]
  rootHash: string
}

/**
 * 构建 Merkle Tree
 * chunks: 每片的 SHA-256 hex 字符串数组
 */
export function buildMerkleTree(chunkHashes: string[]): MerkleNode | null {
  if (chunkHashes.length === 0) return null

  let nodes: MerkleNode[] = chunkHashes.map(hash => ({ hash }))

  // 自底向上构建
  while (nodes.length > 1) {
    const nextLevel: MerkleNode[] = []
    for (let i = 0; i < nodes.length; i += 2) {
      if (i + 1 < nodes.length) {
        const combined = nodes[i].hash + nodes[i + 1].hash
        nextLevel.push({
          hash: sha256String(combined),
          left: nodes[i],
          right: nodes[i + 1],
        })
      } else {
        // 奇数节点直接提升
        nextLevel.push(nodes[i])
      }
    }
    nodes = nextLevel
  }

  return nodes[0]
}

/**
 * 生成 Merkle Proof（证明某片属于该树）
 * 用于服务端验证单片的完整性
 */
export function generateMerkleProof(
  chunkHashes: string[],
  leafIndex: number,
): MerkleProof | null {
  if (leafIndex >= chunkHashes.length) return null

  const root = buildMerkleTree(chunkHashes)
  if (!root) return null

  const siblings: { hash: string; position: 'left' | 'right' }[] = []
  let nodes: MerkleNode[] = chunkHashes.map(hash => ({ hash }))
  let index = leafIndex

  while (nodes.length > 1) {
    if (index % 2 === 0 && index + 1 < nodes.length) {
      siblings.push({ hash: nodes[index + 1].hash, position: 'right' })
    } else if (index % 2 === 1) {
      siblings.push({ hash: nodes[index - 1].hash, position: 'left' })
    }
    index = Math.floor(index / 2)
    nodes = buildNextLevel(nodes)
  }

  return { leafIndex, leafHash: chunkHashes[leafIndex], siblings, rootHash: root.hash }
}

function buildNextLevel(nodes: MerkleNode[]): MerkleNode[] {
  const next: MerkleNode[] = []
  for (let i = 0; i < nodes.length; i += 2) {
    if (i + 1 < nodes.length) {
      next.push({ hash: sha256String(nodes[i].hash + nodes[i + 1].hash) })
    } else {
      next.push(nodes[i])
    }
  }
  return next
}

// 注意：buildMerkleTree / generateMerkleProof 使用同步弱哈希组合父节点，
// 仅用于结构演示与代理顺序证明。生产用 StreamingMerkleTree（真实 SHA-256）。
function sha256String(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

/** 真实 SHA-256，输出 hex */
export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const input = (typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data) as BufferSource
  const digest = await crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 由叶子哈希（按分片序号有序）异步构建 Merkle 根，父节点用真实 SHA-256 */
export async function buildMerkleRoot(leafHashes: string[]): Promise<string | null> {
  if (leafHashes.length === 0) return null
  let level = leafHashes.slice()
  while (level.length > 1) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(await sha256Hex(level[i] + level[i + 1]))
      } else {
        next.push(level[i]) // 奇数节点提升
      }
    }
    level = next
  }
  return level[0]
}

/**
 * 流式 Merkle Tree —— 按分片序号定位叶子（与上传完成顺序无关），
 * 全部分片就位后调用 finalize() 用真实 SHA-256 构建根，保证完整性可校验。
 */
export class StreamingMerkleTree {
  private leaves = new Map<number, string>()
  private root: string | null = null

  /** 按分片序号写入叶子哈希（幂等，支持断点续传/乱序完成） */
  setLeaf(index: number, hash: string): void {
    this.leaves.set(index, hash)
  }

  /** 兼容旧接口：顺序追加 */
  addChunkHash(hash: string): void {
    this.leaves.set(this.leaves.size, hash)
  }

  /** 所有叶子就位后计算根（缺片返回 null） */
  async finalize(totalLeaves?: number): Promise<string | null> {
    const count = totalLeaves ?? this.leaves.size
    const ordered: string[] = []
    for (let i = 0; i < count; i++) {
      const h = this.leaves.get(i)
      if (h == null) return null // 缺片 → 完整性无法保证
      ordered.push(h)
    }
    this.root = await buildMerkleRoot(ordered)
    return this.root
  }

  getRootHash(): string | null {
    return this.root
  }

  getLeafCount(): number {
    return this.leaves.size
  }
}