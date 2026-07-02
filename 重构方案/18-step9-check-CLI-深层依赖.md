# 18 · Step 9 · check CLI 与严格深层依赖

> CI 同步校验：判定 `bones/` 下的产物是否与源码一致；不一致即 STALE / MISSING / DRIFT，CI 失败。
> 依赖检测用 **esbuild metafile + 深度 5 + ignore glob**（D3，[00 §1](./00-总览与决策锚点.md)）——零额外 AST 解析、跨 Vite/webpack/Rspack 通用。

---

## 1. 目标

1. **三种状态判定**（v2 重要：**只看 `bones/`，完全忽略 `.smarty-cache/`**）：
   - `MISSING`：源码里有 `<Skeleton name="x">` 但 `bones/pages/web/x.bones.json` 不存在
   - `STALE`：bones 存在但 `_sourceHash` ≠ 当前依赖图内容 hash
   - `DRIFT`（仅 region 类）：源码里 `<Bound deps>` 与 `bones/regions/web/bindings.json[region].deps` 不一致
2. **CI 不依赖 Playwright**：`check` 只读文件系统 + 算 hash，秒级完成
3. **CI 友好**：`--ci` 输出 JSON + 非零退出码 + 可被 GitHub Actions annotation 消费
4. **本地快速**：`--staged` 只检查 git 暂存涉及的 `<Skeleton>`，~ 100ms

---

## 2. 前置依赖

- 项目已使用 esbuild 或 Vite（Vite 内部用 esbuild）
- bones 文件已由 [16-step7 DevSave](./16-step7-DevSave-与dev-ske.md) 或 [17-step8 build](./17-step8-Playwright批量与Visual-Diff.md) 产出，且 `_meta.sourceHash` 字段齐全

---

## 3. 关键设计

### 3.1 依赖图构建：esbuild metafile

```ts
// packages/smarty/src/cli/dep-graph.ts
import { build, type Metafile } from 'esbuild'
import { resolve } from 'node:path'

export async function buildDepGraph(opts: {
  cwd: string
  entries: string[]                   // 业务入口（src/index.tsx 等）
  tsconfig?: string
}): Promise<DepGraph> {
  const result = await build({
    entryPoints: opts.entries,
    bundle: true,
    write: false,
    metafile: true,
    sourcemap: false,
    outdir: 'dist-meta-only',         // 仅占位，write:false 不真写
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    tsconfig: opts.tsconfig,
    loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty' },  // 不解析非代码
    logLevel: 'silent',
  })
  return parseMetafile(result.metafile!, opts.cwd)
}

interface DepGraph {
  /** file (relative) → direct imports (relative) */
  deps: Map<string, string[]>
}

function parseMetafile(meta: Metafile, cwd: string): DepGraph {
  const deps = new Map<string, string[]>()
  for (const [file, info] of Object.entries(meta.inputs)) {
    const rel = file.replace(/^.*?node_modules\/(.*)/, 'node_modules/$1')
    deps.set(rel, info.imports.map(i => i.path))
  }
  return { deps }
}
```

### 3.2 反向收集深度 5 内的依赖闭包

```ts
// packages/smarty/src/cli/collect-deps.ts
export function collectDeps(
  graph: DepGraph, root: string, depth: number, ignoreGlobs: string[],
): { deps: string[]; outOfDepth: string[] } {
  const matchIgnore = makeMatcher(ignoreGlobs)
  const seen = new Set<string>([root])
  const out: string[] = []
  const outOfDepth: string[] = []
  const queue: Array<{ file: string; level: number }> = [{ file: root, level: 0 }]
  while (queue.length) {
    const { file, level } = queue.shift()!
    if (matchIgnore(file)) continue
    if (level > depth) { outOfDepth.push(file); continue }
    out.push(file)
    for (const child of graph.deps.get(file) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      queue.push({ file: child, level: level + 1 })
    }
  }
  return { deps: out.sort(), outOfDepth: outOfDepth.sort() }
}
```

### 3.3 内容 hash

```ts
// packages/smarty/src/core/hash.ts
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'

export function hashFiles(files: string[], cwd: string): string {
  const hash = createHash('sha256')
  for (const f of files) {
    const abs = resolve(cwd, f)
    try {
      hash.update(f)
      hash.update('\0')
      hash.update(readFileSync(abs))
      hash.update('\0')
    } catch { /* 文件被删 → 跳过，会被 STALE 触发 */ }
  }
  return hash.digest('hex')
}
```

### 3.4 主流程

```ts
// packages/smarty/src/cli/check.ts
export async function check(opts: CheckOptions): Promise<CheckReport> {
  const config = resolveConfig(opts.cwd)
  const sources = await scanSkeletonSources(opts.cwd)        // 找所有 <Skeleton name> / <Bound id>
  const graph = await buildDepGraph({
    cwd: opts.cwd,
    entries: config.entries ?? autoDetectEntries(opts.cwd),
    tsconfig: config.tsconfig,
  })

  const report: CheckReport = { ok: [], missing: [], stale: [], drift: [], outOfDepth: [] }

  for (const source of sources) {
    const target = bonesPath(source, config)
    if (!existsSync(target)) { report.missing.push(source.name); continue }

    const bones = JSON.parse(await readFile(target, 'utf8'))
    const { deps, outOfDepth } = collectDeps(
      graph, source.sourceFile, config.check.depth, config.check.ignoreGlobs,
    )
    const sourceHash = hashFiles(deps, opts.cwd)

    if (bones._meta.sourceHash !== sourceHash) {
      report.stale.push({
        name: source.name,
        sourceFile: source.sourceFile,
        depsCount: deps.length,
        changedSince: bones._meta.builtAt,
      })
    } else {
      report.ok.push(source.name)
    }
    if (outOfDepth.length) report.outOfDepth.push({ name: source.name, files: outOfDepth })

    // DRIFT 检测（仅 api）
    if (source.kind === 'api') {
      const bindings = readBindings(config)
      const recorded = bindings.regions[source.region]?.deps ?? []
      if (!sameSet(source.deps, recorded)) report.drift.push({
        region: source.region, source: source.deps, recorded,
      })
    }
  }

  return report
}
```

