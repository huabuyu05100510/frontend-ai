import { describe, it, expect } from 'vitest'
import { extractBones, extractBonesWithStats, packSkeletonData } from '../extract.js'
import type { NodeMeasurement, Rect, NodeStyles } from '../types.js'

// ─── 测试辅助 ─────────────────────────────────────────────────────────────────

function makeStyles(overrides: Partial<NodeStyles> = {}): NodeStyles {
  return {
    display: 'block',
    visibility: 'visible',
    opacity: '1',
    overflow: 'visible',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    backgroundImage: 'none',
    borderRadius: '0',
    hasBorder: false,
    isFixedWidth: false,
    isFixedHeight: false,
    minWidth: 0,
    maxWidth: Infinity,
    minHeight: 0,
    maxHeight: Infinity,
    boxShadow: 'none',
    ...overrides,
  }
}

function makeNode(opts: {
  id?: string
  tag?: string
  rect?: Partial<Rect>
  styles?: Partial<NodeStyles>
  children?: NodeMeasurement[]
  isLeaf?: boolean
  textContent?: string
}): NodeMeasurement {
  const rect: Rect = {
    left: opts.rect?.left ?? 0,
    top: opts.rect?.top ?? 0,
    width: opts.rect?.width ?? 375,
    height: opts.rect?.height ?? 200,
  }
  return {
    id: opts.id ?? 'node',
    tag: opts.tag ?? 'div',
    rect,
    styles: makeStyles(opts.styles ?? {}),
    children: opts.children ?? [],
    isLeaf: opts.isLeaf ?? false,
    textContent: opts.textContent,
  }
}

/** 创建一个简单的单叶节点树 */
function makeSimpleTree(): NodeMeasurement {
  return makeNode({
    id: 'root',
    rect: { left: 0, top: 0, width: 375, height: 200 },
    children: [
      makeNode({
        id: 'title',
        tag: 'p',
        rect: { left: 10, top: 10, width: 355, height: 20 },
        isLeaf: true,
      }),
      makeNode({
        id: 'image',
        tag: 'img',
        rect: { left: 10, top: 40, width: 355, height: 100 },
        isLeaf: true,
      }),
    ],
  })
}

// ─── 基本功能 ─────────────────────────────────────────────────────────────────

describe('extractBones - 基本功能', () => {
  it('叶节点产生骨骼', () => {
    const tree = makeSimpleTree()
    const bones = extractBones(tree)
    expect(bones).toHaveLength(2)
  })

  it('坐标全部为百分比（0-100 范围内）', () => {
    const tree = makeSimpleTree()
    const bones = extractBones(tree)
    for (const bone of bones) {
      expect(bone.x).toBeGreaterThanOrEqual(0)
      expect(bone.y).toBeGreaterThanOrEqual(0)
      expect(bone.w).toBeGreaterThanOrEqual(0)
      expect(bone.h).toBeGreaterThanOrEqual(0)
      expect(bone.x + bone.w).toBeLessThanOrEqual(101) // 允许 1% 浮点误差
    }
  })

  it('title 骨骼坐标正确', () => {
    const root = makeNode({
      id: 'root',
      rect: { left: 0, top: 0, width: 375, height: 200 },
      children: [
        makeNode({
          id: 'title',
          tag: 'p',
          rect: { left: 10, top: 10, width: 200, height: 20 },
          isLeaf: true,
        }),
      ],
    })
    const bones = extractBones(root)
    expect(bones).toHaveLength(1)
    const b = bones[0]
    expect(b.x).toBeCloseTo((10 / 375) * 100, 1)
    expect(b.y).toBeCloseTo((10 / 200) * 100, 1)
    expect(b.w).toBeCloseTo((200 / 375) * 100, 1)
    expect(b.h).toBeCloseTo((20 / 200) * 100, 1)
  })
})

// ─── 容器骨骼 ─────────────────────────────────────────────────────────────────

