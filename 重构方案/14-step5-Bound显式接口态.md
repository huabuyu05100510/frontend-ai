# 14 · Step 5 · `<Bound>` 显式接口态

> 接口态骨架的最小可行实现：开发者**显式**用 `<Bound deps={['…']}>` 包裹数据驱动区域，框架订阅 dataKey 状态、按 delay/minDuration 节流，自动盖/拆骨架。
> 不做 Tier 1/2/3 自动 binding graph，不做编译期 autoBound。决策依据见 [00 §1 D2/D4](./00-总览与决策锚点.md)。

---

## 1. 目标

1. **数据层无关**：React Query / SWR / Relay / 原生 fetch + useState 一视同仁，由 dataKey 字符串映射
2. **多区域独立**：一个组件多个 `<Bound>` 区域，各自盖各自的骨架，最慢接口不拖累其他
3. **一接口多区域**：同一 dataKey 喂多个 `<Bound>`，dataKey success → 所有 region 同时揭开
4. **防闪烁**：`delay`（默认 120ms） + `minDuration`（默认 300ms） 双阈值，避免"骨架闪一下就消失"
5. **错误态**：dataKey error → 不再盖骨架，让区域内的 ErrorBoundary 接管
6. **列表自适应**：`<Bound list>` 区域可在数据到达后按真实条数调整列表骨架

---

## 2. 前置依赖

- [02 BGv2](./02-最佳生成算法.md)：可生成 region 级 `bones.json`
- [13-step4 SWC 注入](./13-step4-SWC-runtime-inject.md)：`<Bound>` 等价于 `<Skeleton>`，享受同样的 `initialBones` 注入
- [16-step7 DevSave](./16-step7-DevSave-与dev-ske.md)：dev:ske 浏览捕获 region 级 bones

---

## 3. 关键设计

### 3.1 `<Bound>` 组件签名

```tsx
import { Bound } from 'smarty/react'

function UserPage() {
  return (
    <>
      <Bound id="profile-header" deps={['query:user']}>
        <ProfileHeader />
      </Bound>

      <Bound id="order-list" deps={['swr:/api/orders']} list>
        <OrderList />
      </Bound>

      <Bound id="recommend-rail" deps={['query:user', 'query:recommend']}>
        <RecommendRail />
      </Bound>

      <StaticToolbar />  {/* 无 Bound 包裹 = 静态，立即渲染，永不骨架化 */}
    </>
  )
}
```

### 3.2 dataKey 规范

- 格式：`<source>:<identifier>`
- 推荐前缀：`query:` `swr:` `relay:` `fetch:` `custom:`
- identifier 推荐：query key（React Query/SWR）或 URL（fetch/axios）
- 同一 dataKey 在多处使用 → 自动去重

### 3.3 全局状态注册中心

```ts
// packages/smarty/src/web/data-registry.ts
type DataStatus = 'idle' | 'pending' | 'success' | 'error'
type StatusListener = (status: DataStatus) => void

class DataRegistry {
  private status = new Map<string, DataStatus>()
  private listeners = new Map<string, Set<StatusListener>>()

  setStatus(key: string, status: DataStatus): void {
    this.status.set(key, status)
    this.listeners.get(key)?.forEach(l => l(status))
  }

  getStatus(key: string): DataStatus {
    return this.status.get(key) ?? 'idle'
  }

  subscribe(key: string, listener: StatusListener): () => void {
    let set = this.listeners.get(key)
    if (!set) { set = new Set(); this.listeners.set(key, set) }
    set.add(listener)
    return () => set!.delete(listener)
  }
}

export const dataRegistry = new DataRegistry()
```

### 3.4 数据层适配器（薄）

每个数据层只需写一个适配器，把它的状态推到 `dataRegistry`：

