# 跨端骨架屏系统设计方案

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        开发阶段（构建时）                          │
│                                                                   │
│   Web (H5)          React Native          小程序                  │
│   Playwright        BoneScan              自动化 API              │
│   extract.ts        Fiber+measureLayout   selectorQuery           │
│       ↓                  ↓                    ↓                   │
│   SkeletonDescriptor   bones坐标            bones坐标              │
│       ↓                  ↓                    ↓                   │
│   layout.ts 重算      直接快照              直接快照               │
│       └──────────────────┴────────────────────┘                   │
│                          ↓                                        │
│                    bones.json + registry.js                       │
│                          ↓                                        │
│                   提交至代码仓库                                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        运行时（按需生成）                           │
│                                                                   │
│   命中 bones.json → 直接渲染                                       │
│   未命中          → 调度器排队 → layout.ts 实时计算 → IndexDB 缓存  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、三端设计方案

### 2.1 Web (H5)

#### 扫描阶段

```
开发者本地启动 dev server
      ↓
CLI 启动 Playwright，注入 window.__BONEYARD_BUILD = true
      ↓
遍历所有断点宽度，调整视口
      ↓
extract.ts 读取 getComputedStyle + getBoundingClientRect
      ↓
生成完整 SkeletonDescriptor（含 font/lineHeight/padding/flex 等）
      ↓
写入 bones.json + registry.js
```

#### 运行时

```
layout.ts(descriptor, currentWidth) → 实时计算骨架坐标
```

Web 端信息最完整，是唯一能走描述符重算路线的端。

#### 登录态处理

优先级：
1. `fixture` prop 提供假数据，绕开登录
2. Playwright 注入测试账号 Cookie（CI secret）
3. Mock 服务拦截接口

---

### 2.2 React Native

#### 扫描阶段

```
开发者本地运行 App（模拟器或真机）
      ↓
组件内嵌 <BoneScan> 或 <BoneScanResponsive>
      ↓
React Fiber 树遍历 + UIManager.measureLayout 测量坐标
      ↓
读取 memoizedProps.style（圆角、背景色）
      ↓
POST http://[host]:9999/bones 上报给 CLI
      ↓
CLI 接收写入 bones.json
```

#### 多断点处理

```jsx
<BoneScanResponsive breakpoints={[375, 390, 428]}>
  <MyComponent />
</BoneScanResponsive>

// 同时渲染三个不同宽度容器，并行扫描，一次上报全部断点
```

#### 局限性

- 拿不到 font/lineHeight/padding/flex 等布局属性
- 只能快照当前坐标，宽度变化导致的换行/flex重排无法重算
- 字体缩放通过监听 `fontScale` 重新扫描处理

---

### 2.3 小程序

#### 扫描阶段

**方案A（推荐）：开发者工具自动化 API**

```js
// CLI 主动控制，不需要 App 主动上报
const automator = require('miniprogram-automator')
const mp = await automator.launch({ projectPath: './miniprogram' })
const page = await mp.currentPage()

// 遍历所有标记了 data-bone 的元素
const elements = await page.$$('[data-bone]')
const root = await page.$('[data-bone-root]')
const rootRect = await root.boundingClientRect()

const bones = await Promise.all(elements.map(async el => {
  const rect = await el.boundingClientRect()
  return {
    x: +((rect.left - rootRect.left) / rootRect.width * 100).toFixed(4),
    y: Math.round(rect.top - rootRect.top),
    w: +(rect.width / rootRect.width * 100).toFixed(4),
    h: Math.round(rect.height),
  }
}))
```

**方案B（降级）：wx.createSelectorQuery 上报**

```js
// 组件内，类似 RN 的 BoneScan
function scanAndReport(name, rootSelector) {
  const query = wx.createSelectorQuery()
  query.select(rootSelector).boundingClientRect()
  query.selectAll('[data-bone]').boundingClientRect()
  query.exec(([rootRect, rects]) => {
    const bones = rects.map(rect => ({
      x: +((rect.left - rootRect.left) / rootRect.width * 100).toFixed(4),
      y: Math.round(rect.top - rootRect.top),
      w: +(rect.width / rootRect.width * 100).toFixed(4),
      h: Math.round(rect.height),
    }))
    wx.request({
      url: 'http://10.0.2.2:9999/bones',
      method: 'POST',
      data: { name, result: { bones } }
    })
  })
}
```

