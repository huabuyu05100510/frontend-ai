# 16 · Step 7 · DevSave 与 dev:ske 模式（v2 重新定位为人工调试）

> **v2 定位调整**（见 [00 §1 D4](./00-总览与决策锚点.md)）：DevSave 不再是"权威捕获通路"，它是**人工调试便利工具**。
> 开发者写完组件想立刻看骨架效果 → 浏览页面 → 写盘到 **`.smarty-cache/`**（不进 git） → HMR 业务侧使用预览。
> 进 git、被 CI 比对的，**只有** Playwright 跑出来的 `bones/`（[17-step8](./17-step8-Playwright批量与Visual-Diff.md)）。

---

## 1. 目标

1. **零开销**：普通 `pnpm dev` 不触发任何捕获、不注入任何探针、HMR 不变慢
2. **一键激活**：`pnpm dev:ske`（等价 `vite --mode ske`）即开启捕获 + 端点 + HMR
3. **写盘到 `.smarty-cache/`**（v2 调整，**不进 git，不参与 CI hash**）：
   - `<Skeleton name>` → `.smarty-cache/pages/{platform}/{name}.preview.bones.json`
   - `<Bound id>` → `.smarty-cache/regions/{platform}/{id}.preview.bones.json`
   - `bindings.json` 仅在 Playwright 跑时写到 `bones/regions/{platform}/`（权威源）
4. **多断点积累**：多次浏览（变窗口宽度）合并写入同一文件的不同 `breakpoints[width]`，**但仅供开发预览**
5. **HMR**：写盘后触发 `srv.watcher.emit('change', registryPath)`，业务代码热更新使用预览 bones
6. **CI 完全忽略 `.smarty-cache/`**：[18-step9 check](./18-step9-check-CLI-深层依赖.md) 只 hash `bones/`

---

## 2. 前置依赖

- [02 BGv2](./02-最佳生成算法.md)：浏览器侧 `BGv2.generate()` 可用
- [13-step4 SWC 注入](./13-step4-SWC-runtime-inject.md)：`<Skeleton>` 接收 `initialBones`，但 dev:ske 模式下走运行时捕获
- [15-step6 断点扫描](./15-step6-断点自动扫描.md)：dev:ske 浏览端运行时 styleSheets 上报

---

## 3. 关键设计

### 3.1 模式判定

```ts
// vite-plugin.ts configResolved
const isSke = viteConfig.mode === 'ske' || process.env.BONEYARD_SKE === '1'
```

`package.json`：

```jsonc
{
  "scripts": {
    "dev":     "vite",
    "dev:ske": "vite --mode ske",
    "build":   "vite build"
  }
}
```

### 3.2 端点 `/__smarty__/save`

```ts
// vite-plugin.ts configureServer
configureServer(server) {
  if (!isSke) return
  server.middlewares.use('/__smarty__/save', async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return }

    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body) as DevSavePayload
        validate(payload.result)               // schema 校验
        const file = resolveOutPath(payload, projectConfig)
        await writeMergedBones(file, payload)
        await updateRegistry(payload, projectConfig)
        if (payload.kind === 'api') await updateBindings(payload, projectConfig)
        if (payload.kind === 'ssr') await regenerateSnippet(payload, projectConfig)
        server.watcher.emit('change', registryPath(projectConfig))
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      } catch (e: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: e.message }))
      }
    })
  })
}

interface DevSavePayload {
  kind: 'ssr' | 'api'
  platform: 'web' | 'rn' | 'mp'
  name?: string              // ssr 必填
  region?: string            // api 必填
  deps?: string[]            // api 必填
  width: number              // 当前视口宽度
  result: SkeletonDSL        // BGv2 输出
  runtimeBreakpoints?: number[]  // §3.3
  sourceFile?: string        // <Skeleton> 所在文件相对路径
}
```

### 3.3 浏览器侧：捕获 + POST

```tsx
// packages/smarty/src/web/Skeleton.tsx
import { BGv2 } from '../generator/bgv2'

export function Skeleton({ name, loading, initialBones, children, ...rest }: SkeletonProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!__SKELETON_SKE__) return     // dev:ske 编译期常量
    if (!ref.current) return
    // 真实 DOM 已渲染（loading=false 切换 或 首次 children 渲染后）
    if (loading) return
    requestIdleCallback(() => {
      const dsl = BGv2.generate({
        root: ref.current!,
        config: window.__SK_CONFIG__,
      })
      const width = ref.current!.offsetWidth
      fetch('/__smarty__/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'ssr', platform: 'web', name, width,
          result: dsl,
          runtimeBreakpoints: BGv2.runtimeBreakpoints(),
          sourceFile: import.meta?.url ?? null,
        }),
      }).catch(() => { /* dev save 失败不影响渲染 */ })
    })
  }, [loading, name])

  const show = useSkeletonGate(loading)
  if (!show) return <div ref={ref}>{children}</div>
  return initialBones
    ? <div data-skeleton-name={name}>{renderBonesToReact(initialBones)}</div>
    : <div ref={ref}>{children}</div>
}
```

`__SKELETON_SKE__` 编译期常量：Vite plugin 在 `define` 段注入 `'__SKELETON_SKE__': isSke`，生产构建被 tree-shake 掉，**产物零负担**。

### 3.4 多断点合并