```ts
// adapters/react-query.ts
import { QueryClient } from '@tanstack/react-query'
import { dataRegistry } from '../data-registry'

export function attachReactQueryAdapter(client: QueryClient): () => void {
  return client.getQueryCache().subscribe((event) => {
    const key = `query:${JSON.stringify(event.query.queryKey)}`
    const status = event.query.state.status         // 'idle' | 'loading' | 'success' | 'error'
    dataRegistry.setStatus(key, status === 'loading' ? 'pending' : status)
  })
}

// adapters/swr.ts —— 用 useSWRConfig().mutate 拦截 + middleware
// adapters/fetch.ts —— 拦截 window.fetch；可选
```

业务方在 app entry：

```ts
import { attachReactQueryAdapter } from 'smarty/adapters/react-query'
import { queryClient } from './query-client'
attachReactQueryAdapter(queryClient)
```

未接适配器时，开发者也可直接调 `dataRegistry.setStatus('custom:profile', 'pending')` 手动更新。

### 3.5 `useRegionPending` hook

```ts
// packages/smarty/src/web/use-region-pending.ts
import { useEffect, useState } from 'react'
import { dataRegistry } from './data-registry'

export function useRegionPending(deps: string[]): 'pending' | 'success' | 'error' {
  const [, force] = useState(0)
  useEffect(() => {
    const unsubs = deps.map(k => dataRegistry.subscribe(k, () => force(x => x + 1)))
    return () => unsubs.forEach(fn => fn())
  }, [deps.join('|')])

  let hasError = false
  let hasPending = false
  for (const k of deps) {
    const s = dataRegistry.getStatus(k)
    if (s === 'error') hasError = true
    if (s === 'pending' || s === 'idle') hasPending = true
  }
  if (hasError) return 'error'
  if (hasPending) return 'pending'
  return 'success'
}
```

### 3.6 `useSkeletonGate` 防闪烁

```ts
// packages/smarty/src/web/use-skeleton-gate.ts
import { useEffect, useRef, useState } from 'react'

export interface GateOptions { delay?: number; minDuration?: number }

export function useSkeletonGate(loading: boolean, opts: GateOptions = {}): boolean {
  const { delay = 120, minDuration = 300 } = opts
  const [visible, setVisible] = useState(false)
  const shownAt = useRef<number | null>(null)
  const delayTimer = useRef<number | null>(null)
  const hideTimer = useRef<number | null>(null)

  useEffect(() => {
    if (loading) {
      if (visible || delayTimer.current != null) return
      delayTimer.current = window.setTimeout(() => {
        setVisible(true)
        shownAt.current = Date.now()
        delayTimer.current = null
      }, delay)
    } else {
      if (delayTimer.current != null) {
        clearTimeout(delayTimer.current); delayTimer.current = null
      }
      if (visible) {
        const elapsed = Date.now() - (shownAt.current ?? 0)
        const remain = Math.max(0, minDuration - elapsed)
        hideTimer.current = window.setTimeout(() => {
          setVisible(false); shownAt.current = null; hideTimer.current = null
        }, remain)
      }
    }
    return () => {
      if (delayTimer.current != null) clearTimeout(delayTimer.current)
      if (hideTimer.current != null) clearTimeout(hideTimer.current)
    }
  }, [loading])

  return visible
}
```

### 3.7 `<Bound>` 实现

```tsx
// packages/smarty/src/web/Bound.tsx
import { useRegionPending } from './use-region-pending'
import { useSkeletonGate } from './use-skeleton-gate'
import { renderBonesToReact } from './render-react'
import type { SkeletonDSL } from '../core/schema'

export interface BoundProps {
  id: string
  deps: string[]
  initialBones?: SkeletonDSL | null   // SWC 自动注入
  list?: boolean
  delay?: number
  minDuration?: number
  children: React.ReactNode
}

export function Bound({ id, deps, initialBones, list, delay, minDuration, children }: BoundProps) {
  const state = useRegionPending(deps)
  const show = useSkeletonGate(state === 'pending', { delay, minDuration })

  if (state === 'error') return <>{children}</>            // 让 ErrorBoundary 接管
  if (!show) return <>{children}</>
  if (!initialBones) return <>{children}</>

  return (
    <div data-skeleton-region={id}>
      {renderBonesToReact(initialBones)}
    </div>
  )
}
```

