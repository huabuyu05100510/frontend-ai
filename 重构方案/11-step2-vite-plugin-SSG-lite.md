# 11 · Step 2 · Vite Plugin SSG-lite（A 路径）

> A 路径核心：构建期把 snippet 注入 `index.html`，零运行时、零中间件，首屏零 JS 即可见骨架。
> webpack/Rspack 适配器作为同 step 的衍生（结构对称），仅 Vite 在本文展开。

---

## 1. 目标

1. **构建期注入**：`vite build` 完成后，`dist/index.html` 内已含 snippet（默认路由的骨架），首次访问无需任何 JS 即可见
2. **多路由的"默认骨架"选择**：由 `config.ssg.defaultRoute`（默认 `/`）决定 `index.html` 内嵌哪个 snippet；其它路由由 [12-step3 bridge](./12-step3-SPA-router-bridge.md) 在 client 端切换
3. **head / body / auto 三档注入**（D5）
4. **dev 模式无骨架**（避免开发者每次刷新都被骨架挡住），仅 `mode=ske` 或 `build` 时启用
5. **多端构建复用**：同一 Vite 配置可分别产出 `bones/pages/web/`、`bones/pages/mp/`（Taro H5）

---

## 2. 前置依赖

- [10-step1-snippet生成器.md](./10-step1-snippet生成器.md)：`renderSnippet()` 已实现
- [02-最佳生成算法.md](./02-最佳生成算法.md)：BGv2 可产出 `bones.json`
- 项目已采集到至少 1 个 page-level 的 `bones/pages/web/{name}.bones.json`

---

## 3. 关键设计

### 3.1 注入位置 D5 三档

```ts
type InjectMode = 'auto' | 'head' | 'body'

function injectSnippet(html: string, snippet: string, mode: InjectMode): string {
  if (mode === 'body' || (mode === 'auto' && html.includes('</body>'))) {
    return html.replace('</body>', snippet + '</body>')
  }
  if (mode === 'head' || mode === 'auto') {
    // head 模式：style + script 注入 head，overlay HTML 字符串内联，boot 时 createElement
    const { styleTag, scriptTag } = splitSnippetForHead(snippet)
    return html.replace('</head>', styleTag + scriptTag + '</head>')
  }
  return html  // 兜底不注入
}
```

`splitSnippetForHead` 把 snippet 中的 `<div#__skeleton>` 提取为 IIFE 内的字符串常量 `OVERLAY_HTML`，boot 时再 `createElement`：

```js
// head 模式注入的 script（替换 [10-step1 §3.1] 的 script 部分）
(function(){
  if(window.__SKELETON_READY__)return;window.__SKELETON_READY__=true;
  var OVERLAY_HTML={{OVERLAY_JSON}};   // div#__skeleton 的字符串
  function boot(){
    var t=document.createElement('div');t.innerHTML=OVERLAY_HTML;
    var p=t.firstElementChild;
    if(document.body&&p) document.body.appendChild(p);
    /* 接下来的 Observer / dismiss / MAX_WAIT 同 body 模式 */
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot);
  else boot();
})();
```

代价：head 模式骨架可见时刻比 body 模式晚一个 boot 回合（10–20 ms），但**覆盖所有注入位置**（来自原 [skeleton-build-pipeline-design.md §6.2](../boneyard-main/packages/boneyard/src/skeleton-build-pipeline-design.md)）。

### 3.2 多路由的 client-side bridge 配合

`index.html` 注入的是 `defaultRoute` 的 snippet；**bridge 会在 boot 时根据 `location.pathname` 决定**：

- 路径匹配 `defaultRoute` → 保留 snippet，等 React mount
- 路径不匹配 → 立刻销毁 snippet，注入正确路由的 snippet（异步 fetch `bones/pages/web/{name}.snippet.html`）

详见 [12-step3 §3](./12-step3-SPA-router-bridge.md)。

### 3.3 与 SWC 注入（B 路径）共存

本 Vite plugin 同时承担 [13-step4 SWC 注入](./13-step4-SWC-runtime-inject.md) 的 `transform` 阶段（同插件，不同 hook）：

