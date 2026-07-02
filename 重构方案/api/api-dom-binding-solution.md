# API ↔ DOM 绑定关系:深度方案

> 目标：给定一块被 `<Skeleton>` 包裹的 DOM 区域，精确求出它依赖哪些接口。
> 硬约束：不可修改浏览器引擎、不可只依赖一个未 ship 的 TC39 提案。

---

## 0. 问题的硬性约束（决定什么能做、什么不能做）

### 0.1 语言级约束

| 约束 | 后果 |
|------|------|
| JS 原始值（string/number）不携带元数据 | 值级标注（"这个字符串来自 /api/user"）在赋值后就丢失 |
| `{...obj}` / `JSON.parse` 破坏 Proxy 身份 | Userland Proxy 污点方案不可行 |
| `async/await` 绕过 userland Promise patch | Zone.js 方案不可行（Angular 官方确认） |
| 但 `async/await` **保留闭包作用域** | `const id = xxx; await y; use(id)` — `id` 仍可访问 |

### 0.2 运行时约束

| 约束 | 后果 |
|------|------|
| 浏览器无 `PromiseHook`（只有 Node 有） | 引擎级 async 上下文追踪在浏览器侧不可用 |
| `MutationObserver` 不包含"谁导致的变更" | 纯 MO 方案不可行 |
| CDP 在 headless/Puppeteer 下可用 | baking 阶段可用 CDP |
| TC39 AsyncContext 尚未 ship | 不能作为当前依赖 |

### 0.3 业务约束

| 约束 | 后果 |
|------|------|
| 数据可能经过 store/Context 绕路 | 不能只跟踪直接 props |
| 数据经过 transform（map/filter/格式化） | 不能假设数据形状不变 |
| 老项目可能用裸 `fetch + useState` | 不能只支持 useQuery/useSWR |
| 第三方库内部取数（node_modules） | 静态分析对库内部不可见 |

---

## 1. 所有可能方向的完整评估

### 方向 A：值级追踪（在数据本身上做标记）

**方案：给每个 API 响应的字符串注入不可见 Unicode 水印（zero-width characters）**

```
/api/user 返回 {name: "Alice"} → {name: "Alice\u200B\u200C\u200D..."}  // 编码 requestId
```

| 维度 | 评估 |
|------|------|
| 传播能力 | 完美。水印是值的一部分，经 spread/map/store/Context/await 全部保留 |
| 破坏性 | **致命。** `"Alice\u200B" !== "Alice"`。字符串比较、长度检查、JSON key 查找全部破坏 |
| 生产可用 | 不可。应用会在 baking 阶段崩溃或表现异常 |

**判据：否决。** 即使只在 dev/baking 环境使用，应用逻辑已被破坏，无法正常渲染，baking 结果不可信。

**但有一个变体值得考虑：「数值水位」**——对于 number 类型，注入极小的 ±ε 扰动（如 `100 → 100.0000001`）。对数字比较和计算几乎无影响，但可作为标记。局限是无法覆盖字符串。

### 方向 B：执行上下文追踪（在调用链上做标记）

这是原文档的 traceId 方案。前面已经分析过：浏览器侧缺乏跨 await 的上下文传播机制。

**关键区分：**

```
❌ 跨链传播（原来的思路）：
fetch → .then → .then → setState
         ↑ traceId 需要在这条异步链上自动传播
         需要 PromiseHook 或 AsyncContext，浏览器没有

✅ 闭包传播（新的思路）：
const id = start('/api/user')
const data = await fetch(...)
// id 仍在闭包中，可访问！
setState(data)
```

**结论：`async/await` 不需要特殊传播机制。** 闭包作用域天然保留了变量。问题只出在 `.then()` 传递裸函数引用时，但 Babel 可以把它转换成箭头函数。

### 方向 C：纯静态分析（读代码，不运行）

**目标：** 从源码 AST 中推导「组件 → API」的映射。

**能力边界：**

| 场景 | 能否静态分析 |
|------|------------|
| `useQuery('/api/user')` 直接在组件中 | 能——AST 直接可见 |
| `useSWR('/api/user', fetcher)` | 能——URL 是第一参数 |
| `fetch('/api/user')` 在 useEffect 中 | 能——AST 直接可见 |
| `const {data} = useUserStore()` → store 内部 fetch | 部分能——需要跨文件追踪 |
| `` fetch(`/api/user/${id}`) `` 动态 URL | 不能——`id` 是运行时值 |
| 第三方库内部请求 | 不能——node_modules 不分析 |
| 条件请求（A/B 实验分支） | 不能——静态无法判断走哪个分支 |

