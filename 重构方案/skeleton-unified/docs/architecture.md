# Skeleton Unified - 统一骨架屏生成算法架构文档

## 一、背景与问题

### 现有方案的核心问题

| 问题 | boneyard-main | smarty-skeleton-toolchain |
|---|---|---|
| 坐标系 | x/w=%, y/h=px（混合） | 全百分比 |
| RN 支持 | 依赖 Fiber 私有 API（生产被混淆） | 无 |
| 小程序支持 | 无 | 无 |
| 调度器 | 无分片（rIC 不跨平台） | rIC 分片（不适用 RN/小程序） |
| 算法复用 | 三套独立算法 | 三套独立算法 |

### 重构目标

1. **统一坐标系**：全百分比（x/y/w/h 均为容器百分比）+ 容器 `aspectRatio`
2. **平台无关核心**：`@skeleton/core` 无任何平台 API 依赖
3. **统一适配器接口**：`PlatformAdapter` 抽象各平台差异
4. **跨平台调度**：Web=rIC，RN=InteractionManager，小程序=wx.nextTick
5. **全平台覆盖**：React/H5、RN、Taro/微信小程序

---

## 二、坐标系规范

### 全百分比坐标

```
Bone {
  x = (node.left - root.left) / root.width * 100
  y = (node.top  - root.top)  / root.height * 100
  w = node.width  / root.width  * 100
  h = node.height / root.height * 100
}
```

### 容器高度推导

渲染时通过 `aspectRatio = capturedWidth / capturedHeight` 撑开容器：

```css
/* Web */
.skeleton-container {
  position: relative;
  width: 100%;
  padding-top: calc(1 / aspectRatio * 100%);
}
```

```jsx
// RN
<View style={{ width: '100%', aspectRatio: data.aspectRatio }} />
```

### 固定宽度约束

元素 `flex-shrink:0` 或宽度 < 父宽 40% 时，设置 `minW === maxW === w`：

```css
/* 渲染时 */
.bone-fixed { min-width: W%; max-width: W%; }
```

---

## 三、包结构

```
@skeleton/core          纯算法，无平台依赖
  └── types.ts          统一类型（Bone/SkeletonData/NodeMeasurement）
  └── extract.ts        核心提取算法
  └── topology.ts       拓扑压缩（冗余包装层移除）
  └── scheduler.ts      分片调度器接口 + 实现
  └── compressor.ts     二进制编码 + LZW 压缩
  └── utils.ts          工具函数

@skeleton/adapter-web   浏览器 DOM 适配器
  └── adapter.ts        getBoundingClientRect + getComputedStyle
  └── storage.ts        IndexedDB 存储

@skeleton/adapter-rn    React Native 适配器
  └── adapter.ts        ref.measure()（稳定 API）
  └── scheduler.ts      InteractionManager 调度器

@skeleton/adapter-taro  Taro 跨端适配器
  └── adapter.ts        H5=DOM / 小程序=createSelectorQuery
  └── storage.ts        Taro.setStorageSync

@skeleton/renderer-react  React/H5 渲染组件
  └── Skeleton.tsx      主组件（pulse/shimmer 动画）
  └── hooks.ts          useSkeletonCapture / useBonesFromStorage
  └── runtime.ts        HTML 字符串渲染（SSR）

@skeleton/renderer-rn   RN 渲染组件
  └── Skeleton.tsx      Animated 动画

@skeleton/renderer-taro Taro 跨端渲染组件
  └── Skeleton.tsx      WXML/div 兼容

@skeleton/toolchain     构建工具
  └── vite-plugin.ts    Vite 开发插件（Playwright + HMR）
  └── taro-plugin.ts    Taro 构建插件
  └── cli.ts            capture / native 命令
```

---

## 四、核心算法

### 4.1 提取算法融合

三个来源的最优策略合并到 `@skeleton/core/extract.ts`：

| 判定 | 来源 | 实现 |
|---|---|---|
| 原子叶节点（img/svg/button） | boneyard | ATOMIC_LEAF_TAGS |
| 语义叶节点（p/h1/li） | boneyard | SEMANTIC_LEAF_TAGS + leafTags 配置 |
| 枚举叶节点（canvas/audio/pre） | smarty-skeleton | ATOMIC_LEAF_TAGS 扩展 |
| 有文本直接子节点 | smarty-skeleton | isLeaf 判定 |
| 溢出容器裁剪 | smarty-skeleton | getVisibleRect |
| 容器背景识别 | boneyard | hasVisualSurface |
| 冗余包装层压缩 | Trinity | collapseRedundantWrappers |