#### 局限性

- 只能获取坐标和尺寸，无法获取样式属性
- 不走描述符路线，只做快照
- 断点通过切换模拟器屏幕尺寸实现

---

## 三、断点策略

### 3.1 默认断点

```js
// boneyard.config.json
{
  "breakpoints": {
    "web": [375, 768, 1280],      // 移动端 / 平板 / 桌面
    "native": [375, 390, 428],    // SE / iPhone 14 / Pro Max
    "miniprogram": [375, 414]     // 主流机型
  }
}
```

### 3.2 开发者自定义

```js
// 项目级覆盖
{
  "breakpoints": {
    "web": [375, 768, 1280, 1440],  // 新增 1440
    "native": [375]                  // 只需要一个断点
  }
}

// 组件级覆盖
<Skeleton
  name="hero-banner"
  breakpoints={[375, 1280]}   // 只生成这两个断点
>
```

### 3.3 运行时选择策略

```ts
function selectBreakpoint(
  currentWidth: number,
  availableBreakpoints: number[]
): number {
  // 找最近的断点（不是最小的，是距离最近的）
  return availableBreakpoints.reduce((nearest, bp) =>
    Math.abs(bp - currentWidth) < Math.abs(nearest - currentWidth)
      ? bp : nearest
  )
}

// 示例
// 当前宽度 430px，断点 [375, 768, 1280]
// 430 距离 375 差 55，距离 768 差 338
// → 选 375 的描述符，用 layout.ts 以 430px 重算
```

---

## 四、开发阶段保障：Git Hook 拦截

### 4.1 哈希绑定机制

每次生成骨架时，同时记录组件文件的哈希：

```json
// bones/profile-card.bones.json
{
  "name": "profile-card",
  "componentHash": "a3f2c1d4e5",   // 组件文件内容哈希
  "generatedAt": "2024-01-15",
  "breakpoints": { ... },
  "bones": { ... }
}
```

### 4.2 pre-commit Hook

```bash
#!/bin/sh
# .husky/pre-commit

node scripts/check-bones.js
```

```js
// scripts/check-bones.js
import { createHash } from 'crypto'
import { readFileSync, readdirSync } from 'fs'
import { glob } from 'glob'

const bonesFiles = glob.sync('src/bones/*.bones.json')
const errors = []

for (const bonesFile of bonesFiles) {
  const bones = JSON.parse(readFileSync(bonesFile))
  if (!bones.componentHash) continue

  // 找到对应的组件文件
  const componentFile = findComponentFile(bones.name)
  if (!componentFile) continue

  // 重新计算哈希
  const currentHash = createHash('md5')
    .update(readFileSync(componentFile))
    .digest('hex')
    .slice(0, 10)

  if (currentHash !== bones.componentHash) {
    errors.push(`
      ❌ ${bones.name} 骨架已过期
         组件: ${componentFile}
         请重新运行: npx boneyard-js build --component ${bones.name}
    `)
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)  // 阻止提交
}

console.log('✅ 所有骨架屏均已同步')
```

### 4.3 提示模式（非阻断）

```js
// boneyard.config.json
{
  "ci": {
    "onStaleBones": "warn"   // "error"（阻断）或 "warn"（提示）
  }
}
```

---

## 五、运行时按需生成 + IndexDB 缓存

### 5.1 缓存层级

```
请求骨架
  ↓
L1: 内存缓存（Map）          ← 当前会话，最快
  ↓ miss
L2: IndexDB 缓存             ← 跨会话持久化
  ↓ miss
L3: layout.ts 实时计算       ← 纯计算，无网络
  ↓ 计算完成
写入 L1 + L2
```

### 5.2 IndexDB Schema

```ts
interface BonesCacheEntry {
  key: string           // `${name}@${breakpoint}`
  bones: Bone[]
  width: number
  height: number
  descriptorHash: string  // 描述符内容哈希，变了就失效
  cachedAt: number        // 时间戳，用于 LRU 清理
}

// DB 名: 'boneyard-cache'
// Store 名: 'bones'
// Index: descriptorHash（用于批量失效）
```

### 5.3 缓存读写