**这是唯一零侵入、零破坏的方案。** 对它能覆盖的 ~70% 场景，应该优先使用。

### 方向 D：编译时插桩（Babel/SWC 改造代码）

**核心思路：** 不需要跨异步链传播上下文，而是把 API 调用和它的"消费者"在代码中显式关联起来。

**关键洞察：** 对于 `async/await`，闭包保留了变量。只需要注入追踪代码：

```js
// 原始代码
async function loadUser() {
  const data = await fetch('/api/user').then(r => r.json())
  setUser(data)
}

// Babel 插桩后
async function loadUser() {
  const reqId = __trackStart('/api/user')
  const data = await fetch('/api/user').then(r => r.json())
  // ↑ await 后 reqId 仍在闭包中
  __trackEnd(reqId)
  setUser(data)
  // __currentActiveRequest 现在知道是 reqId
}
```

对于 `.then()` 裸函数引用：
```js
// 原始
fetch('/api/user').then(res => res.json()).then(setUser)

// 插桩后
fetch('/api/user').then(res => res.json()).then(data => {
  __trackEnd(reqId)
  setUser(data)
})
```

对于 **store 绕路**（最难的场景）：
```js
// 原始：store 定义
const useUserStore = create((set) => ({
  user: null,
  fetch: async () => {
    const data = await fetch('/api/user').then(r => r.json())
    set({ user: data })
  }
}))

// 插桩后：在 store 的 setter 上记录 API 来源
const useUserStore = create((set) => ({
  user: null,
  __source_urls: { user: null },  // ← 插桩注入的元数据
  fetch: async () => {
    const reqId = __trackStart('/api/user')
    const data = await fetch('/api/user').then(r => r.json())
    __trackEnd(reqId)
    // 记录：store.user 的数据来自 /api/user
    __recordStoreSource('userStore', 'user', '/api/user')
    set({ user: data })
  }
}))
```

然后当组件读 `useUserStore().user` 时，查 `__recordStoreSource` 即可知道数据来源。

**这个方案不需要：**
- 跨 await 的上下文传播（闭包保留）
- 值级水印（追踪在源码级别）
- CDP 异步栈（追踪在源码级别）
- 任何浏览器新特性

**只需要：一个 Babel/SWC 插件。**

### 方向 E：差分测试（黑盒运行对比）

**流程：**
1. Puppeteer 加载页面
2. 记录正常 DOM 快照（每个 Skeleton 区域）
3. 对每个 API 端点：拦截它返回 `{}` / error → 刷新页面 → 记录 DOM 快照
4. 对比：哪个 Skeleton 区域的 DOM 变了 = 依赖该 API

| 维度 | 评估 |
|------|------|
| 精确度 | 高——DOM 变化是肉眼可见的因果 |
| 覆盖率 | 完整——纯黑盒，不挑代码写法 |
| 成本 | O(N) 次页面加载 |
| 组合效应漏 | 若 API A 和 API B 共同影响区域 X，单独拦截任何一个都能看到 X 变化 → 两者都被正确关联 |
| 非确定性 | 时间戳、动画、轮询等可能引入噪声；需关闭动画、固定时间 |
| 并发请求 | 没问题——每次拦截不同接口，独立测量 |

**O(N) 是否可接受？** 假设一个页面 30 个接口，每次页面加载 3 秒 → ~90 秒。在 CI 构建管道中是完全可以接受的。

**判据：作为兜底方案，在静态分析+插桩覆盖不了的情况下使用。也可作为正确性验证。**

### 方向 F：React Fiber 层级追踪

**思路：** 不追踪值、不追踪调用链。在 React render 阶段，每个组件 render 时记录"我读了哪些 hook 的数据，这些数据来自哪些 API"。在 commit 阶段，将 fiber 映射到 DOM 节点，完成绑定。

```js
// React render 期间（插桩后的组件）
function UserCard() {
  // useQuery 被插桩，返回 {data, __source: {url: '/api/user', reqId: '123'}}
  const { data } = __wrapUseQuery('/api/user')
  const orders = __wrapUseQuery('/api/orders')

  // __componentCollector 记录：UserCard 本次 render 依赖 '/api/user', '/api/orders'
  __registerComponentDeps('UserCard', ['/api/user', '/api/orders'])

  return <div>{data.name}</div>
}

// React commit 阶段
function onCommitFiberRoot(root) {
  // 遍历 host fibers，找到每个 DOM 节点对应的组件
  // 查 __componentCollector 得到该组件的 API 依赖
  // 输出：DOM 节点 → [API 列表]
}
```