### 4.2 拓扑压缩

```
原始树：root → redundant-wrapper → real-content
压缩后：root → real-content

条件（全部满足才压缩）：
1. rect 与父节点完全重合（±1px）
2. 无视觉样式（背景/边框/阴影）
3. 非语义节点（table/form 等保留）
4. 非叶节点
```

效果：减少 30-50% 处理节点数，骨架更精准。

### 4.3 坐标转换

```typescript
function rectToBone(rect, rootRect, styles): Bone {
  const x = (rect.left - rootRect.left) / rootRect.width * 100
  const y = (rect.top  - rootRect.top)  / rootRect.height * 100
  const w = rect.width  / rootRect.width  * 100
  const h = rect.height / rootRect.height * 100
  // 固定宽度：minW === maxW === w
  // CSS min/max：也转百分比
  return { x, y, w, h, r, minW?, maxW?, minH?, maxH? }
}
```

### 4.4 调度器对比

| 平台 | 调度器 | 批次大小 | 原理 |
|---|---|---|---|
| Web | requestIdleCallback | 动态（剩余时间/0.1ms） | 浏览器空闲帧 |
| Web 降级 | setTimeout(0) | 50 | 宏任务间隙 |
| RN | InteractionManager | 50 | 动画结束后执行 |
| 小程序 | wx.nextTick | 50 | 下一帧执行 |
| 构建期 | 同步 | ∞ | 无 UI，直接执行 |

### 4.5 压缩格式（v2）

```
魔数: SKBD (4B) + 版本: 0x02 (1B)
aspectRatio*1000: Uint32 (4B)
capturedWidth: Uint32 (4B)
name: Uint16 length + UTF8 bytes
platform: Uint8 (0=web/1=rn/2=taro-mp/3=taro-h5)
capturedAt: Uint32 (4B，精度秒)
boneCount: Uint16 (2B)

每条骨骼 (可变长，最小9B，最大21B)：
  x*100: Uint16 (2B)
  y*100: Uint16 (2B)
  w*100: Uint16 (2B)
  h*100: Uint16 (2B)
  flags: Uint8  (bit0=hasR, bit1=rIs50%, bit2=c, bit3=hasMinW, bit4=hasMaxW, bit5=hasMinH, bit6=hasMaxH)
  r*10: Uint16  (仅 bit0 && !bit1)
  minW*100: Uint16 (仅 bit3)
  maxW*100: Uint16 (仅 bit4)
  minH*100: Uint16 (仅 bit5)
  maxH*100: Uint16 (仅 bit6)

→ LZW 压缩
```

总体积：原始 JSON 的 20-30%。

---

## 五、平台适配器设计

### Web 适配器

```
measureDOM(el: Element): NodeMeasurement
  ↓
measureElement(el)
  → getBoundingClientRect() → getVisibleRect(裁剪溢出)
  → getComputedStyle() → extractStyles()
  → isLeafElement() → isFixedSize()
  → 递归 children（叶节点停止递归）
```

溢出裁剪逻辑（getVisibleRect）：
```
沿 parentElement 向上查找 overflow:hidden/auto/scroll 的容器
将节点 rect 与容器可见区域做交叉（max left, max top, min right, min bottom）
```

### RN 适配器

```
<SkeletonCapture name="card">
  <View ref={captureRef} onLayout={handleLayout}>
    <CardContent />
  </View>
</SkeletonCapture>
↓
loading→false 后：
  ref.measure() → MeasureResult → NodeMeasurement
  InteractionManager → 等待动画结束
  extractBones → packSkeletonData → AsyncStorage
```

### Taro 适配器

```
小程序端：
  Taro.createSelectorQuery()
    .selectAll('[data-ske-node]')
    .fields({ rect, computedStyle })
    .exec(results) → NodeMeasurement[]

H5 端：
  直接复用 @skeleton/adapter-web
```

---

## 六、构建工具

### Vite 插件工作流

```
vite serve 启动
  → 2s 延迟
  → Playwright 无头 Chromium
    → 注入 __SKE_SNAPSHOT 脚本
    → 逐路由 × 逐断点 访问
    → page.$$('[data-ske-name]')
    → 执行 __SKE_SNAPSHOT(el, name)
    → 生成 .bones.json（全百分比）
  → 写 registry.ts
  → HMR 监听（debounce 1500ms 重捕获）
  → FNV1a32 哈希增量构建（未变化跳过）
```