```ts
async function writeMergedBones(file: string, payload: DevSavePayload): Promise<void> {
  let existing: SkeletonDSL = {
    kind: payload.kind, platform: payload.platform, version: 2,
    width: payload.width, height: payload.result.height, rootColor: payload.result.rootColor,
    bones: payload.result.bones, css: payload.result.css,
    breakpoints: {}, _meta: payload.result._meta,
  }
  if (existsSync(file)) {
    try { existing = JSON.parse(await readFile(file, 'utf8')) } catch {}
  }
  if (!existing.breakpoints) existing.breakpoints = {}
  // 主断点 = 已有最大；新数据写入对应 width
  existing.breakpoints[payload.width] = {
    ...payload.result, breakpoints: undefined,
  }
  // 主 bones 选最大宽度的
  const maxW = Math.max(...Object.keys(existing.breakpoints).map(Number))
  if (payload.width === maxW) {
    existing.width = payload.width
    existing.bones = payload.result.bones
    existing.css   = payload.result.css
  }
  existing._meta = {
    ...existing._meta,
    builtAt: Date.now(),
    capturedBy: 'devsave',
    breakpointSource: mergeSource(existing._meta.breakpointSource, payload.runtimeBreakpoints),
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(existing, null, 2), 'utf8')
}
```

### 3.5 路径解析

```ts
function resolveOutPath(p: DevSavePayload, cfg: SkeletonConfig): string {
  const safeName = (p.name ?? p.region ?? '').replace(/[^a-zA-Z0-9_-]/g, '_')
  // v2: DevSave 一律写到 .smarty-cache/（不进 git）
  const subDir = p.kind === 'ssr' ? 'pages' : 'regions'
  return resolve(cfg.cwd, '.smarty-cache', subDir, p.platform, `${safeName}.preview.bones.json`)
}
```

### 3.6 bindings.json 同步（api 类）

```ts
async function updateBindings(p: DevSavePayload, cfg: SkeletonConfig): Promise<void> {
  const file = resolve(cfg.outDir[p.platform], 'api', 'bindings.json')
  let bindings: BindingsFile = { version: 1, regions: {} }
  if (existsSync(file)) bindings = JSON.parse(await readFile(file, 'utf8'))
  bindings.regions[p.region!] = {
    deps: p.deps ?? [],
    bones: `${p.region!}.bones.json`,
    via: 'manual',                         // 显式 <Bound> 一律 manual
    conf: 1.0,
    sourceFile: p.sourceFile,
  }
  await writeFile(file, JSON.stringify(bindings, null, 2), 'utf8')
}
```

### 3.7 HMR

```ts
server.watcher.emit('change', resolve(viteConfig.root, 'bones/regions/web/bindings.json'))
server.watcher.emit('change', resolve(viteConfig.root, 'bones/regions/web', `${region}.bones.json`))
```

虚拟模块 `virtual:skeleton-bones/{name}`（[13-step4 §3.2](./13-step4-SWC-runtime-inject.md)）的 `load` 会重新读取，业务侧 HMR 接管，无感更新。

---

## 4. 文件改动清单

| 路径 | 操作 |
|---|---|
| `packages/smarty/src/web/vite-plugin.ts` | **修改**：configureServer 注册 `/__smarty__/save`；`define` 注入 `__SKELETON_SKE__` |
| `packages/smarty/src/web/devsave/handler.ts` | 新增（端点处理逻辑） |
| `packages/smarty/src/web/devsave/merge.ts` | 新增（多断点合并） |
| `packages/smarty/src/web/devsave/bindings.ts` | 新增 |
| `packages/smarty/src/web/Skeleton.tsx` | **修改**：dev:ske 模式下捕获 POST |
| `packages/smarty/src/web/Bound.tsx` | **修改**：同 Skeleton，但 kind='api' + 带 deps/region |
| `packages/smarty/test/devsave.test.ts` | 新增（用 supertest mock req） |

---

## 5. 验收

| 检查 | 方法 |
|---|---|
| 普通 `dev` 模式 `__SKELETON_SKE__=false`，POST 调用被 tree-shake | bundle-analyzer |
| `dev:ske` 模式访问页面 → `bones/pages/web/home.bones.json` 出现 | filesystem check |
| 拉宽窗口再访问 → 同文件 `breakpoints[1280]` 合并写入 | filesystem |
| `<Bound id="x" deps=['…']>` 触发 → `bones/regions/web/x.bones.json` + `bindings.json` 出现 | filesystem |
| 写入后 200ms 内业务侧 HMR 收到 `virtual:skeleton-bones/x` 更新 | playwright |
| 端点 POST 校验失败返回 400 + error | supertest |
| 端点不存在（普通 dev）请求 → next() 透传 404 | supertest |
| 生产构建产物中无 `/__smarty__/save` 字符串 | grep dist/ |

---

## 6. 已知坑 & 测试用例

1. **首次访问被 `useSkeletonGate` 防闪烁挡住**：dev:ske 模式应**强制 loading=false 后等 200ms 再捕获**，避免拿到的是骨架自身
2. **`import.meta.url` 在 prod build 被处理为绝对路径**：dev 模式拿相对工作目录的路径用 `import.meta.glob` 反查文件；详情见 `devsave/source-lookup.ts`
3. **大对象重复 POST**：同一 region 同一 width 短时间内多次触发 → 端点用 `sha256(result)` 比对，未变则跳过写盘（不影响响应 200）
4. **跨域**：dev:ske 总是同源，无 CORS 问题；如果业务用了 Vite proxy 跨端口预览，端点要走 `'/__smarty__/*'` 匹配 + Vite 代理透传
5. **多人协作冲突**：两人同时 dev:ske 不同断点写到同一 region → 后写覆盖前写的同断点；mtime 时间戳 + git diff 可以看出谁后写的
6. **性能**：BGv2 在浏览器侧执行典型 60 ms（[02 §14](./02-最佳生成算法.md) 基线），dev:ske 模式下不影响业务交互（rIC 调度）
7. **极小元素采样**：用户开发到一半页面只渲染了一半，捕获到的 bones 不完整——文档建议**在页面"已知达到稳定态"后再 ctrl+S 触发** （或加一个手动重采按钮，未来扩展）
