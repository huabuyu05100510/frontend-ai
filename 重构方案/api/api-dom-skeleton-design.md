# API ↔ DOM → Skeleton 屏自动生成：正确的设计

> 前提重置：目标是 **Skeleton 屏自动生成**，不是运行时追踪。
> 这改变了一切。
> 日期：2026-06-30

---

## 1. 重新理解问题

### 错误的问题框架（v1-v5 的方向）
```
"运行时，fetch 的 traceId 怎么跨 async 边界传播到 DOM 写入点？"
```

### 正确的问题框架
```
"API K 还没返回时（loading state），页面哪些 DOM 区域是空的？
 把那些区域换成 Skeleton 组件。"
```

**根本不需要运行时追踪**。需要的是：

```
输入：页面 URL + 已知 API 列表
输出：{ apiUrl → 受影响的 DOM 区域 + 对应的 Skeleton 组件代码 }
```

---

## 2. 核心方法：Mock-Diff（反事实干预）

### 2.1 直觉

```
正常加载页面 → 数据完整的 DOM（baseline）
Mock API K 为空 → 数据缺失的 DOM（empty state）

diff(baseline, empty_state) = "API K 负责填充的区域"
```

这是 Pearl 因果阶梯的 **L2 干预**（do-calculus），是建立因果关系的黄金标准。
不是相关性，是真正的因果：**拿走 K，那些 DOM 就消失了**。

### 2.2 完整流程

```
┌─────────────────────────────────────────────────────┐
│  Step 1: Discovery（一次）                           │
│  · 正常访问页面，录制所有 API 请求（HAR）            │
│  · 得到 API 列表 = [K_1, K_2, ..., K_n]             │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  Step 2: Baseline Capture（一次）                    │
│  · 所有 API 正常返回                                 │
│  · 截取：DOM 快照 + 视觉截图 + 元素位置信息          │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  Step 3: Mock-Diff（每个 API 一次）                  │
│  · Mock K_i 返回 loading/空响应                      │
│  · 截取：DOM 快照 + 视觉截图                         │
│  · diff(baseline, mock_i) → affected regions         │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  Step 4: Skeleton 代码生成                           │
│  · 分析每个受影响区域的形状（文字行/图片/列表/卡片） │
│  · 生成对应的 Arco Skeleton 组件                     │
│  · 生成加载条件逻辑                                  │
└─────────────────────────────────────────────────────┘
```

---

## 3. Step 1 & 2：Discovery + Baseline

```ts
// playwright/skeleton-discovery.ts
import { chromium } from 'playwright'

export async function discover(pageUrl: string) {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    recordHar: { path: 'session.har' }   // 自动录制所有请求
  })
  const page = await context.newPage()

  // 访问页面，等待所有 API 完成
  await page.goto(pageUrl)
  await page.waitForLoadState('networkidle')

  // Baseline：完整 DOM 快照
  const baseline = await captureState(page)

  await context.close()
  await browser.close()

  // 从 HAR 提取 API 列表
  const har = JSON.parse(fs.readFileSync('session.har', 'utf-8'))
  const apis = har.log.entries
    .filter(e => isAPIRequest(e.request.url))
    .map(e => ({
      url: normalizeURL(e.request.url),  // 去掉动态参数
      method: e.request.method,
      responseShape: inferShape(e.response.content.text)
    }))

  return { baseline, apis }
}
```

---

## 4. Step 3：Mock-Diff（核心）