```ts
class BonesCache {
  private memCache = new Map<string, LayoutFragment>()
  private db: IDBDatabase | null = null

  async get(name: string, width: number, descriptorHash: string) {
    const key = `${name}@${normalizeWidthKey(width)}`

    // L1 内存
    if (this.memCache.has(key)) return this.memCache.get(key)!

    // L2 IndexDB
    const entry = await this.dbGet(key)
    if (entry && entry.descriptorHash === descriptorHash) {
      this.memCache.set(key, entry)  // 回填 L1
      return entry
    }

    return null
  }

  async set(name: string, width: number, descriptorHash: string, fragment: LayoutFragment) {
    const key = `${name}@${normalizeWidthKey(width)}`
    this.memCache.set(key, fragment)
    await this.dbSet(key, { ...fragment, descriptorHash, cachedAt: Date.now() })
  }

  // 描述符变更时清除相关缓存
  async invalidate(name: string) {
    const prefix = `${name}@`
    for (const key of this.memCache.keys()) {
      if (key.startsWith(prefix)) this.memCache.delete(key)
    }
    await this.dbDeleteByPrefix(prefix)
  }
}
```

---

## 六、调度器设计

### 6.1 设计目标

```
不阻塞用户交互
骨架生成不影响首屏渲染
批量处理，避免重复计算
优先处理当前可见区域
```

### 6.2 优先级定义

```ts
const enum Priority {
  CRITICAL = 0,    // 当前正在展示骨架的组件（立即执行）
  HIGH     = 1,    // 视口内即将展示的组件
  NORMAL   = 2,    // 视口外但已挂载的组件
  LOW      = 3,    // 预热，尚未挂载
}
```

### 6.3 调度器实现

```ts
interface SchedulerTask {
  id: string
  priority: Priority
  descriptor: CompiledSkeletonDescriptor
  width: number
  resolve: (result: SkeletonResult) => void
  addedAt: number
}

class BoneScheduler {
  private queues: SchedulerTask[][] = [[], [], [], []]  // 按优先级分四个队列
  private running = false
  private idleCallback: number | null = null

  enqueue(task: SchedulerTask) {
    this.queues[task.priority].push(task)

    if (task.priority === Priority.CRITICAL) {
      // CRITICAL 任务同步执行，不等 idle
      this.flush()
    } else {
      this.scheduleFlush()
    }
  }

  private scheduleFlush() {
    if (this.idleCallback) return
    // 利用浏览器空闲时间执行
    this.idleCallback = requestIdleCallback(deadline => {
      this.idleCallback = null
      this.flushWithDeadline(deadline)
    }, { timeout: 2000 })  // 最多等 2s，超时强制执行
  }

  private flushWithDeadline(deadline: IdleDeadline) {
    // 按优先级从高到低处理，超时就停
    for (const queue of this.queues) {
      while (queue.length > 0 && deadline.timeRemaining() > 2) {
        const task = queue.shift()!
        this.execute(task)
      }
    }

    // 还有任务，继续排队
    if (this.queues.some(q => q.length > 0)) {
      this.scheduleFlush()
    }
  }

  private async execute(task: SchedulerTask) {
    const cache = bonesCache  // 全局缓存实例
    const descriptorHash = task.descriptor.sourceFingerprint

    // 先查缓存
    const cached = await cache.get(task.id, task.width, descriptorHash)
    if (cached) {
      task.resolve(cached as any)
      return
    }

    // 缓存未命中，调用 layout.ts 计算
    // layout.ts 内部有自己的 layoutCache，纯同步计算
    const result = computeLayout(task.descriptor, task.width, task.id)

    // 写缓存（异步，不阻塞 resolve）
    cache.set(task.id, task.width, descriptorHash, result as any)

    task.resolve(result)
  }

  // 批量降级：多个相同组件不同宽度，合并计算
  deduplicateTasks() {
    for (const queue of this.queues) {
      const seen = new Map<string, SchedulerTask>()
      queue.forEach(task => {
        const key = `${task.id}@${task.width}`
        if (!seen.has(key)) seen.set(key, task)
        else {
          // 相同任务，共享 resolve
          const existing = seen.get(key)!
          const originalResolve = existing.resolve
          existing.resolve = (result) => {
            originalResolve(result)
            task.resolve(result)
          }
        }
      })
      queue.length = 0
      queue.push(...seen.values())
    }
  }
}

export const scheduler = new BoneScheduler()
```