```ts
return {
  name: 'skeleton-v2',
  enforce: 'pre',
  transformIndexHtml(html, ctx) { /* A 路径：注入 snippet */ },
  transform(code, id)            { /* B 路径：SWC AST 注入 initialBones */ },
  configureServer(server)        { /* dev:ske：注册 DevSave 端点 */ },
}
```

### 3.4 manifest.json 同步产出

Vite plugin 在 `closeBundle` 阶段生成 `dist/bones/pages/web/manifest.json`（用于 bridge 加载）：

```jsonc
{
  "version": 1,
  "defaultRoute": "/",
  "routes": {
    "/":             { "snippet": "home", "rootSelector": "#root", "inject": "auto" },
    "/user/:id":     { "snippet": "user-profile", "rootSelector": "#root", "inject": "auto" },
    "/dashboard/*":  { "snippet": "dashboard", "rootSelector": "#root", "inject": "auto" }
  }
}
```

---

## 4. 代码骨架

```ts
// packages/smarty/src/web/vite-plugin.ts
import type { Plugin, ResolvedConfig } from 'vite'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { renderSnippet } from './snippet'
import { validate } from '../core/schema'
import { resolveConfig } from '../config/resolve'

export interface SkeletonV2PluginOptions {
  bonesDir?: string                  // 默认 'bones/pages/web'
  defaultRoute?: string              // 默认 '/'
  inject?: 'auto' | 'head' | 'body'  // 默认 'auto'
  enableInDev?: boolean              // 默认 false
}

export function skeletonV2(opts: SkeletonV2PluginOptions = {}): Plugin {
  let viteConfig: ResolvedConfig
  let projectConfig: ReturnType<typeof resolveConfig>
  const ssgMode = process.env.SKELETON_SSG !== '0'  // 默认开

  return {
    name: 'skeleton-v2',
    enforce: 'pre',

    configResolved(c) {
      viteConfig = c
      projectConfig = resolveConfig(viteConfig.root)
    },

    /* ============== A 路径：transformIndexHtml ============== */
    async transformIndexHtml(html, ctx) {
      const isBuild = viteConfig.command === 'build'
      const isSke = viteConfig.mode === 'ske'
      if (!ssgMode) return html
      if (!isBuild && !isSke && !opts.enableInDev) return html

      const defaultRoute = opts.defaultRoute ?? projectConfig.ssg.defaultRoute ?? '/'
      const name = routeToSnippetName(defaultRoute, projectConfig.routes)
      if (!name) return html  // 没采集到 → 不注入

      const bonesPath = resolve(
        viteConfig.root,
        opts.bonesDir ?? 'bones/pages/web',
        `${name}.bones.json`,
      )
      let dsl
      try { dsl = validate(JSON.parse(await readFile(bonesPath, 'utf8'))) }
      catch (e) {
        viteConfig.logger.warn(`[skeleton-v2] skip inject (${name}): ${e.message}`)
        return html
      }

      const snippet = renderSnippet(dsl, {
        rootSelector: projectConfig.ssg.rootSelector,
        darkSelector: projectConfig.darkSelector,
        maxWait: projectConfig.ssg.maxWait,
      })

      return injectSnippet(html, snippet, opts.inject ?? projectConfig.ssg.inject ?? 'auto')
    },

    /* ============== closeBundle: 产出 manifest + 复制 snippet ============== */
    async closeBundle() {
      if (viteConfig.command !== 'build') return
      const distSsr = resolve(viteConfig.build.outDir, 'bones/pages/web')
      await mkdir(distSsr, { recursive: true })

      // 1. 复制所有 snippet 到 dist（bridge 运行时按需 fetch）
      const allRoutes = projectConfig.routes ?? {}
      const manifest: Manifest = { version: 1, defaultRoute: opts.defaultRoute ?? '/', routes: {} }
      for (const [routePath, { name, rootSelector }] of Object.entries(allRoutes)) {
        const bones = JSON.parse(
          await readFile(resolve(viteConfig.root, 'bones/pages/web', `${name}.bones.json`), 'utf8'),
        )
        const snippet = renderSnippet(bones, {
          rootSelector: rootSelector ?? projectConfig.ssg.rootSelector,
          darkSelector: projectConfig.darkSelector,
          maxWait: projectConfig.ssg.maxWait,
        })
        await writeFile(resolve(distSsr, `${name}.snippet.html`), snippet, 'utf8')
        manifest.routes[routePath] = { snippet: name, rootSelector: rootSelector ?? '#root', inject: 'auto' }
      }

      await writeFile(resolve(distSsr, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
    },

    /* ============== B 路径 + DevSave ============== */
    transform(code, id) {
      /* 见 [13-step4](./13-step4-SWC-runtime-inject.md) */
    },
    configureServer(server) {
      /* 见 [16-step7](./16-step7-DevSave-与dev-ske.md) */
    },
  }
}
```

