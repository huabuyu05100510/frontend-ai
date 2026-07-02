# 30 · Step 11 · React Native 后端

> RN 无 DOM、无 CSS @media、无 SSR；但七层流水线（已裁剪为五层）照样成立——只把 Render / Capture / Inject / Teardown 换成 RN 等价物。
> 动画后端用 **Reanimated 3 worklet 跑 UI 线程**——这是 RN 上落实"骨架不掉帧"的关键。

---

## 1. 目标

1. **同 API**：业务侧 `<Skeleton name>` `<Bound deps>` 写法与 Web 完全一致
2. **Capture**：dev:ske 模式下用 `measure()` 等价物把真实组件树转为 `bones.json`，写入 `bones/pages/rn/`
3. **Render**：`<Skeleton>` 把 `bones.json` 渲染为 `<View>` 组件树
4. **动画**：shimmer / pulse 跑在 Reanimated worklet（UI 线程），主 JS 线程繁忙不掉帧
5. **Teardown**：`ReadySignal` 用 `InteractionManager.runAfterInteractions` + 数据态合成
6. **降级**：无 Reanimated → 退化为静态骨架（不动），仍能占位

---

## 2. 前置依赖

- [01 §2 RN 包](./01-架构与模型.md)：`packages/smarty/src/rn/`
- [02 BGv2 §15](./02-最佳生成算法.md)：BGv2 与 RN 共享 schema，但**采集器是 RN 版**
- 业务方已安装 `react-native-reanimated@3+`（可选）
- 业务方已安装 `react-native-fast-image`（可选，用于图片采样）

---

## 3. 关键设计

### 3.1 Capture：RN 版的 BGv2

RN 没有 `getBoundingClientRect`，用 `View.measure(callback)`：

```ts
// packages/smarty/src/rn/capture.ts
import type { ViewProps } from 'react-native'

interface RNNode {
  type: string                            // View / Text / Image / FlatList
  rect: { x: number; y: number; w: number; h: number }
  computedStyle: { backgroundColor?: string; borderRadius?: number }
  children: RNNode[]
}

export function measureTree(rootRef: any): Promise<RNNode> {
  return new Promise((resolve) => {
    rootRef.measure((x: number, y: number, w: number, h: number, pageX: number, pageY: number) => {
      const root: RNNode = {
        type: getNodeType(rootRef), rect: { x: pageX, y: pageY, w, h },
        computedStyle: extractStyle(rootRef.props.style), children: [],
      }
      measureChildren(rootRef, root).then(() => resolve(root))
    })
  })
}
```

RN 算法步骤映射（与 [02 §1 Web 10 阶段](./02-最佳生成算法.md) 对应）：

| 阶段 | Web | RN |
|---|---|---|
| 遍历 | DOM DFS + TreeWalker | React tree walker + `measure()` 异步收集 |
| 分类 | tag + computedStyle + 钩子 | RN 内置组件名（View/Text/Image/FlatList）+ props.style + `bp-hint` prop |
| 形状 | `getBoundingClientRect` | `measure(callback)` 异步 |
| 文本 gradient | linear-gradient | RN 无 background-image gradient；改用 `react-native-linear-gradient` 包裹 |
| 列表 | UL/OL/TBODY clone | `FlatList` / `ScrollView` 抽样首项 |
| 块合并 | R-tree | 同算法（共享 `core/rbush`） |
| CSS 裁剪 | css-tree | 不适用（RN 无 CSS） |
| 输出 | JSON / bin / HTML | JSON / bin |

### 3.2 业务用法（与 Web 一致）

```tsx
// 与 Web 完全一样的 API
import { Skeleton } from 'smarty/rn'

export function UserScreen({ isLoading }) {
  return (
    <Skeleton name="user-screen" loading={isLoading}>
      <RealUserScreen />
    </Skeleton>
  )
}
```

### 3.3 Render：bones → View 树