describe('extractBones - 容器骨骼', () => {
  it('有背景色的容器产生 c:true 骨骼', () => {
    const tree = makeNode({
      id: 'root',
      rect: { left: 0, top: 0, width: 375, height: 200 },
      children: [
        makeNode({
          id: 'card',
          tag: 'div',
          rect: { left: 0, top: 0, width: 375, height: 100 },
          styles: { backgroundColor: '#ffffff' },
          children: [
            makeNode({
              id: 'text',
              tag: 'p',
              rect: { left: 10, top: 10, width: 300, height: 20 },
              isLeaf: true,
            }),
          ],
        }),
      ],
    })
    const bones = extractBones(tree)
    // card 容器 + text 叶节点
    expect(bones).toHaveLength(2)
    expect(bones[0].c).toBe(true) // 容器骨骼
    expect(bones[1].c).toBeUndefined() // 叶骨骼无 c
  })

  it('透明背景容器不产生容器骨骼', () => {
    const tree = makeNode({
      id: 'root',
      rect: { left: 0, top: 0, width: 375, height: 200 },
      children: [
        makeNode({
          id: 'wrapper',
          tag: 'div',
          rect: { left: 0, top: 0, width: 375, height: 100 },
          // 默认透明背景
          children: [
            makeNode({
              id: 'text',
              tag: 'p',
              rect: { left: 10, top: 10, width: 300, height: 20 },
              isLeaf: true,
            }),
          ],
        }),
      ],
    })
    const bones = extractBones(tree)
    expect(bones).toHaveLength(1)
    expect(bones[0].c).toBeUndefined()
  })

  it('captureRoundedBorders=true 时有圆角边框的容器产生容器骨骼', () => {
    const tree = makeNode({
      id: 'root',
      rect: { left: 0, top: 0, width: 375, height: 200 },
      children: [
        makeNode({
          id: 'card',
          tag: 'div',
          rect: { left: 10, top: 10, width: 355, height: 100 },
          styles: { hasBorder: true, borderRadius: '8px' },
          children: [
            makeNode({
              id: 'text',
              tag: 'p',
              rect: { left: 20, top: 20, width: 300, height: 20 },
              isLeaf: true,
            }),
          ],
        }),
      ],
    })
    const bones = extractBones(tree, { captureRoundedBorders: true })
    expect(bones.some(b => b.c === true)).toBe(true)
  })
})

// ─── 固定宽度约束 ─────────────────────────────────────────────────────────────

describe('extractBones - 固定宽度约束', () => {
  it('isFixedWidth=true 的叶节点设 minW===maxW===w', () => {
    const tree = makeNode({
      id: 'root',
      rect: { left: 0, top: 0, width: 375, height: 200 },
      children: [
        makeNode({
          id: 'avatar',
          tag: 'img',
          rect: { left: 10, top: 10, width: 40, height: 40 },
          styles: { isFixedWidth: true, isFixedHeight: true },
          isLeaf: true,
        }),
      ],
    })
    const bones = extractBones(tree)
    expect(bones).toHaveLength(1)
    const b = bones[0]
    expect(b.minW).toBe(b.w)
    expect(b.maxW).toBe(b.w)
    expect(b.minH).toBe(b.h)
    expect(b.maxH).toBe(b.h)
  })

  it('宽度 < 父宽 40% 的叶节点也被视为固定宽度', () => {
    const tree = makeNode({
      id: 'root',
      rect: { left: 0, top: 0, width: 375, height: 200 },
      children: [
        makeNode({
          id: 'badge',
          tag: 'span',
          rect: { left: 10, top: 10, width: 60, height: 24 },  // 60/375=16% < 40%
          isLeaf: true,
        }),
      ],
    })
    const bones = extractBones(tree, { fixedWidthThreshold: 0.4 })
    expect(bones[0].minW).toBe(bones[0].w)
    expect(bones[0].maxW).toBe(bones[0].w)
  })

  it('CSS min-width 转为百分比', () => {
    const tree = makeNode({
      id: 'root',
      rect: { left: 0, top: 0, width: 375, height: 200 },
      children: [
        makeNode({
          id: 'btn',
          tag: 'button',
          rect: { left: 10, top: 10, width: 200, height: 40 },  // 200 > 375*0.4=150，不触发 isFixedWidth
          styles: { minWidth: 80 },  // 80px
          isLeaf: true,
        }),
      ],
    })
    const bones = extractBones(tree)
    const b = bones[0]
    expect(b.minW).toBeCloseTo((80 / 375) * 100, 1)
  })
})

// ─── 可见性过滤 ────────────────────────────────────────────────────────────────

describe('extractBones - 可见性过滤', () => {
  it('display:none 节点被跳过', () => {
    const tree = makeNode({
      id: 'root',
      rect: { left: 0, top: 0, width: 375, height: 200 },
      children: [
        makeNode({
          id: 'hidden',
          tag: 'div',
          styles: { display: 'none' },
          isLeaf: true,
        }),
        makeNode({
          id: 'visible',
          tag: 'p',
          rect: { left: 0, top: 0, width: 300, height: 20 },
          isLeaf: true,
        }),
      ],
    })
    const bones = extractBones(tree)
    expect(bones).toHaveLength(1)
  })

  it('opacity:0 节点被跳过', () => {
    const tree = makeNode({
      id: 'root',
      rect: { left: 0, top: 0, width: 375, height: 200 },
      children: [
        makeNode({
          id: 'hidden',
          tag: 'p',
          rect: { left: 0, top: 0, width: 300, height: 20 },
          styles: { opacity: '0' },
          isLeaf: true,
        }),
      ],
    })
    const bones = extractBones(tree)
    expect(bones).toHaveLength(0)
  })

  it('尺寸太小节点被跳过', () => {
    const tree = makeNode({
      id: 'root',
      rect: { left: 0, top: 0, width: 375, height: 200 },
      children: [
        makeNode({
          id: 'tiny',
          tag: 'div',
          rect: { left: 0, top: 0, width: 2, height: 2 },  // 小于 minW/minH=4
          isLeaf: true,
        }),
      ],
    })
    const bones = extractBones(tree, { minW: 4, minH: 4 })
    expect(bones).toHaveLength(0)
  })
})