### CLI 命令

```bash
# 自动捕获（自动发现 dev server）
pnpm skeleton capture

# 指定参数
pnpm skeleton capture \
  --url http://localhost:5173 \
  --routes / /product /user \
  --breakpoints 375 768 1280 \
  --out src/bones

# 使用配置文件
pnpm skeleton capture --config skeleton.config.json

# 复用已有 Chrome（保留 Cookie/Session）
pnpm skeleton capture --cdp http://localhost:9222

# 接收 RN 骨架数据
pnpm skeleton native --out src/bones --port 9999
```

---

## 七、使用示例

### React/H5

```tsx
// 构建期生成的骨架数据
import productCardBones from './src/bones/product-card.bones.json'

// 组件
<Skeleton
  loading={isLoading}
  bones={productCardBones}
  animation="shimmer"
>
  <ProductCard />
</Skeleton>
```

组件标记（供 Vite 插件捕获）：
```tsx
<div data-ske-name="product-card">
  <ProductCard />
</div>
```

### React Native

```tsx
import { SkeletonRN } from '@skeleton/renderer-rn'
import bones from './bones/product-card.bones.json'

<SkeletonRN loading={isLoading} bones={bones} animation="pulse">
  <ProductCard />
</SkeletonRN>
```

### Taro 小程序

```tsx
import { SkeletonTaro } from '@skeleton/renderer-taro'
import bones from './bones/product-card.bones.json'

<SkeletonTaro loading={isLoading} bones={bones}>
  <ProductCard />
</SkeletonTaro>
```

小程序节点标记（供适配器查询）：
```tsx
<View className="product-card" data-ske-root>
  <Image data-ske-node data-ske-tag="image" src={product.image} />
  <Text data-ske-node data-ske-tag="text" data-ske-leaf="1">{product.name}</Text>
  <View data-ske-node data-ske-tag="view">{product.price}</View>
</View>
```

---

## 八、调试工具

### 骨架预览（开发模式）

```tsx
// 在任意页面显示骨架叠加层（调试用）
import { renderSkeletonToHTML } from '@skeleton/renderer-react'

// 将骨架 HTML 注入到 #debug-overlay
document.getElementById('debug-overlay')!.innerHTML =
  renderSkeletonToHTML(bonesData, { animation: 'solid', color: '#ff000033' })
```

### CLI 调试

```bash
# 预览骨架效果
pnpm skeleton preview --bones src/bones/product-card.bones.json

# 对比模式（骨架 + 真实内容并排）
pnpm skeleton debug --url http://localhost:5173 --route /product
```

---

## 九、迁移指南

### 从 boneyard-main 迁移

1. 骨骼坐标：原版 `y/h` 是绝对像素 → 新版全百分比
   ```
   // 原版
   { x: 2.67, y: 10, w: 94.67, h: 40 }  // y/h 是 px

   // 新版（高度 40px，容器高度 200px）
   { x: 2.67, y: 5, w: 94.67, h: 20 }   // y/h 是 %
   ```

2. 容器高度：原版用 `height: Npx` → 新版用 `padding-top: 1/aspectRatio * 100%`

3. 注册方式：原版 `registerBones()` → 新版直接传 `bones` prop

### 从 smarty-skeleton 迁移

1. 骨架存储：原版 IndexedDB (DSL format) → 新版 IndexedDB (binary+LZW)
2. DSL 类型：`{ boxes, bgs, borders }` → `SkeletonData { bones[] }`
3. 渲染：原版三层叠加 → 新版单层绝对定位

---

## 十、测试策略

```
packages/core/src/__tests__/
  utils.test.ts       toPercent/parseRadius/adjustColor 等工具函数
  topology.test.ts    拓扑压缩（冗余包装层检测 + 路径压缩）
  extract.test.ts     骨骼提取（坐标精度 + 叶节点 + 容器骨骼 + 固定宽度）
  compressor.test.ts  二进制编解码往返 + LZW + Base64

packages/adapter-web/src/__tests__/
  adapter.test.ts     DOM 测量（jsdom 模拟）

packages/renderer-react/src/__tests__/
  Skeleton.test.tsx   组件渲染（React Testing Library）

运行：
  pnpm test           所有测试
  pnpm test:watch     监听模式
  pnpm typecheck      类型检查
```