```tsx
// packages/smarty/src/rn/render-rn.tsx
import { View, type ViewStyle } from 'react-native'
import { Shimmer } from './reanimated-shimmer'

export function renderBonesToRN(dsl: SkeletonDSL): JSX.Element {
  return (
    <View style={{ width: dsl.width, height: dsl.height, position: 'relative' }}>
      {dsl.bones.map(b => <Bone key={b.id} bone={b} rootColor={dsl.rootColor} />)}
    </View>
  )
}

function Bone({ bone, rootColor }: { bone: Bone; rootColor: string }): JSX.Element {
  const style: ViewStyle = {
    position: 'absolute',
    left:   `${bone.x}%`,
    top:    bone.y,
    width:  `${bone.w}%`,
    height: bone.h,
    borderRadius: parseRadius(bone.r),
    backgroundColor: bone.color ?? rootColor,
  }
  if (bone.type === 'text' && bone.mode === 'gradient') {
    // RN 无 background-image gradient → 行内多个 View
    return <TextLinesBone bone={bone} style={style} rootColor={rootColor} />
  }
  return <Shimmer style={style} />
}
```

### 3.4 动画：Reanimated worklet

```tsx
// packages/smarty/src/rn/reanimated-shimmer.tsx
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated'
import { useEffect } from 'react'
import type { ViewStyle } from 'react-native'

export function Shimmer({ style }: { style: ViewStyle }): JSX.Element {
  const opacity = useSharedValue(0.85)
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.45, { duration: 900 }), -1, true)
  }, [])
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }))
  return <Animated.View style={[style, animated]} />
}
```

**关键**：`useSharedValue` + `useAnimatedStyle` 在 UI 线程跑，JS 线程繁忙不掉帧（铁律一的 RN 落点）。

### 3.5 降级：无 Reanimated

```tsx
let Shimmer: typeof import('./reanimated-shimmer').Shimmer
try { Shimmer = require('./reanimated-shimmer').Shimmer }
catch { Shimmer = ({ style }) => <View style={style} /> }   // 静态降级
```

### 3.6 Teardown：InteractionManager + 数据态

```tsx
// packages/smarty/src/rn/Skeleton.tsx
import { useEffect, useState } from 'react'
import { InteractionManager } from 'react-native'
import { useSkeletonGate } from '../web/use-skeleton-gate'

export function Skeleton({ name, loading, initialBones, children }: SkeletonProps) {
  const [interactionsDone, setDone] = useState(false)
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setDone(true))
    return () => handle.cancel()
  }, [])
  const show = useSkeletonGate(loading || !interactionsDone, { delay: 0 /* RN 用 0 */, minDuration: 300 })
  if (!show || !initialBones) return <>{children}</>
  return renderBonesToRN(initialBones)
}
```

注意 RN 上 `delay` 通常为 0（首屏导航转场本身就是 ~300 ms 的等待），但 minDuration 仍保留防闪烁。

### 3.7 dev:ske：RN 版

RN 没有 Vite，dev:ske 用 Metro 中间件 + 调试通道：

```ts
// packages/smarty/src/rn/metro-plugin.ts
export function skeletonV2MetroMiddleware(req, res, next) {
  if (req.url !== '/__smarty__/save') return next()
  // 同 [16-step7](./16-step7-DevSave-与dev-ske.md) 端点逻辑，但 platform='rn'
}
```

业务在 `metro.config.js`：

```js
const { skeletonV2MetroMiddleware } = require('smarty/rn/metro')
module.exports = {
  server: { enhanceMiddleware: (mw) => (req, res, next) => skeletonV2MetroMiddleware(req, res, () => mw(req, res, next)) }
}
```

RN App 侧 dev:ske 模式由 env：

```bash
BONEYARD_SKE=1 npx react-native start
```

`<Skeleton>` 内 `__SKELETON_SKE__` 编译期常量由 `babel-plugin-skeleton-v2-rn`（衍生包）注入。

### 3.8 RN 平台没有的能力