**这个方案完全绕开了值追踪和异步链追踪。它只在 React 的生命周期边界做记录。**

### 方向 G：CDP 网络拦截 + DOM 定时快照

CDP 能做的：
- `Network.requestWillBeSent` — 精确知道每个请求的发起时间和 URL
- `Network.responseReceived` — 精确知道每个响应返回的时间
- `DOM.getDocument` / `DOM.querySelector` — 获取 DOM 快照

结合"每个请求单独拦截并观察 DOM 差异"，这就是方向 E 的差分测试的高效实现。

CDP 不能做的（已在前面澄清）：跨 async 传播自定义数据。

### 方向 H：组合式（实际推荐方案）

**按场景覆盖，从零侵入到有侵入，逐级降级：**

```
层级 1: 静态分析 (Babel 插件，零运行时开销)
  ↓ 覆盖不到的场景
层级 2: 编译时插桩 (Babel 插件，编译期注入追踪代码)
  ↓ 覆盖不到的场景
层级 3: 差分测试 (Puppeteer，拦截 API 逐个对比 DOM)
  ↓ 验证
层级 4: 结果校验 (抽样验证绑定正确性)
```

---

## 2. 推荐的可行方案

### 整体流程

```
源码
  │
  ├─→ [Babel 插件: 静态分析]
  │     ├─ 解析组件树
  │     ├─ 提取所有 API 调用及其参数
  │     ├─ 追踪 store → API 的关联
  │     └─ 输出: binding-map-static.json (component → [api_urls])
  │
  ├─→ [Babel 插件: 编译时插桩]
  │     ├─ 注入 __trackStart/__trackEnd 到 API 调用处
  │     ├─ 注入 __recordStoreSource 到 store setter
  │     ├─ 注入 __registerComponentDeps 到组件 render
  │     └─ 输出插桩后的 bundle
  │
  └─→ [Puppeteer Baking]
        ├─ 加载插桩后的页面
        ├─ 触发所有代码路径
        ├─ 收集运行时绑定数据
        ├─ [可选] 差分测试验证
        └─ 输出: binding-map-runtime.json
```

### 层级 1：静态分析详解

**输入：** 源码 AST（通过 Babel parser）

**Step 1: 找 API 调用点**

```js
// 识别模式：
fetch(url)
fetch(url, options)
axios.get(url)
axios.post(url, data)
useQuery(url | {queryFn: () => fetch(url)})
useSWR(url, fetcher)
useEffect(() => { fetch(url) }, [])
```

AST visitor 匹配 `CallExpression`，识别 callee 为 `fetch`/`axios.get`/`useQuery`/`useSWR` 等，提取第一个参数作为 URL。

**Step 2: 找组件**

每个 API 调用所在的最近的函数组件或 hook 函数。

**Step 3: 构建组件→API 映射**

```
UserCard → /api/user
OrderList → /api/orders
Dashboard → [/api/user, /api/orders, /api/stats]
```

**Step 4: 处理 store 绕路**

对于 `const user = useUserStore()` 这种模式：
1. 追踪 `useUserStore` 的定义
2. 在 store 定义中找到 setter 调用（`set({user: data})` 或 `dispatch(action)`）
3. 在 setter 周围找到 fetch 调用
4. 建立间接映射：`useUserStore().user → /api/user`

**局限性及处理：**

| 局限 | 处理 |
|------|------|
| 动态 URL `` `/api/user/${id}` `` | 标记为动态，降级到层级 2/3 |
| 第三方库中的 API 调用 | 库通常有固定 API 模式（如 react-query 的 queryKey），可识别 |
| 条件分支 | 标记所有静态可达的路径 |

**覆盖率估计：~70% 的常见模式**

### 层级 2：编译时插桩详解

**不需要跨 async 传播上下文。利用闭包保留变量。**

**2.1 API 调用插桩**

```js
// 原始：async/await（最常见写法）
async function loadPage() {
  const user = await fetchUser()     // fetchUser 内部调 /api/user
  const orders = await fetchOrders() // /api/orders
  setState({ user, orders })
}

// 插桩后（不需要 async 传播！闭包保留 __reqId）
async function loadPage() {
  const __reqId1 = __trackStart('/api/user')
  const user = await fetchUser()
  __trackEnd(__reqId1)

  const __reqId2 = __trackStart('/api/orders')
  const orders = await fetchOrders()
  __trackEnd(__reqId2)

  __withActiveRequest([__reqId1, __reqId2], () => {
    setState({ user, orders })
  })
}
```

