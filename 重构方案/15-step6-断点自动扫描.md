# 15 · Step 6 · 断点自动扫描

> 断点不该让开发者手填。最终断点集 = **默认 ∪ 自动扫描（CSS @media / Tailwind / 运行时 styleSheets）∪ 开发者 extend**，去重升序。
> v2 修订：**默认值按平台分**（三端经验值不同），自动扫描仅 Web 适用。

---

## 1. 目标

1. **三源扫描**：CSS @media + Tailwind screens + 运行时 styleSheets（**仅 Web**）
2. **三端默认值各异**（v2 修订）：

   | 平台 | 默认断点 | 自动扫描 | 经验依据 |
   |---|---|---|---|
   | **Web** | `[375, 768, 1280]` | 启用 | iPhone 标准 / iPad / 桌面 |
   | **RN** | `[375, 414]` | 关闭 | iPhone 标准 / 大屏（Plus/Max）；iPad 同 414 兼容；RN 无 CSS @media 可扫 |
   | **小程序** | `[375, 414]` | 关闭 | 设备物理宽度；rpx=750 设计稿换算后自适应；Taro H5 模式可借 Web 扫描，编译期再映射回 mp |

3. **可追溯**：每个断点在 bones.json `_meta.breakpointSource` 标明出处（default / scanned / extended）
4. **噪声治理**：相邻断点差 < 24px（Web 默认；RN/MP 默认 16px）自动合并
5. **覆盖率**：Web 项目自动 ≥ 95%，Tailwind 默认 100%；RN/MP 走经验值即可

---

## 2. 前置依赖

- 项目使用 Vite 或 webpack（postcss 可获取）
- 可选：Tailwind `tailwind.config.{js,ts,cjs,mjs}`

---

## 3. 关键设计

### 3.1 三源扫描器（v2 按平台分）

```ts
// packages/smarty/src/cli/breakpoint-scan.ts
export interface BreakpointScanResult {
  default: number[]
  scanned: number[]          // 来自 CSS @media + Tailwind（仅 web）
  runtime?: number[]         // dev:ske 浏览端 styleSheets（仅 web）
  extended: number[]
}

export function scan(opts: {
  projectRoot: string
  config: SkeletonConfig
  platform: 'web' | 'rn' | 'mp'         // v2 新增
  entryFile?: string
}): BreakpointScanResult {
  // v2: 按平台读各自配置
  const cfg = opts.config.breakpoints[opts.platform]
  const { default: dft, autoScan, source = [], extend } = cfg

  // RN / MP 一律不扫描，直接用默认 + extend
  if (opts.platform !== 'web' || !autoScan) {
    return { default: dft, scanned: [], extended: extend }
  }

  // Web 走三源扫描
  const scanned = new Set<number>()
  if (source.includes('css'))      scanCssMedia(opts.entryFile ?? opts.projectRoot, scanned)
  if (source.includes('tailwind')) scanTailwind(opts.projectRoot, scanned)
  return { default: dft, scanned: [...scanned], extended: extend }
}
```

### 3.2 CSS @media 扫描

```ts
import postcss from 'postcss'
import { readFileSync } from 'node:fs'

function scanCssMedia(entryFile: string, out: Set<number>): void {
  const styleFiles = collectStyleImports(entryFile)
  for (const f of styleFiles) {
    let css: string
    try { css = readFileSync(f, 'utf8') } catch { continue }
    postcss.parse(css).walkAtRules('media', (rule) => {
      for (const m of rule.params.matchAll(/(?:min|max)-width:\s*(\d+)\s*px/gi))
        out.add(Number(m[1]))
    })
  }
}

function collectStyleImports(entry: string): string[] {
  // 1. 顺 import/require 链找 .css/.scss/.less/.module.css 文件
  // 2. 含 styled-components/emotion 的 .ts/.tsx，扫描 `@media` 字符串
  // 3. 排除 node_modules（可配）
  // ...简化实现：用 esbuild metafile 或 vite getModuleGraph()
}
```

styled-components / emotion 字符串内的 `@media`：

```ts
function scanCssInJs(file: string, out: Set<number>): void {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/@media\s*\([^)]*(?:min|max)-width:\s*(\d+)\s*px/g))
    out.add(Number(m[1]))
}
```

### 3.3 Tailwind 扫描