### 6.4 组件接入调度器

```tsx
function useBones(name: string, descriptor: SkeletonDescriptor, width: number) {
  const [bones, setBones] = useState<Bone[] | null>(null)
  const compiled = useMemo(() => compileDescriptor(descriptor), [descriptor])

  useEffect(() => {
    // 判断优先级：是否在视口内
    const priority = isInViewport(name) ? Priority.HIGH : Priority.NORMAL

    scheduler.enqueue({
      id: name,
      priority,
      descriptor: compiled,
      width,
      resolve: (result) => setBones(result.bones),
      addedAt: Date.now(),
    })
  }, [name, compiled, width])

  return bones
}
```

### 6.5 性能边界

```
单次 layout.ts 计算：< 1ms（纯算术）
IndexDB 读取：      2~5ms
IndexDB 写入：      异步，不阻塞渲染
内存缓存命中：      < 0.1ms
requestIdleCallback：每帧剩余时间内执行，不影响 60fps
```

---

## 七、完整配置文件

```json
// boneyard.config.json
{
  "breakpoints": {
    "web": [375, 768, 1280],
    "native": [375, 390, 428],
    "miniprogram": [375, 414]
  },
  "runtime": {
    "cache": {
      "memory": true,
      "indexDB": true,
      "maxEntries": 500,         // IndexDB 最多缓存条数
      "ttl": 604800000           // 7天过期
    },
    "scheduler": {
      "idleTimeout": 2000,       // requestIdleCallback 超时时间
      "batchSize": 10            // 每个 idle 周期最多处理任务数
    }
  },
  "ci": {
    "onStaleBones": "error",     // "error" 阻断提交，"warn" 只提示
    "hashAlgorithm": "md5"
  },
  "color": "#e0e0e0",
  "darkColor": "#2a2a2a",
  "animate": "shimmer"
}
```

---

## 八、简历描述（10年资深前端）

### 项目描述

> 主导设计并实现跨端骨架屏系统，覆盖 Web (H5)、React Native (iOS/Android)、微信小程序三端，统一骨架数据格式与渲染协议，系统性解决多端骨架屏工程化落地问题。

### 核心亮点（逐条展开）

**1. 编译期/运行时分离架构**

> 设计"冷热路径分离"的布局引擎：编译阶段完成文本分词、样式解析等一次性开销，运行时仅执行纯算术重排。在多断点响应式场景下，同一组件在不同视口宽度下的重排耗时 < 1ms，较传统方案降低 90%+ 的重复计算开销。

**2. 三端差异化扫描策略**

> 针对各端渲染引擎能力差异，设计差异化扫描方案：Web 端基于 Playwright + getComputedStyle 提取完整描述符，支持任意宽度重算；RN 端通过 React Fiber 树遍历 + UIManager.measureLayout 直接快照坐标；小程序端通过微信开发者工具自动化 API 实现 CLI 主动扫描，三端数据统一收敛至 bones.json 格式。

**3. 多级缓存与调度器**

> 设计内存 + IndexDB 双层缓存体系，结合 requestIdleCallback 调度器实现骨架的按需生成与持久化。骨架生成任务按 CRITICAL/HIGH/NORMAL/LOW 四优先级分队列调度，保证当前可见骨架优先生成，不阻塞用户交互，实现 60fps 无感知骨架渲染。

**4. 工程化保障**

> 基于文件内容哈希设计骨架一致性校验机制，通过 Git pre-commit hook 在提交阶段自动比对组件变更与骨架版本，确保骨架屏与真实 UI 不发生版本漂移。结合 CI 阻断策略，将骨架屏的维护成本内化到开发流程，无需人工干预。

**5. 响应式断点设计**

> 设计断点选择策略：构建阶段在各端默认断点（Web: 375/768/1280，RN: 375/390/428）下生成多份骨架数据，运行时按"最近断点"原则匹配描述符，再由布局引擎微调至精确宽度，兼顾存储成本与响应式精度。

### 一句话版本（适合简历空间有限时）

> 主导设计跨端骨架屏系统（Web/RN/小程序），实现编译期描述符提取与运行时多级缓存调度，通过 Git Hook 保障骨架与组件版本一致性，覆盖三端差异化扫描策略与响应式断点匹配，骨架重排耗时 < 1ms。