### 3.5 CLI 形态

```bash
# 默认：人类可读
boneyard check

  checking 8 skeletons...
  ✓  home               up to date
  ✓  hero-banner        up to date
  ❌  user-profile       STALE  (src/components/UserCard.tsx + 3 deps changed)
  ❌  search-results     MISSING (bones/pages/web/search-results.bones.json)
  ⚠  out-of-depth       order-list (12 transitive deps > depth 5)
  ❌  recommend-rail    DRIFT  source deps: [query:user, query:recommend]  bindings.json: [query:user]
  ✓  dashboard-widget   up to date
  ✓  stats-card         up to date

  4 issue(s). Run:  pnpm dev:ske  (open the affected pages)  OR  pnpm build

  exit 1

# --ci --json：CI 用
boneyard check --ci --json
{
  "ok": [...],
  "missing": [...],
  "stale": [...],
  "drift": [...],
  "outOfDepth": [...],
  "exitCode": 1
}

# --staged：仅检查 git staged 文件相关的骨架
boneyard check --staged
```

### 3.6 `--staged` 实现

```ts
function getStagedSources(cwd: string): SkeletonSource[] {
  const stagedFiles = execSync('git diff --cached --name-only', { cwd, encoding: 'utf8' })
    .trim().split('\n')
    .filter(f => /\.(tsx|jsx|ts|js|vue|svelte)$/.test(f))
  const all = scanSkeletonSourcesSync(cwd)
  return all.filter(s => stagedFiles.includes(s.sourceFile))
}
```

### 3.7 反向影响图（增量）

依赖 X 改了 → 谁的骨架 STALE？维护反向索引：

```
src/components/design-tokens.ts → [user-card, header, order-list, ...]
```

`--staged` 改的依赖文件如果不在任何 `<Skeleton>` 的 deps 闭包内 → 跳过；否则触发对应 region 的 hash 重算。

---

## 4. 文件改动清单

| 路径 | 操作 |
|---|---|
| `packages/smarty/src/cli/check.ts` | 新增 |
| `packages/smarty/src/cli/dep-graph.ts` | 新增 |
| `packages/smarty/src/cli/collect-deps.ts` | 新增 |
| `packages/smarty/src/cli/scan-skeleton-sources.ts` | 新增 |
| `packages/smarty/src/core/hash.ts` | 新增 |
| `packages/smarty/bin/skeleton-v2.js` | **修改**（注册 `check` 子命令） |
| `packages/smarty/test/check.test.ts` | 新增 |
| `packages/smarty/test/fixtures/check-stale/` | 新增（含一个故意 STALE 的样例） |

依赖（新增）：`esbuild ^0.25` `picomatch ^4`

---

## 5. 验收

| 检查 | 方法 |
|---|---|
| 修改组件源文件 1 行 → `smarty check` 报 STALE | shell |
| 修改 design-tokens.ts（在 ignoreGlobs 中） → 不报 STALE | shell |
| 删 bones 文件 → 报 MISSING | shell |
| `<Bound deps>` 改名 → 报 DRIFT | shell |
| depth=5 超过的文件 → 报 outOfDepth 但不影响 exit code | shell |
| `--staged` 模式 100 个 staged 文件 < 1s | benchmark |
| `--ci --json` 输出能被 `jq '.exitCode'` 解析 | shell |
| 在 git clone 后立即 check：源 mtime 是当前，但 hash 未变 → up to date | shell（D3 关键保证） |
| esbuild metafile 在 monorepo 跨 workspace 工作 | e2e |

---

## 6. 已知坑 & 测试用例

1. **esbuild 不解析的资源**：CSS/SVG/PNG 已 `loader: empty` 忽略；如果业务 import 它们的内容（如 `import logoText from './logo.svg?raw'`），不在 hash 中——文档要求开发者把这种当作 `data-skeleton-color-from-image` 之类的 manifest 资源
2. **monorepo workspace 依赖**：`pnpm workspace:*` 链接到本地包，esbuild metafile 跟踪正常；外部 npm 包默认 `node_modules/**` 被 ignoreGlobs 排除
3. **动态 import**：esbuild 能识别 `import('foo')`，加进 metafile.imports；不识别 `import(somePathVariable)` —— 这类业务用 `data-skeleton-depend="./foo.ts"` 注释手动声明（PR-1 扩展）
4. **循环依赖**：`collectDeps` 用 `seen` 防止环；不会无限递归
5. **依赖文件被删**：`hashFiles` 内 try-catch 跳过，最终 hash ≠ 之前 → STALE → 正确触发
6. **CI 缓存**：可以缓存 esbuild metafile 结果（路径以 `tsconfig.json` mtime 为 key），把 cold check 从 ~2s 降到 ~200ms
7. **`tsconfig.paths`**：esbuild 默认读取 `tsconfig.json` 的 `paths`；如项目用 `vite-tsconfig-paths`，配置项 `check.tsconfig` 指明
8. **ignoreGlobs 设错**：把 `**/components/**` 误填会让所有骨架显示 up to date——日志输出 `ignored N files`，便于排查