- **没有 CSS @media 可扫**：v2 默认断点改用经验值 **`[375, 414]`**（iPhone 标准 / 大屏 Plus/Max；iPad 同 414 兼容）；用 `Dimensions.get('window').width` 决定当前断点；如需更多设备覆盖（如 320 SE / 768 iPad 横版），业务方在 [smarty.config.json `breakpoints.rn.extend`](./01-架构与模型.md) 加
- **没有 FP/LCP/CLS**：KPI 改为 **TTI 感知 / JS 线程帧率不掉帧 / 首个可交互时刻**（[skeleton-architecture-design.md §5.2](../boneyard-main/packages/boneyard/src/skeleton-architecture-design.md)）
- **没有 SSR**：B 路径（运行时）是唯一路径；无 A 路径

---

## 4. 文件改动清单

| 路径 | 操作 |
|---|---|
| `packages/smarty/src/rn/Skeleton.tsx` | 新增 |
| `packages/smarty/src/rn/Bound.tsx` | 新增 |
| `packages/smarty/src/rn/capture.ts` | 新增（measure-based） |
| `packages/smarty/src/rn/render-rn.tsx` | 新增 |
| `packages/smarty/src/rn/reanimated-shimmer.tsx` | 新增 |
| `packages/smarty/src/rn/metro-plugin.ts` | 新增 |
| `packages/smarty/src/rn/index.ts` | 新增（公共 export） |
| `packages/smarty/babel-plugin-rn/index.js` | 新增（编译期 `__SKELETON_SKE__`） |
| `packages/smarty/test/rn/*.test.tsx` | 新增（用 `@testing-library/react-native`） |

---

## 5. 验收

| 检查 | 方法 |
|---|---|
| `<Skeleton name="x" loading>` 在 iOS/Android 模拟器渲染 | 真机 |
| Reanimated worklet 不阻塞 JS 线程：触发长 JS 任务时 shimmer 仍 60fps | `react-native-performance` 监控 |
| 无 Reanimated 时降级为静态骨架，不报错 | unit |
| `InteractionManager` 后骨架自动开始可见（首屏） | RTL-native |
| dev:ske 浏览页面 → `bones/pages/rn/user-screen.bones.json` 出现 | filesystem |
| 多模拟器（iPhone 375 + iPad 768）多次浏览合并断点 | filesystem |
| `<Bound deps>` 与 Web 共享 `dataRegistry` / `useRegionPending` 逻辑 | RTL-native |

---

## 6. 已知坑 & 测试用例

1. **`measure` 是异步**：tree 太深时收集慢（每个节点一次 native bridge）；优化：用 `unstable_batchedUpdates` 或 `ViewManager.measureLayout`
2. **Reanimated 3 必须 babel plugin**：业务 `babel.config.js` 必须含 `react-native-reanimated/plugin`，否则 worklet 转换失败 → 文档强调
3. **`FlatList` 列表抽样**：dev:ske 时 FlatList 内 item 可能未全部渲染（虚拟列表），只能抽到当前可见 item；用 `data.length` 提示 count
4. **图片采样**：RN 内 `Image` 的 `source.uri` 可异步 fetch + sharp 采（同 [17 §3.4](./17-step8-Playwright批量与Visual-Diff.md)）；但生产 App 内 native 模块没有 sharp，dev:ske 阶段在 Metro server 侧采样后回传
5. **Hermes vs JSC**：Reanimated 3 在 Hermes 上工作正常；JSC 上同 fps；无差异
6. **Expo Go 无 Reanimated**：dev:ske 在 Expo Go 内退化静态；建议业务用 Expo Dev Client 或纯 RN
7. **新架构 (Fabric)**：`measure` API 在 Fabric 仍兼容；本设计对 Fabric / Paper 两套渲染器均适用
8. **iOS Safe Area**：RN `<Skeleton>` 内部不处理 SafeArea，bones.json 的 y 值是绝对的；业务方需在 `<Skeleton>` 外包 `<SafeAreaView>`