**2.2 Store 插桩**

```js
// Zustand store（原始）
const useUserStore = create((set) => ({
  user: null,
  fetch: async () => {
    const data = await fetch('/api/user').then(r => r.json())
    set({ user: data })
  }
}))

// 插桩后
const useUserStore = create((set) => ({
  user: null,
  __api_source: {},  // ← 插桩注入
  fetch: async () => {
    const __reqId = __trackStart('/api/user')
    const data = await fetch('/api/user').then(r => r.json())
    __trackEnd(__reqId)
    __recordStoreSource('useUserStore', 'user', '/api/user', __reqId)
    set({ user: data })
  }
}))
```

**2.3 组件 render 插桩**

```jsx
// 原始组件
function UserCard() {
  const user = useUserStore(s => s.user)
  const { data: orders } = useQuery('/api/orders')
  return <div>{user?.name} - {orders?.length} orders</div>
}

// 插桩后
function UserCard() {
  const user = useUserStore(s => s.user)
  const { data: orders } = useQuery('/api/orders')

  // 插桩注入：记录当前组件依赖哪些 API
  // user 来自 useUserStore，后者被标记为 /api/user
  // orders 直接来自 useQuery('/api/orders')
  __registerComponentDeps('UserCard', [
    { store: 'useUserStore', key: 'user' },  // → 运行时查 __api_source
    { hook: 'useQuery', url: '/api/orders' }
  ])

  return <div>{user?.name} - {orders?.length} orders</div>
}
```

**2.4 React commit 阶段映射**

```js
// 通过 react-scan 或直接 patch ReactDOM
const originalCreateRoot = ReactDOM.createRoot
ReactDOM.createRoot = function(container, options) {
  const root = originalCreateRoot(container, options)
  const originalRender = root.render
  root.render = function(element) {
    // 在 commit 后，遍历 fiber 树
    const result = originalRender.call(this, element)

    // 遍历 host fibers
    walkFibers(this._internalRoot, (fiber) => {
      if (fiber.tag === HostComponent) {
        const domNode = fiber.stateNode
        const componentName = getNearestComponentName(fiber)
        const deps = __getComponentDeps(componentName)
        if (deps.length > 0) {
          __bindingMap.set(domNode, deps)
        }
      }
    })

    return result
  }
}
```

**2.5 `.then()` 裸函数处理**

```js
// 原始（问题模式）
fetch('/api/user').then(handleResponse)  // handleResponse 可能不在此闭包中

// 插桩后
const __reqId = __trackStart('/api/user')
fetch('/api/user').then(res => {
  __trackEnd(__reqId)
  return handleResponse(res)
})
```

**层级 2 覆盖率估计：~90-95%**

**剩余覆盖不到的情况：**
- 第三方 UI 库内部自己发请求（极其罕见）
- `eval()` 或 `new Function()` 中的动态代码
- WebSocket/SSE（缺乏 HTTP 请求-响应语义）
- Service Worker 拦截的请求

### 层级 3：差分测试详解

**给定页面 P 包含骨架屏区域 [A, B, C]。对每个 API 端点 Ki：拦截 Ki 返回 `{}`，加载页面，对比每个骨架屏区域的 DOM。**

#### 3.1 怎么确定"变了"？

**最关键的约束：我们不是在比较整页的原始 HTML。我们是逐个 `<Skeleton>` 区域、逐个 API 做隔离对比。**

给定一个骨架屏区域（一个已知的 DOM 子树根节点），比较它"正常"时和"拦截 Ki 时"的差异：

##### 3.1.1 比较什么（分等级）

| 等级 | 比较内容 | 提取方式 | 表示"这个骨架区域依赖此 API"的条件 |
|------|---------|---------|----------------------------------|
| **结构指纹** | 子元素的 tagName 序列 + 层级深度 | `[...root.querySelectorAll('*')].map(el => el.tagName)` | 序列不同 = 结构变了 |
| **文本指纹** | 所有文本节点的内容拼接（去除空白归一化） | `root.textContent.replace(/\s+/g,' ').trim()` | 长度/内容变了 |
| **骨架关键区指纹** | 只取 `<Skeleton>` 内部的"叶子"文本节点 | 只比较非空的、可见的文本节点 | 更精细化 |
| **占位指纹** | 识别骨架屏渲染的占位元素（灰色条、闪烁块）vs 真实内容 | 检查 `class` 中是否含 skeleton/placeholder 相关类名 | 占位→真实内容的替换 = 强信号 |