```ts
export async function mockDiff(pageUrl: string, api: APIInfo, baseline: PageState) {
  const browser = await chromium.launch()
  const page = await browser.newPage()

  // Mock 这个 API 返回"空响应"
  await page.route(api.url, route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildEmptyResponse(api.responseShape))
      // buildEmptyResponse:
      //   { name: "Alice", age: 30 }  → { name: "", age: 0 }
      //   [{ id: 1, title: "..." }]  → []
      //   { data: [...], total: 100 } → { data: [], total: 0 }
    })
  })

  await page.goto(pageUrl)
  await page.waitForLoadState('networkidle')

  const mockState = await captureState(page)
  await browser.close()

  // Diff：找出变化的节点
  const diff = semanticDiff(baseline, mockState)

  return {
    api: api.url,
    affectedRegions: diff.changedNodes,   // 内容变化的节点
    disappearedNodes: diff.removedNodes,  // 完全消失的节点
    appearedNodes: diff.addedNodes        // 出现的节点（如空状态提示）
  }
}

// 构造空响应（不返回 null，否则页面可能崩溃）
function buildEmptyResponse(shape: any): any {
  if (Array.isArray(shape)) return []
  if (shape === null || shape === undefined) return null
  if (typeof shape === 'string') return ''
  if (typeof shape === 'number') return 0
  if (typeof shape === 'boolean') return false
  if (typeof shape === 'object') {
    return Object.fromEntries(
      Object.entries(shape).map(([k, v]) => [k, buildEmptyResponse(v)])
    )
  }
  return shape
}
```

---

## 5. captureState：语义快照（不是 innerHTML 字符串）

```ts
interface NodeState {
  selector: string          // 稳定的 CSS 选择器
  text: string              // textContent（截断）
  visible: boolean          // 是否可见
  boundingBox: DOMRect      // 视觉位置和尺寸
  hasImage: boolean         // 是否有图片
  childCount: number        // 子元素数量
  dataAttrs: Record<string, string>  // data-* 属性
}

async function captureState(page: Page): Promise<NodeState[]> {
  return page.evaluate(() => {
    const results: NodeState[] = []
    const all = document.querySelectorAll(
      // 只关心"叶子级"内容节点，不关心纯布局容器
      'p, span, h1, h2, h3, h4, td, li, [data-testid], img, ' +
      '.arco-typography, .arco-table-td, .arco-list-item'
    )

    all.forEach(el => {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return  // 不可见节点跳过

      results.push({
        selector: getStableSelector(el),
        text: el.textContent?.trim().slice(0, 200) ?? '',
        visible: el.offsetParent !== null,
        boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        hasImage: el.tagName === 'IMG' || !!el.querySelector('img'),
        childCount: el.children.length,
        dataAttrs: getDataAttrs(el)
      })
    })

    return results
  })
}

// 生成稳定选择器（不依赖随机 class，优先用 data-testid / id）
function getStableSelector(el: Element): string {
  if (el.id) return `#${el.id}`
  if (el.dataset.testid) return `[data-testid="${el.dataset.testid}"]`

  // 回退到结构路径
  const parts = []
  let current: Element | null = el
  while (current && current !== document.body) {
    const tag = current.tagName.toLowerCase()
    const index = Array.from(current.parentElement?.children ?? []).indexOf(current)
    parts.unshift(`${tag}:nth-child(${index + 1})`)
    current = current.parentElement
  }
  return parts.join(' > ')
}
```

---

## 6. semanticDiff：有意义的差异

```ts
function semanticDiff(baseline: NodeState[], mockState: NodeState[]) {
  const baseMap = new Map(baseline.map(n => [n.selector, n]))
  const mockMap = new Map(mockState.map(n => [n.selector, n]))

  const changedNodes = []
  const removedNodes = []
  const addedNodes = []

  // 找变化的节点
  for (const [selector, base] of baseMap) {
    const mock = mockMap.get(selector)

    if (!mock) {
      // 节点消失了
      removedNodes.push({ selector, was: base })
      continue
    }

    const changes = []

    // 文字内容变化（主要判断条件）
    if (base.text && !mock.text) {
      changes.push({ type: 'text-emptied', was: base.text })
    } else if (base.text !== mock.text && levenshtein(base.text, mock.text) > 5) {
      changes.push({ type: 'text-changed', was: base.text, now: mock.text })
    }

    // 可见性变化
    if (base.visible && !mock.visible) {
      changes.push({ type: 'became-invisible' })
    }

    // 子节点数量变化（列表场景）
    if (base.childCount > 0 && mock.childCount === 0) {
      changes.push({ type: 'list-emptied', wasCount: base.childCount })
    }

    if (changes.length > 0) {
      changedNodes.push({ selector, boundingBox: base.boundingBox, changes })
    }
  }

  // 新增节点（空状态占位符）
  for (const [selector, mock] of mockMap) {
    if (!baseMap.has(selector)) {
      addedNodes.push({ selector, node: mock })
    }
  }

  return { changedNodes, removedNodes, addedNodes }
}
```

---

## 7. Step 4：Skeleton 代码生成

### 7.1 区域形状识别

```ts
type SkeletonShape =
  | 'text-line'      // 单行文字（宽 > 高 * 5）
  | 'text-paragraph' // 多行文字
  | 'image'          // 图片
  | 'avatar'         // 圆形图片（宽≈高）
  | 'list-item'      // 列表行
  | 'card'           // 卡片区域
  | 'table-row'      // 表格行