### 4.1 webpack/Rspack 适配器（同 step，单独文件）

```ts
// packages/smarty/src/web/webpack-plugin.ts
import { type Compiler } from 'webpack'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import { renderSnippet } from './snippet'

export class SkeletonV2WebpackPlugin {
  constructor(private opts: SkeletonV2PluginOptions = {}) {}
  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap('skeleton-v2', (compilation) => {
      HtmlWebpackPlugin.getCompilationHooks(compilation).afterTemplateExecution.tapAsync(
        'skeleton-v2',
        async (data, cb) => {
          // 读 bones / renderSnippet / injectSnippet 同 vite-plugin
          cb(null, data)
        },
      )
    })
  }
}
```

---

## 5. 文件改动清单

| 路径 | 操作 |
|---|---|
| `packages/smarty/src/web/vite-plugin.ts` | 新增（仅 SSG-lite 部分；SWC/DevSave 在 step4/step7 扩展同文件） |
| `packages/smarty/src/web/inject-helpers.ts` | 新增（`injectSnippet`、`splitSnippetForHead`） |
| `packages/smarty/src/web/route-match.ts` | 新增（`routeToSnippetName`，与 [12-step3 bridge](./12-step3-SPA-router-bridge.md) 共享） |
| `packages/smarty/src/web/webpack-plugin.ts` | 新增（webpack 适配器） |
| `packages/smarty/test/vite-plugin.test.ts` | 新增 |
| `apps/demo/vite.config.ts` | **修改**：增加 `skeletonV2()` 插件 |
| `apps/demo/smarty.config.json` | **修改**：增加 `ssg` 段 |

---

## 6. 验收

| 检查 | 方法 |
|---|---|
| `vite build` 后 `dist/index.html` 含 snippet | grep `#__skeleton` |
| `vite dev`（非 ske 模式）`index.html` 不含 snippet | grep 失败 |
| `vite --mode ske` 也含 snippet（便于本地预览） | curl localhost:5173 |
| head 模式：`<style>+<script>` 在 `<head>` 内，body 模式：注入 `</body>` 前 | snapshot test |
| `dist/bones/pages/web/manifest.json` 路由完整 | JSON 校验 |
| `dist/bones/pages/web/*.snippet.html` 文件数 = 路由数 | ls check |
| `index.html` 体积增加 ≤ 6 KB（单 snippet） | size diff |
| 注入位置 `auto` 在仅有 `</head>` 时降级 head 模式 | unit test |

---

## 7. 已知坑 & 测试用例

1. **构建后 React Router 的客户端路由若不匹配 manifest 路径** → 走 [12-step3 bridge](./12-step3-SPA-router-bridge.md) 的 fallback：注入"通用骨架"或不注入，绝不卡死
2. **Vite preview 模式**：`vite preview` 走的是 `dist/index.html`，骨架仍会生效；如需关闭，环境变量 `SKELETON_SSG=0`
3. **多入口（`build.rollupOptions.input`）**：本设计当前**只处理 `index.html`**；多入口（如 `index.html` + `admin.html`）需 in/output 配对，留作扩展
4. **SSR Next-style 项目**：本 plugin **不适用**于 Next.js Pages Router（Next 走 `next/document` 注入）；Next 适配 → [42-Open-Questions-后置.md](./42-Open-Questions-后置.md)
5. **`{{}}` 模板变量与 Vue/Angular 冲突**：snippet 文本不会被 Vue 编译（在 `<script>` IIFE 内已用 `'…'` 字符串包裹），无冲突
6. **HMR 双重注入**：dev 模式不注入；预览模式 HTML 由构建期生成，HMR 不会重写 → 无问题