##### 3.1.2 怎么消除噪声

| 噪声来源 | 消除方式 |
|---------|---------|
| 时间戳（"2026-06-29 15:32:01"） | 正则替换所有 ISO 8601 / 常见时间格式为 `__TIMESTAMP__` 后再比较 |
| 随机 ID / UUID | 正则替换 UUID/雪花 ID/hex digest 为 `__ID__` |
| React fiber 内部属性（`data-reactid` 等） | 白名单过滤 attribute |
| CSS 动画状态 | `page.evaluate(() => { document.querySelectorAll('*').forEach(el => el.style.animation = 'none') })` |
| 图片 src（CDN 随机串） | 替换 URL path 中的 hex/hash 段 |
| 懒加载未触发的图片（src 为空 vs 真实 URL） | 强制 `loading="eager"` + 预先滚动到底部 |
| 滚动位置 | 固定 `window.scrollTo(0, 0)` |
| 轮询/定时器继续修改 DOM | 在 `page.evaluate()` 中覆写 `setInterval`/`setTimeout` 为无操作 |

##### 3.1.3 对比算法

```
function skeletonSubtreeChanged(normal, intercepted):
    normal_fp   = extractFingerprint(normal)   // 归一化后的结构化指纹
    inter_fp    = extractFingerprint(intercepted)

    if normal_fp.structure !== inter_fp.structure:
        return CHANGED      // 强信号：DOM 结构变了

    if normal_fp.textHash !== inter_fp.textHash:
        return CHANGED      // 强信号：文本内容变了

    if normal_fp.childCount !== inter_fp.childCount:
        return CHANGED      // 子节点数量变了

    return UNCHANGED
```

**关键：不比较 attribute 的精确值（class 名、style 内联等），只比较文本和结构。** 因为 API 数据影响的是 DOM 的内容和形态，不是 CSS。

#### 3.2 精确度分析

**差分测试能达到多精确？**

##### 能精确检测的：

| 情况 | 示例 | 检测方式 |
|------|------|---------|
| 接口返回后，骨架占位被替换为真实内容 | `<div class="skeleton-line"></div>` → `<span>Alice</span>` | 结构指纹完全不同 |
| 列表项从空变为有内容 | `<ul></ul>` → `<ul><li>...</li><li>...</li></ul>` | childCount 从 0→N |
| 文本从无到有 | `textContent: ""` → `textContent: "Alice"` | textHash 变化 |

##### 会产生假阳性的（报了"变了"但其实是噪声）：

| 情况 | 概率 | 缓解 |
|------|------|------|
| 轮播图 autoplay 改变当前 slide | 中 | 关闭 autoplay / 固定 index |
| 广告/推荐内容（每次不同的个性化推荐） | 中 | 拦截相关 API 时也需要 mock 到相同状态 |
| 随机展示的文案/图片 | 低 | 如果同一个请求返回数据不变，则不会变化 |

##### 会产生假阴性的（没报"变了"但其实依赖）：

| 情况 | 说明 | 缓解 |
|------|------|---------|
| 接口数据影响的是 CSS class 而非结构 | `isVip` 为 true 时加了 `.vip-border`，结构不变 | 将 class 差异也纳入指纹（白名单 class） |
| 接口数据影响了但另一个接口提供了 fallback | API A 失败时，API B 的数据仍能渲染同样的文本 | 同时 mock 多个 API |

##### 最坏情况（会导致绑定不完整）：

```jsx
<Skeleton>
  <UserName />   {/* 依赖 /api/user */}
  <UserAvatar /> {/* 也依赖 /api/user */}
</Skeleton>
```

拦截 `/api/user` 返回 `{}` → `<Skeleton>` 区域的**文本**和**结构**都变了 → 正确检测到依赖 `/api/user`。

但如果：
```jsx
<Skeleton>
  <UserName />   {/* 依赖 /api/user → data.name */}
</Skeleton>
```

且 `/api/user` 返回 `{}` 后组件显示的是 `"Unknown"` 而不是空 → **文本指纹变了，依然能检测到。**