```ts
import { pathToFileURL } from 'node:url'

async function scanTailwind(root: string, out: Set<number>): Promise<void> {
  const candidates = ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs']
  for (const c of candidates) {
    const path = resolve(root, c)
    if (!existsSync(path)) continue
    try {
      const mod = await import(pathToFileURL(path).href)
      const screens = mod.default?.theme?.screens ?? mod.theme?.screens ?? {}
      for (const v of Object.values(screens)) {
        if (typeof v === 'string') {
          const m = v.match(/^(\d+)px$/)
          if (m) out.add(Number(m[1]))
        } else if (typeof v === 'object' && v && 'min' in v) {
          const m = String((v as any).min).match(/^(\d+)px$/)
          if (m) out.add(Number(m[1]))
        }
      }
      return
    } catch (e) { /* 忽略，降级 */ }
  }
}
```

### 3.4 运行时 styleSheets（dev:ske 浏览端兜底）

dev:ske 模式下，BGv2 在浏览器执行时同时扫一次：

```ts
// 浏览器侧
function runtimeBreakpoints(): number[] {
  const set = new Set<number>()
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | undefined
    try { rules = sheet.cssRules } catch { continue }   // 跨域抛错，跳过
    for (const rule of Array.from(rules ?? [])) {
      if (rule instanceof CSSMediaRule)
        for (const m of rule.media.mediaText.matchAll(/(\d+)\s*px/g)) set.add(Number(m[1]))
    }
  }
  return [...set]
}
```

DevSave POST payload 带 `runtimeBreakpoints`，server 侧合并写入 `bones.json._meta.breakpointSource.runtime`。

### 3.5 合并 & 噪声治理

```ts
export function resolveBreakpoints(scan: BreakpointScanResult, cfg: BreakpointConfig): number[] {
  const all = [...new Set([
    ...(scan.default ?? []),
    ...(scan.scanned ?? []),
    ...(scan.runtime ?? []),
    ...(scan.extended ?? []),
  ])]
  return all
    .filter(w => w >= (cfg.min ?? 320) && w <= (cfg.max ?? 1920))
    .sort((a, b) => a - b)
    .reduce<number[]>((acc, w) => {
      if (acc.length === 0 || w - acc[acc.length - 1] >= (cfg.mergeGap ?? 24)) acc.push(w)
      return acc
    }, [])
}
```

合并保留**靠左**的（min-width 语义友好）；若业务希望取较大者，加 `mergeStrategy: 'left'|'right'`，留作后续扩展。

### 3.6 验证：每个断点都会被捕获一次

`smarty build` 对每个 page 在每个断点跑一次 Playwright；DevSave 仅在用户当前视口宽度上写入。这意味着断点扫描的输出会驱动 **`build` 命令的 viewport 数量**，所以扫描错误（漏 / 多）会直接影响 CI 体积。

---

## 4. 文件改动清单

| 路径 | 操作 |
|---|---|
| `packages/smarty/src/cli/breakpoint-scan.ts` | 新增 |
| `packages/smarty/src/cli/style-imports.ts` | 新增（收集 import 链） |
| `packages/smarty/src/generator/runtime-breakpoints.ts` | 新增（浏览器侧） |
| `packages/smarty/src/cli/build.ts` | **修改**：build 前先 `scan()` → `resolveBreakpoints()` |
| `packages/smarty/src/web/vite-plugin.ts` | **修改**：DevSave POST 接受 runtimeBreakpoints |
| `packages/smarty/test/breakpoint-scan.test.ts` | 新增 |

---

## 5. 验收

| 检查 | 方法 |
|---|---|
| CSS `@media (max-width: 768px)` 被扫到 | unit |
| Tailwind 默认 `sm/md/lg/xl/2xl` 全部识别为 px | unit |
| styled-components `${({theme})=> \`@media (min-width: ${theme.bp.lg})\`}` 不漏 | unit |
| dev:ske 浏览端运行时 styleSheets 合并 | playwright |
| mergeGap=24 时 [375,392,768] → [375,768] | unit |
| 跨域 styleSheet `cssRules` 抛错被 try/catch | unit |
| `_meta.breakpointSource` 三段齐全 | snapshot |
| 业务无 Tailwind 时不报错 | unit |

---

## 6. 已知坑 & 测试用例

1. **`rem` / `em` / `vw` 断点**：本扫描只识别 `px`，其它单位忽略。若业务用 rem，文档要求显式 `extend` 写入 px 值（root font-size ≈ 16 默认）
2. **CSS Module `@media` 在 `:global`**：postcss 同样能扫到，无问题
3. **第三方组件库样式**：node_modules 内的 @media 默认不扫；如需扫，`source: ['css', 'tailwind', 'node_modules']`
4. **Tailwind v4 CSS-first 配置**：v4 用 CSS `@theme` 语法（而非 JS config），需扫 `.css` 中 `@theme` 块——v4 支持留作扩展
5. **极端断点**：用户写 `@media (min-width: 1px)` → 在 `min=320` 过滤掉；记得在 dev:ske 日志输出"扫到 N 个，过滤后剩 M 个"以便排查