function inferShape(node: NodeState): SkeletonShape {
  const { width, height } = node.boundingBox
  const ratio = width / height

  if (node.hasImage) {
    return ratio > 0.8 && ratio < 1.2 ? 'avatar' : 'image'
  }
  if (node.selector.includes('td') || node.selector.includes('th')) {
    return 'table-row'
  }
  if (node.selector.includes('li') || node.selector.includes('list-item')) {
    return 'list-item'
  }
  if (height > 100 && width > 200) return 'card'
  if (ratio > 8) return 'text-line'
  if (height > 60) return 'text-paragraph'
  return 'text-line'
}
```

### 7.2 Arco Skeleton 组件生成

```ts
function generateSkeletonCode(regions: AffectedRegion[], apiUrl: string): string {
  const shapes = regions.map(r => ({
    shape: inferShape(r),
    boundingBox: r.boundingBox,
    selector: r.selector
  }))

  const skeletonParts = shapes.map(s => {
    switch (s.shape) {
      case 'text-line':
        return `<Skeleton.Line rows={1} style={{ width: '${s.boundingBox.width}px' }} />`
      case 'text-paragraph':
        return `<Skeleton.Line rows={3} />`
      case 'image':
        return `<Skeleton.Image style={{ width: '${s.boundingBox.width}px', height: '${s.boundingBox.height}px' }} />`
      case 'avatar':
        return `<Skeleton.Shape shape="circle" style={{ width: '${s.boundingBox.width}px' }} />`
      case 'list-item':
        return `<Skeleton text={{ rows: 1 }} image={{ shape: 'square' }} />`
      case 'card':
        return `<Skeleton text={{ rows: 3 }} image />`
      case 'table-row':
        return `<Skeleton.Line rows={1} />`
    }
  })

  // 生成条件渲染代码
  const loadingVar = urlToLoadingVarName(apiUrl)
  // /api/user/profile → isUserProfileLoading

  return `
// 自动生成 - API: ${apiUrl}
// 影响区域数: ${regions.length}
{${loadingVar} ? (
  <Skeleton animation loading>
    ${skeletonParts.join('\n    ')}
  </Skeleton>
) : (
  /* 原有内容 */
)}
`
}
```

### 7.3 输出格式

```ts
// 最终产出：binding-map.json
{
  "generatedAt": "2026-06-30T...",
  "page": "/dashboard",
  "bindings": [
    {
      "api": "/api/dashboard/stats",
      "method": "GET",
      "affectedSelectors": [
        "#total-users",
        "#revenue-card",
        ".stats-chart"
      ],
      "skeletonCode": "...",
      "confidence": 0.95,
      "evidence": "mock-diff"
    },
    {
      "api": "/api/users/list",
      "method": "GET",
      "affectedSelectors": [
        ".user-table tbody"
      ],
      "skeletonCode": "...",
      "confidence": 0.98,
      "evidence": "mock-diff"
    }
  ]
}
```

---

## 8. 为什么这个方案是对的

### 8.1 之前所有方案错在哪里

```
v1-v5 的问题：
  试图在"运行时"追踪"fetch → setState → DOM"的因果链

  这是在解决一个比需要的更难的问题。
  Skeleton 屏不需要知道"数据是怎么流过去的"
  只需要知道"这块 DOM 是不是因为这个 API 而存在"
