/**
 * @skeleton/toolchain 测试
 *
 * 测试可导出的纯函数（不依赖 Playwright / Vite dev server）：
 * - saveMPBones：写入文件
 * - skeletonTaroPlugin：返回正确的插件对象
 * - skeletonPlugin：返回正确的 Vite Plugin 对象
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { SkeletonData } from '@skeleton/core'
import { saveMPBones, skeletonTaroPlugin } from '../taro-plugin.ts'
import { skeletonPlugin } from '../vite-plugin.ts'
import { injectIntoComponent } from '../cli.ts'

// ─── 测试数据 ─────────────────────────────────────────────────────────────────

const sampleData: SkeletonData = {
  name: 'product-card',
  aspectRatio: 1.875,
  capturedWidth: 375,
  version: 2,
  bones: [
    [2.67, 5, 94.67, 10],
    [2.67, 20, 60, 10],
  ],
  capturedAt: 1700000000000,
  platform: 'web',
}

// ─── saveMPBones ──────────────────────────────────────────────────────────────

describe('saveMPBones', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ske-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('写入 .bones.json 文件', () => {
    saveMPBones(tmpDir, 'product-card', sampleData)
    expect(existsSync(join(tmpDir, 'product-card.bones.json'))).toBe(true)
  })

  it('文件内容包含 breakpoints 结构', () => {
    saveMPBones(tmpDir, 'product-card', sampleData)
    const parsed = JSON.parse(readFileSync(join(tmpDir, 'product-card.bones.json'), 'utf-8'))
    expect(parsed.breakpoints).toBeDefined()
    expect(parsed.breakpoints[375]).toBeDefined()
    expect(parsed.breakpoints[375].name).toBe('product-card')
  })

  it('文件内容包含 _hash 字段', () => {
    saveMPBones(tmpDir, 'product-card', sampleData)
    const parsed = JSON.parse(readFileSync(join(tmpDir, 'product-card.bones.json'), 'utf-8'))
    expect(parsed._hash).toBeDefined()
    expect(typeof parsed._hash).toBe('string')
    expect(parsed._hash.length).toBeGreaterThan(0)
  })

  it('_hash 对相同数据稳定（幂等）', () => {
    saveMPBones(tmpDir, 'product-card', sampleData)
    const hash1 = JSON.parse(readFileSync(join(tmpDir, 'product-card.bones.json'), 'utf-8'))._hash
    saveMPBones(tmpDir, 'product-card', sampleData)
    const hash2 = JSON.parse(readFileSync(join(tmpDir, 'product-card.bones.json'), 'utf-8'))._hash
    expect(hash1).toBe(hash2)
  })

  it('不同数据产生不同 _hash', () => {
    const otherData: SkeletonData = { ...sampleData, aspectRatio: 2.5, bones: [] }
    saveMPBones(tmpDir, 'a', sampleData)
    saveMPBones(tmpDir, 'b', otherData)
    const h1 = JSON.parse(readFileSync(join(tmpDir, 'a.bones.json'), 'utf-8'))._hash
    const h2 = JSON.parse(readFileSync(join(tmpDir, 'b.bones.json'), 'utf-8'))._hash
    expect(h1).not.toBe(h2)
  })

  it('outDir 不存在时自动创建', () => {
    const nested = join(tmpDir, 'sub', 'bones')
    saveMPBones(nested, 'card', sampleData)
    expect(existsSync(join(nested, 'card.bones.json'))).toBe(true)
  })
})

// ─── skeletonTaroPlugin ───────────────────────────────────────────────────────

describe('skeletonTaroPlugin', () => {
  it('返回插件对象，name = skeleton-taro-plugin', () => {
    const plugin = skeletonTaroPlugin()
    expect(plugin.name).toBe('skeleton-taro-plugin')
  })

  it('有 onBuildStart 和 onBuildFinish 钩子', () => {
    const plugin = skeletonTaroPlugin()
    expect(typeof plugin.onBuildStart).toBe('function')
    expect(typeof plugin.onBuildFinish).toBe('function')
  })

  it('接受自定义 routes / breakpoints / outDir', () => {
    const plugin = skeletonTaroPlugin({
      routes: ['/pages/home/index'],
      breakpoints: [375, 750],
      outDir: 'src/custom-bones',
    })
    expect(plugin.name).toBe('skeleton-taro-plugin')
  })

  it('onBuildFinish 在 outDir 不存在时自动创建目录', async () => {
    const tmpBase = join(tmpdir(), `ske-taro-${Date.now()}`)
    mkdirSync(tmpBase, { recursive: true })
    // outDir 传相对路径（插件内部做 join(appPath, outDir)）
    const relOut = 'src/bones-auto'
    const outPath = join(tmpBase, relOut)

    try {
      const plugin = skeletonTaroPlugin({ outDir: relOut })
      const ctx = {
        paths: { appPath: tmpBase, sourcePath: tmpBase, outputPath: tmpBase },
        runnerUtils: {},
        helper: {},
      }
      // @ts-expect-error ctx 类型在测试中简化
      await plugin.onBuildFinish!(ctx)
      expect(existsSync(outPath)).toBe(true)
    } finally {
      rmSync(tmpBase, { recursive: true, force: true })
    }
  })
})

// ─── skeletonPlugin（Vite 插件形状）──────────────────────────────────────────

describe('skeletonPlugin', () => {
  it('返回 Vite Plugin，name = skeleton-unified', () => {
    const plugin = skeletonPlugin()
    expect(plugin.name).toBe('skeleton-unified')
  })

  it('apply = serve（仅开发模式）', () => {
    const plugin = skeletonPlugin()
    expect(plugin.apply).toBe('serve')
  })

  it('有 configureServer 钩子', () => {
    const plugin = skeletonPlugin()
    expect(typeof plugin.configureServer).toBe('function')
  })

  it('接受自定义配置', () => {
    const plugin = skeletonPlugin({
      routes: ['/', '/product'],
      breakpoints: [375, 1280],
      outDir: 'src/bones',
      startDelay: 3000,
      debug: true,
    })
    expect(plugin.name).toBe('skeleton-unified')
  })
})

// ─── injectIntoComponent ──────────────────────────────────────────────────────

describe('injectIntoComponent', () => {
  let tmpDir: string

  const COMPONENT_A = `import React from 'react'

function ProductCard() {
  return (
    <div className="card">
      <h1>Title</h1>
    </div>
  )
}

export default ProductCard
`

  const COMPONENT_B = `import React from 'react'

const Badge = () => <span className="badge">text</span>

export default Badge
`

  const COMPONENT_ALREADY = `import React from 'react'
import { Skeleton } from '@skeleton/renderer-react'
import productCardBones from './bones/product-card.bones.json'

function ProductCard() {
  return (
    <Skeleton loading={loading} bones={productCardBones} animation="shimmer">
      <div>...</div>
    </Skeleton>
  )
}
`

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ske-inject-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(tmpDir, 'src/bones'), { recursive: true })
    // 预先创建 bones 文件（实际场景下服务器先写它）
    writeFileSync(join(tmpDir, 'src/bones/product-card.bones.json'), '{}')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('文件不存在时返回 ok=false', () => {
    const result = injectIntoComponent({
      projectRoot: tmpDir,
      filePath: 'src/NoExist.tsx',
      name: 'product-card',
      outDir: 'src/bones',
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('不存在')
  })

  it('Pattern A：注入 import + 包裹 return (\\n  <...>)', () => {
    writeFileSync(join(tmpDir, 'src/ProductCard.tsx'), COMPONENT_A)
    const result = injectIntoComponent({
      projectRoot: tmpDir,
      filePath: 'src/ProductCard.tsx',
      name: 'product-card',
      outDir: 'src/bones',
    })
    expect(result.ok).toBe(true)
    const out = readFileSync(join(tmpDir, 'src/ProductCard.tsx'), 'utf-8')
    expect(out).toContain(`import { Skeleton } from '@skeleton/renderer-react'`)
    expect(out).toContain(`productCardBones`)
    expect(out).toContain(`<Skeleton`)
    expect(out).toContain(`</Skeleton>`)
  })

  it('Pattern B：注入 import + 包裹单行 return <...>', () => {
    writeFileSync(join(tmpDir, 'src/Badge.tsx'), COMPONENT_B)
    const result = injectIntoComponent({
      projectRoot: tmpDir,
      filePath: 'src/Badge.tsx',
      name: 'product-card',
      outDir: 'src/bones',
    })
    expect(result.ok).toBe(true)
    const out = readFileSync(join(tmpDir, 'src/Badge.tsx'), 'utf-8')
    expect(out).toContain(`<Skeleton`)
    expect(out).toContain(`</Skeleton>`)
  })

  it('幂等：已有 <Skeleton 时不重复包裹', () => {
    writeFileSync(join(tmpDir, 'src/ProductCard.tsx'), COMPONENT_ALREADY)
    const result = injectIntoComponent({
      projectRoot: tmpDir,
      filePath: 'src/ProductCard.tsx',
      name: 'product-card',
      outDir: 'src/bones',
    })
    expect(result.ok).toBe(true)
    const out = readFileSync(join(tmpDir, 'src/ProductCard.tsx'), 'utf-8')
    // <Skeleton 只出现一次（不重复包裹）
    const count = (out.match(/<Skeleton/g) ?? []).length
    expect(count).toBe(1)
  })

  it('import 语句幂等（多次调用不重复注入）', () => {
    writeFileSync(join(tmpDir, 'src/ProductCard.tsx'), COMPONENT_A)
    injectIntoComponent({ projectRoot: tmpDir, filePath: 'src/ProductCard.tsx', name: 'product-card', outDir: 'src/bones' })
    injectIntoComponent({ projectRoot: tmpDir, filePath: 'src/ProductCard.tsx', name: 'product-card', outDir: 'src/bones' })
    const out = readFileSync(join(tmpDir, 'src/ProductCard.tsx'), 'utf-8')
    const importCount = (out.match(/import \{ Skeleton \}/g) ?? []).length
    expect(importCount).toBe(1)
  })
})
