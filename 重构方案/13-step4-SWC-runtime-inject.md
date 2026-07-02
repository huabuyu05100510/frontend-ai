# 13 · Step 4 · SWC Runtime Inject（B 路径）

> B 路径：组件级 `<Skeleton name="x">` 由 SWC 编译期自动注入 `initialBones={…}`，挂载即渲染骨架，无需 `import './bones/registry'`。
> 兼容 Vite (`@vitejs/plugin-react-swc`)、Next.js（`next/swc`）、Rspack（`@rspack/plugin-swc`）。

---

## 1. 目标

1. **零侵入**：开发者写 `<Skeleton name="user-card">…</Skeleton>` 即可，不需要任何 import、registry
2. **Tree-shakable**：每个 chunk 只内联自己用到的 bones，未引用的不打进包
3. **缺失校验**：`bones/regions/web/{name}.bones.json` 不存在 → 编译失败（CI）/ 警告（dev）
4. **与 [14-step5 `<Bound>`](./14-step5-Bound显式接口态.md) 配合**：`<Bound>` 内部其实就是 `<Skeleton loading={pending}>`，本 step 的注入对它一样生效

---

## 2. 前置依赖

- [02 BGv2](./02-最佳生成算法.md)：生成 `bones.json` 的算法
- [16-step7 DevSave](./16-step7-DevSave-与dev-ske.md)：dev:ske 浏览自动产出 `bones.json`，否则编译期没数据可注入
- 项目使用 SWC（Vite + `@vitejs/plugin-react-swc` 或 Next.js）；webpack/Babel 项目用 babel 等价插件，本文不展开

---

## 3. 关键设计

### 3.1 转换前后

```tsx
// 开发者写
import { Skeleton } from 'smarty/react'

function UserCard({ isLoading }) {
  return (
    <Skeleton name="user-card" loading={isLoading}>
      <RealUserCard />
    </Skeleton>
  )
}
```

```tsx
// SWC 转换后（自动插入 import + initialBones prop）
import { Skeleton } from 'smarty/react'
import __BONES_user_card from 'virtual:skeleton-bones/user-card'

function UserCard({ isLoading }) {
  return (
    <Skeleton name="user-card" loading={isLoading} initialBones={__BONES_user_card}>
      <RealUserCard />
    </Skeleton>
  )
}
```

### 3.2 虚拟模块 `virtual:skeleton-bones/*`

Vite plugin 注册虚拟模块：

```ts
// vite-plugin.ts（[11-step2](./11-step2-vite-plugin-SSG-lite.md) 扩展）
const VIRTUAL_PREFIX = 'virtual:skeleton-bones/'

return {
  resolveId(id) {
    if (id.startsWith(VIRTUAL_PREFIX)) return '\0' + id
  },
  async load(id) {
    if (!id.startsWith('\0' + VIRTUAL_PREFIX)) return
    const name = id.slice(('\0' + VIRTUAL_PREFIX).length)
    const path = resolve(viteConfig.root, 'bones/regions/web', `${name}.bones.json`)
    if (!existsSync(path)) {
      if (viteConfig.command === 'build') throw new Error(`[skeleton-v2] missing bones: ${name}`)
      viteConfig.logger.warn(`[skeleton-v2] missing bones (will render nothing): ${name}`)
      return 'export default null'
    }
    const content = await readFile(path, 'utf8')
    validate(JSON.parse(content))  // schema check
    return `export default ${content}`
  },
}
```

### 3.3 SWC AST 转换

用 `@swc/core` 的 visitor：

```ts
// packages/smarty/src/web/swc-plugin/index.ts
import type { Program, JSXElement, JSXIdentifier } from '@swc/core'
import { Visitor } from '@swc/core/Visitor'

class SkeletonInjector extends Visitor {
  needsImport = new Set<string>()

  visitJSXElement(el: JSXElement): JSXElement {
    super.visitJSXElement(el)
    if (!isSkeletonElement(el)) return el

    const nameAttr = el.opening.attributes?.find(
      a => a.type === 'JSXAttribute' && (a.name as JSXIdentifier).value === 'name',
    )
    if (!nameAttr || nameAttr.value?.type !== 'StringLiteral') return el  // 名字非字面量 → 跳过
    const skName = nameAttr.value.value
    const safe = sanitizeName(skName)

    if (hasAttribute(el, 'initialBones')) return el  // 已有则不覆盖（手动指定）

    this.needsImport.add(safe)
    el.opening.attributes!.push(makeAttribute('initialBones', identifier(`__BONES_${safe}`)))
    return el
  }

  visitProgram(p: Program): Program {
    super.visitProgram(p)
    if (this.needsImport.size === 0) return p
    for (const name of this.needsImport) {
      prependImport(p, `__BONES_${name}`, `virtual:skeleton-bones/${name}`)
    }
    return p
  }
}

function isSkeletonElement(el: JSXElement): boolean {
  const name = el.opening.name
  if (name.type !== 'Identifier') return false
  return name.value === 'Skeleton' || name.value === 'Bound'   // <Bound> 等价
}
```

### 3.4 Vite plugin transform 接入