```

### 8.2 Mock-Diff 为什么正确

```
不是相关性（"这两件事同时发生了"）
而是因果性（"拿走 K，D 就消失了"）

Pearl 因果阶梯 L2 干预：do(K = ∅) → observe(D)
这是建立因果关系最可靠的方式，没有之一
```

### 8.3 需要解决的实际问题（不是 async 传播）

| 真正的问题 | 解决方式 |
|-----------|---------|
| API URL 有动态参数 `/api/user/123` | 正则归一化 `/api/user/:id` |
| 页面需要登录态 | Playwright 存储 auth state |
| 应用状态不确定（随机/时间） | Mock Date、固定随机数种子 |
| API 之间有依赖（先登录再查数据） | 只 mock 目标 API，其余正常 |
| 列表 API 返回空数组导致布局变化 | 返回 1 条空数据而不是空数组 |
| 多页面 / 多路由 | 对每个路由分别运行 |

---

## 9. 与 Arco Design 的集成

### 9.1 检测 Arco 组件

```ts
// 识别页面里用的 Arco 组件
const ARCO_COMPONENTS = {
  'arco-table': 'table',
  'arco-list': 'list',
  'arco-card': 'card',
  'arco-descriptions': 'descriptions',
  'arco-statistic': 'statistic',
}

// 生成对应的 Arco Skeleton
function getArcoSkeleton(componentClass: string, region: AffectedRegion) {
  if (componentClass.includes('arco-table')) {
    return `<Skeleton text={{ rows: 5 }} />`
  }
  if (componentClass.includes('arco-statistic')) {
    return `<Skeleton.Line rows={2} />`
  }
  // ...
}
```

### 9.2 直接输出可用的 TSX

```tsx
// 自动生成的 DashboardSkeleton.tsx
import { Skeleton } from '@arco-design/web-react'

interface Props {
  loadingStates: {
    stats: boolean      // /api/dashboard/stats
    userList: boolean   // /api/users/list
  }
}

export function DashboardSkeleton({ loadingStates }: Props) {
  return (
    <div>
      {/* Stats 区域 */}
      <div className="stats-row">
        {loadingStates.stats ? (
          <Skeleton animation loading style={{ width: 300 }}>
            <Skeleton.Line rows={2} />
          </Skeleton>
        ) : <StatsCards />}
      </div>

      {/* 用户列表区域 */}
      <div className="user-table-container">
        {loadingStates.userList ? (
          <Skeleton animation loading>
            <Skeleton text={{ rows: 8 }} />
          </Skeleton>
        ) : <UserTable />}
      </div>
    </div>
  )
}
```

---

## 10. 实施计划（3 周）

```
Week 1: 核心 Mock-Diff 引擎
  · Playwright 录制 + HAR 解析
  · captureState + semanticDiff 实现
  · 验证：能正确识别哪些 DOM 因 mock 而变化

Week 2: Skeleton 生成器
  · 形状识别（text/image/list/card/table）
  · Arco Skeleton 代码生成
  · binding-map.json 输出

Week 3: CLI 工具 + CI 集成
  · npx arco-skeleton analyze --url http://localhost:3000/dashboard
  · 输出 skeleton 组件 + binding map
  · CI 里检测 binding map 变化（API 改了 → skeleton 需要更新）
```

---

## 11. 一句话总结

**Skeleton 屏的 API↔DOM 绑定问题，正确答案是 Mock-Diff（反事实干预）：把 API mock 成空，看哪块 DOM 消失，那块就是 Skeleton 区域。不需要任何运行时追踪、async 传播、或 prototype 污染。**
