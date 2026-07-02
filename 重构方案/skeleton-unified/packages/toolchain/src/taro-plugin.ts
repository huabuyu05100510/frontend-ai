/**
 * @skeleton/toolchain - Taro 构建插件
 *
 * 在 Taro 构建期间自动生成骨架屏数据。
 *
 * 工作原理（两种模式）：
 *
 * 模式 A：H5 Dev Server 模式（等同 Vite 插件）
 *   - Taro H5 编译后启动 dev server
 *   - Playwright 访问路由，执行 __SKE_SNAPSHOT，生成 .bones.json
 *
 * 模式 B：小程序编译时静态分析（实验性）
 *   - 扫描源码中的 data-ske-node 属性
 *   - 结合 mockData 生成骨架描述符（SkeletonDescriptor）
 *   - 用 computeLayout 计算布局，写入 .bones.json
 *   - 限制：只能处理静态结构，动态内容需运行时捕获
 *
 * 配置（taro.config.ts 或 app.config.ts）：
 * ```ts
 * import { skeletonTaroPlugin } from '@skeleton/toolchain/taro'
 * // config.plugins = [skeletonTaroPlugin({ routes: ['/pages/index/index'] })]
 * ```
 *
 * 小程序运行时捕获（补充方案）：
 * 用 <SkeletonTaro> 组件 + onCapture 回调，在真机/模拟器上捕获后上传到服务端存储。
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { SkeletonData, ResponsiveSkeletonData } from '@skeleton/core'
import { fnv1a32 } from '@skeleton/core'

// ─── 配置类型 ─────────────────────────────────────────────────────────────────

export interface SkeletonTaroPluginConfig {
  /**
   * H5 路由列表（Taro H5 模式）。
   * 格式：Taro 路由路径，如 '/pages/index/index'
   */
  routes?: string[]
  /** 视口断点（px），默认 [375, 750] */
  breakpoints?: number[]
  /** 输出目录，默认 'src/bones' */
  outDir?: string
  /**
   * 是否启用小程序静态分析（实验性）。
   * 默认 false（建议先用 H5 模式）
   */
  staticAnalysis?: boolean
}

// ─── Taro 插件格式 ────────────────────────────────────────────────────────────

interface TaroPlugin {
  /** 插件名 */
  name: string
  /** Taro 生命周期钩子 */
  onBuildStart?: (ctx: TaroBuildContext) => void | Promise<void>
  onBuildFinish?: (ctx: TaroBuildContext) => void | Promise<void>
  onCompilerMessage?: (msg: string) => void
  ctx?: TaroBuildContext
}

interface TaroBuildContext {
  paths: {
    appPath: string
    sourcePath: string
    outputPath: string
  }
  runnerUtils: unknown
  helper: unknown
}

// ─── 插件主体 ─────────────────────────────────────────────────────────────────

/**
 * Taro 骨架屏构建插件。
 *
 * @example
 * // config/index.ts（Taro 4.x）
 * import { skeletonTaroPlugin } from '@skeleton/toolchain/taro'
 *
 * const config = {
 *   plugins: [
 *     ['@skeleton/toolchain/taro', {
 *       routes: ['/pages/index/index', '/pages/detail/detail'],
 *       breakpoints: [375, 750],
 *       outDir: 'src/bones',
 *     }]
 *   ]
 * }
 */
export function skeletonTaroPlugin(config: SkeletonTaroPluginConfig = {}): TaroPlugin {
  const {
    routes = ['/pages/index/index'],
    breakpoints = [375, 750],
    outDir = 'src/bones',
  } = config

  return {
    name: 'skeleton-taro-plugin',

    ctx: undefined,

    onBuildStart(_ctx: TaroBuildContext) {
      console.log('[skeleton-taro] 构建插件已加载', { routes, breakpoints })
    },

    async onBuildFinish(ctx: TaroBuildContext) {
      // H5 模式：启动 Playwright 捕获
      // 注意：Taro H5 dev server 端口通常是 10086 或 80
      const { appPath } = ctx.paths
      const outDirAbs = join(appPath, outDir)

      if (!existsSync(outDirAbs)) {
        mkdirSync(outDirAbs, { recursive: true })
      }

      console.log('[skeleton-taro] 构建完成，可以启动 dev server 后运行骨架捕获')
      console.log('[skeleton-taro] 运行: pnpm skeleton capture --config skeleton.taro.json')
    },
  }
}

// ─── 便利函数：保存小程序运行时捕获结果 ──────────────────────────────────────

/**
 * 保存小程序运行时捕获的骨架数据到本地文件（开发服务器接口调用）。
 * 配合服务端 /skeleton/save 接口使用。
 */
export function saveMPBones(
  outDir: string,
  name: string,
  data: SkeletonData,
): void {
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true })
  }

  const responsive: ResponsiveSkeletonData & { _hash?: string } = {
    breakpoints: { [data.capturedWidth]: data },
    _hash: fnv1a32(JSON.stringify(data)),
  }

  const filePath = join(outDir, `${name}.bones.json`)
  writeFileSync(filePath, JSON.stringify(responsive, null, 2), 'utf-8')
  console.log(`[skeleton-taro] 保存骨架: ${filePath}`)
}