```ts
// 在 vite-plugin.ts transform hook 内
import { transform } from '@swc/core'
import { SkeletonInjector } from './swc-plugin'

async transform(code, id) {
  if (!/\.(t|j)sx$/.test(id)) return null
  if (!code.includes('<Skeleton') && !code.includes('<Bound')) return null  // 快速跳过

  const { code: out, map } = await transform(code, {
    jsc: {
      target: 'es2020',
      parser: { syntax: 'typescript', tsx: id.endsWith('.tsx') },
      transform: { react: { runtime: 'automatic' } },
    },
    plugin: (m) => new SkeletonInjector().visitProgram(m),
    sourceMaps: true,
  })
  return { code: out, map }
}
```

### 3.5 `<Skeleton>` 运行时

```tsx
// packages/smarty/src/web/Skeleton.tsx
import { useEffect, useRef, type ReactNode } from 'react'
import type { SkeletonDSL } from '../core/schema'
import { renderBonesToReact } from './render-react'
import { useSkeletonGate } from './use-skeleton-gate'

export interface SkeletonProps {
  name: string
  loading: boolean
  initialBones?: SkeletonDSL | null   // 由 SWC 自动注入
  children?: ReactNode
  delay?: number
  minDuration?: number
}

export function Skeleton({ name, loading, initialBones, children, delay, minDuration }: SkeletonProps) {
  const show = useSkeletonGate(loading, { delay, minDuration })
  if (!show) return <>{children}</>
  if (!initialBones) return <>{children}</>            // 缺失 bones → 不挡住业务
  return <div data-skeleton-name={name}>{renderBonesToReact(initialBones)}</div>
}
```

`renderBonesToReact` 把 `SkeletonDSL` 转成 React 元素树（与 [10-step1 §4](./10-step1-snippet生成器.md) 的 `bonesToHtml` 同源，但产物是 React node）。

---

## 4. 代码骨架

```ts
// packages/smarty/src/web/swc-plugin/index.ts
export class SkeletonInjector extends Visitor { /* §3.3 完整实现 */ }
export function plugin() { return (m: Program) => new SkeletonInjector().visitProgram(m) }

// packages/smarty/src/web/render-react.tsx
export function renderBonesToReact(dsl: SkeletonDSL): ReactNode { /* 类似 bonesToHtml 但产 React */ }
```

---

## 5. 文件改动清单

| 路径 | 操作 |
|---|---|
| `packages/smarty/src/web/swc-plugin/index.ts` | 新增（SWC visitor） |
| `packages/smarty/src/web/swc-plugin/helpers.ts` | 新增（AST helpers） |
| `packages/smarty/src/web/render-react.tsx` | 新增 |
| `packages/smarty/src/web/Skeleton.tsx` | 新增 |
| `packages/smarty/src/web/vite-plugin.ts` | **修改**：注册 `virtual:skeleton-bones/*` + transform hook |
| `packages/smarty/src/web/use-skeleton-gate.ts` | 新增（与 [14-step5](./14-step5-Bound显式接口态.md) 共享） |
| `packages/smarty/test/swc-plugin.test.ts` | 新增 |

---

## 6. 验收

| 检查 | 方法 |
|---|---|
| 编译后 JSX 含 `initialBones` prop 与 `import virtual:skeleton-bones/...` | snapshot test |
| 未引用的组件不打进 chunk（tree-shake） | `vite build --report` 校验 |
| `bones.json` 缺失：build 失败，dev 警告 | unit test |
| 已有 `initialBones={...}`（手动指定）→ 不覆盖 | snapshot test |
| `name` 是动态变量（非字面量）→ 跳过注入，运行时 fallback | snapshot test |
| `<Bound>` 同等待遇 | snapshot test |
| Skeleton 在 `loading=false` 时直接渲染 children | unit |
| `useSkeletonGate` 默认 `delay=120` / `minDuration=300` | unit |

---

## 7. 已知坑 & 测试用例

1. **`name` 动态值**：`<Skeleton name={`card-${id}`}>` 这种动态名 → SWC 无法在编译期确定，**跳过注入**；运行时拿不到 `initialBones` → 走"缺失时不挡住业务"分支。如果业务必须动态，建议改用枚举 + 多个静态 `<Skeleton>`
2. **SSR / Next.js Pages Router**：`next/swc` 接受自定义插件需 Next 14+；Pages Router 仍可用，App Router 暂未验证（[42](./42-Open-Questions-后置.md)）
3. **Babel 项目**：`@babel/plugin-skeleton-v2`（同等转换）作为衍生包，本 step 不展开
4. **同名冲突**：`<Skeleton>` 与项目自有同名组件冲突时，SWC visitor 用 `import_specifier` 校验（只转换来自 `smarty/react` 的）
5. **`virtual:` 协议 webpack 兼容**：webpack 不识别 `virtual:` 前缀，需用 `unplugin-vue-loader` 风格的 module-resolver；webpack 适配作为衍生
6. **`bones.json` 体积过大打进 chunk**：单文件 > 50 KB 警告；建议拆 region 而非一个超大 page bones