### 3.8 列表数据驱动条数（list 模式）

`<Bound list>` 期望 children 实际渲染时数据是数组。运行时如何在骨架阶段决定条数？

方案：`<Bound list count={...}>` 让开发者**显式提示**预估条数，骨架按此渲染；不提示则用 bones.json 采集时的 `count`：

```tsx
<Bound id="order-list" deps={['swr:/api/orders']} list count={typeof prevCount === 'number' ? prevCount : 6}>
  <OrderList />
</Bound>
```

`renderBonesToReact` 在遇到 `ListBone` 时按 `count` 重复 `itemBones`。

---

## 4. 文件改动清单

| 路径 | 操作 |
|---|---|
| `packages/smarty/src/web/Bound.tsx` | 新增 |
| `packages/smarty/src/web/data-registry.ts` | 新增 |
| `packages/smarty/src/web/use-region-pending.ts` | 新增 |
| `packages/smarty/src/web/use-skeleton-gate.ts` | 新增（与 [13-step4](./13-step4-SWC-runtime-inject.md) 的 Skeleton 共享） |
| `packages/smarty/src/web/adapters/react-query.ts` | 新增 |
| `packages/smarty/src/web/adapters/swr.ts` | 新增 |
| `packages/smarty/src/web/adapters/fetch.ts` | 新增（可选） |
| `packages/smarty/test/bound.test.tsx` | 新增 |
| `packages/smarty/test/use-skeleton-gate.test.ts` | 新增 |

---

## 5. 验收

| 检查 | 方法 |
|---|---|
| 单 region pending → success：骨架→内容切换无闪烁（minDuration 300ms） | RTL + fake timer |
| 多 region 独立切换：A success B 仍 pending → A 已揭开 B 仍骨架 | RTL |
| 多 dataKey 全部 success 才揭开 | RTL |
| 任一 dataKey error → 不再盖骨架 | RTL |
| delay 期内数据返回：骨架根本不显示 | fake timer |
| list 模式：count=6 渲染 6 条 item bones | snapshot |
| 适配器：React Query loading → registry status='pending'；success → 'success' | RTL with QueryClient |
| 适配器：SWR mutate 后 status 同步 | RTL with SWRConfig |

---

## 6. 已知坑 & 测试用例

1. **`deps` 数组引用稳定性**：每次 render 创建新数组会导致 `useRegionPending` 内 effect 重新订阅。用 `deps.join('|')` 作为依赖 + 文档建议在 module scope 定义 `const ORDER_DEPS = ['swr:/api/orders']`
2. **React Query queryKey 包含函数/symbol**：`JSON.stringify(queryKey)` 失败 → 适配器 catch 后降级用 `String(queryKey)` 并 warn
3. **SWR 的 `isLoading` vs `isValidating`**：仅 `isLoading=true` 推 pending；`isValidating`（背景刷新）不触发骨架，避免重复闪烁
4. **乐观更新**：mutate 后立刻 success，骨架可能没有机会显示——这正是期望行为
5. **`<Bound>` 嵌套**：内外两个 `<Bound>` 均 pending 时，只外层显示骨架（CSS 层叠），内层 children 实际是骨架本身不会渲染。**反模式提醒**：避免嵌套，应该把 deps 合并到外层
6. **SSR 环境**：`<Bound>` 在 SSR 阶段直接渲染 children（默认 status='idle'）；hydration 后才订阅 registry
7. **TypeScript 严格模式下的 deps**：deps 是 `string[]` 而非 `readonly string[]`——业务用 `as const` 时需 `[...DEPS]`，文档示例须强调