// ─── 叶节点标签 ────────────────────────────────────────────────────────────────

describe('extractBones - 叶节点标签', () => {
  it('ATOMIC_LEAF_TAGS（img/svg/button 等）视为叶节点', () => {
    const imgNode = makeNode({
      id: 'root',
      rect: { left: 0, top: 0, width: 375, height: 200 },
      children: [
        makeNode({
          id: 'img',
          tag: 'img',
          rect: { left: 0, top: 0, width: 100, height: 100 },
          // 无 isLeaf 标记，通过标签判定
          isLeaf: false,
          children: [],
        }),
      ],
    })
    const bones = extractBones(imgNode)
    expect(bones).toHaveLength(1)
  })

  it('config.leafTags 追加语义叶节点', () => {
    const tree = makeNode({
      id: 'root',
      rect: { left: 0, top: 0, width: 375, height: 200 },
      children: [
        makeNode({
          id: 'section',
          tag: 'section',
          rect: { left: 0, top: 0, width: 375, height: 100 },
          children: [
            makeNode({
              id: 'inner',
              tag: 'span',
              rect: { left: 0, top: 0, width: 200, height: 20 },
              isLeaf: true,
            }),
          ],
        }),
      ],
    })

    // 不加 leafTags 时 section 递归进入子节点
    const bonesWithout = extractBones(tree)
    expect(bonesWithout).toHaveLength(1) // 只有 span

    // 加 leafTags: ['section'] 时 section 整体为叶
    const bonesWith = extractBones(tree, { leafTags: ['section'] })
    expect(bonesWith).toHaveLength(1)
    expect(bonesWith[0].w).toBeCloseTo(100, 0) // section 宽度 100%
  })
})

// ─── 排除标签 ─────────────────────────────────────────────────────────────────

describe('extractBones - excludeTags', () => {
  it('excludeTags 跳过节点及其子树', () => {
    const tree = makeNode({
      id: 'root',
      rect: { left: 0, top: 0, width: 375, height: 200 },
      children: [
        makeNode({
          id: 'nav',
          tag: 'nav',
          rect: { left: 0, top: 0, width: 375, height: 50 },
          children: [
            makeNode({
              id: 'link',
              tag: 'a',
              rect: { left: 10, top: 10, width: 60, height: 30 },
              isLeaf: true,
            }),
          ],
        }),
        makeNode({
          id: 'content',
          tag: 'p',
          rect: { left: 0, top: 60, width: 375, height: 20 },
          isLeaf: true,
        }),
      ],
    })
    const bones = extractBones(tree, { excludeTags: ['nav'] })
    expect(bones).toHaveLength(1)
    // 只有 content 被捕获，nav 被排除
    expect(bones.length).toBe(1)
  })
})

// ─── 拓扑压缩集成 ──────────────────────────────────────────────────────────────

describe('extractBonesWithStats', () => {
  it('返回骨骼和统计信息', () => {
    const tree = makeSimpleTree()
    const { bones, stats } = extractBonesWithStats(tree)
    expect(bones).toHaveLength(2)
    expect(stats.originalCount).toBeGreaterThan(0)
  })
})

// ─── packSkeletonData ─────────────────────────────────────────────────────────

describe('packSkeletonData', () => {
  it('aspectRatio 正确计算', () => {
    const root = makeNode({ rect: { left: 0, top: 0, width: 375, height: 250 } })
    const bones = extractBones(root)
    const data = packSkeletonData(bones, root.rect, 'test-card')
    expect(data.aspectRatio).toBeCloseTo(375 / 250, 2)
    expect(data.capturedWidth).toBe(375)
    expect(data.name).toBe('test-card')
    expect(data.version).toBe(2)
  })

  it('空骨骼树时 aspectRatio 为 1', () => {
    const data = packSkeletonData([], { left: 0, top: 0, width: 0, height: 0 }, 'empty')
    expect(data.aspectRatio).toBe(1)
  })
})