所以假阴性主要发生在：接口返回数据后，DOM 的文本和结构与接口返回空对象时的 DOM **完全一样**。这种情况在实际项目中非常罕见，除非前端代码对所有字段都做了 fallback 处理且 fallback 值和空响应渲染结果一致。

#### 3.3 为什么差分测试是"100%覆盖"但非"100%精确"

"100%"指的是：只要 API 影响了 DOM，理论上就能检测到。不挑代码写法、不挑数据流方式、不挑异步模式。

但不是 100% 精确，因为：
1. **假阳性**：噪声导致的误报（可通过噪声消除降低）
2. **假阴性**：极端 fallback 场景
3. **无法区分"直接影响"和"间接影响"**：API A 的数据让组件 X 重新渲染，组件 X 的渲染导致兄弟组件 Y 的布局变化 → 差分测试会把 Y 的 DOM 变化也归因到 API A

#### 3.4 成本

| 页面规模 | API 数量 | 单次加载耗时 | 总耗时（并行度=3） |
|---------|---------|------------|-----------------|
| 小页面 | ~10 | 2s | ~7s |
| 中页面 | ~30 | 3s | ~30s |
| 大页面 | ~80 | 5s | ~2m |

在 CI 管道中完全可接受。且可以做增量：只对代码变更涉及的页面/组件重新 bake。

---

## 3. 对比原文档方案

| 维度 | 原文档 traceId+CDP 方案 | 本方案 |
|------|------------------------|--------|
| 核心技术 | traceId 沿异步执行链传播 | 闭包保留变量 + Babel 显式关联 |
| async/await 处理 | 需要降级为 Promise，或依赖 CDP async stack（不能传数据） | 不需要——闭包天然保留 |
| CDP 依赖 | 核心依赖 CDP 异步栈 | 仅差分测试用到（层级 3），而且是可选验证 |
| AsyncContext 依赖 | 被视为"中期迁移目标" | 不被依赖 |
| 值追踪 | 明确放弃 | 明确放弃 |
| 可落地性 | 当前不可落地（缺传播机制） | 当前可落地（Babel 插件 + Puppeteer baking） |

---

## 4. 实施优先级

### Phase 1：静态分析（1-2 周）

只做 Babel 插件读 AST，不修改代码。覆盖 ~70% 场景。

**产物：** `binding-map-static.json`

```json
{
  "UserCard": { "apis": ["/api/user"], "confidence": "static" },
  "OrderList": { "apis": ["/api/orders"], "confidence": "static" }
}
```

### Phase 2：编译时插桩 + Puppeteer baking（2-4 周）

Babel 插件改代码 + headless 浏览器收集运行时绑定。覆盖 ~90-95%。

**产物：** `binding-map-runtime.json`（覆盖 Phase 1 的缺口）

### Phase 3：差分测试兜底（1-2 周）

Puppeteer 逐个拦截 API 对比 DOM。覆盖剩余 ~5-10%。

**产物：** 补齐最后的缺口 + 对 Phase 1/2 结果的验证

---

## 5. 不依赖的未来进展

| 技术 | 当前状态 | 对本方案的影响 |
|------|---------|--------------|
| React Compiler (Forget) | 实验阶段 | 已经能分析哪些 JSX 依赖哪些值，可以作为静态分析的增强版基座 |
| TC39 AsyncContext | Stage 2.7 | 如果能落地，层级 2 的插桩会更简洁（全局 active request 用 AsyncContext 代替），但目前不是前提条件 |
| React DevTools trace API | 已存在 | 可以直接读 fiber 树，简化 commit 阶段映射 |

---

## 6. 诚实边界

| 场景 | 能覆盖吗 | 方案 |
|------|---------|------|
| useQuery/useSWR 直链 | 能 | 静态分析 |
| 裸 fetch + async/await + setState | 能 | 编译时插桩 |
| 数据经 Zustand/Redux/Context | 能 | 编译时插桩（给 store 加 source 元数据） |
| 数据经复杂 transform | 能 | 不需要追踪 transform（在组件级追踪，不追踪值） |
| 并发请求 | 能 | 每个请求独立 reqId，闭包保留 |
| 动态 URL | 部分 | 差分测试兜底 |
| 第三方库内部请求 | 部分 | 差分测试兜底 |
| WebSocket/SSE | 困难 | 需要专门策略（按消息帧分配来源 ID） |
| eval / new Function | 不能 | 排除 |
| Service Worker 代理 | 部分 | 需要在 SW 层注入 |