# API ↔ DOM 绑定：最终设计方案

> 约束：不改业务代码 / 可改构建 / 可改浏览器环境 / 可改网络层
> 日期：2026-06-30

---

## 1. 问题分解（把大问题切成 4 个独立子问题）

```
子问题 1 · 发号      谁生成 traceId？
子问题 2 · 传播      traceId 怎么跨 async 边界到达 setState？
子问题 3 · 捕获      DOM 写入时怎么知道当前 traceId？
子问题 4 · 验证      怎么确认映射是对的？
```

**每个子问题独立解决，不互相耦合。**

---

## 2. 架构总览

```
┌──────────────────────────────────────────────────────┐
│  Layer 0: 构建期（Vite 插件）                         │
│  · fetch 调用处注入稳定 build-tag（文件名+行号 hash）  │
│  · 无运行时开销                                       │
└───────────────────────┬──────────────────────────────┘
                        │ 构建产物（携带 X-Build-Tag header）
┌───────────────────────▼──────────────────────────────┐
│  Layer 1: Service Worker（唯一可信的 traceId 发号器）  │
│  · 拦截所有 fetch                                     │
│  · 生成 traceId，写入响应 header                      │
│  · 通过 BroadcastChannel 广播给 main thread           │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────┐
│  Layer 2: 运行时 SDK（精简，~300 行）                  │
│  · fetch 拦截器：从响应 header 读 traceId             │
│  · 同步执行跟踪器：情况 A（80%）无需 patch prototype   │
│  · 轻量 Promise.then patch：情况 B（20%）兜底         │
│  · React DevTools Hook：commit 时关联 traceId → DOM   │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────┐
│  Layer 3: 差分测试（Playwright）                      │
│  · 独立验证 Layer 2 的结论                            │
│  · 自动生成 DOM 合约文件                              │
│  · CI 里跑，绑定关系变化时报警                         │
└──────────────────────────────────────────────────────┘
```

---

## 3. Layer 0：构建期 Vite 插件

### 3.1 做什么

在编译阶段，找到每一个 `fetch()` 调用，自动注入一个**稳定的构建期标签**作为请求 header。

```js
// 业务代码（不动）
const data = await fetch('/api/user').then(r => r.json())

// 构建产物（Vite 插件转换后）
const data = await fetch('/api/user', {
  headers: { ...(init?.headers), 'X-Build-Tag': 'useUser.ts:42:f8a3c1' }
}).then(r => r.json())
```

### 3.2 为什么用构建期 tag 而不是运行时 UUID

| | 运行时 UUID | 构建期 tag |
|--|------------|-----------|
| 跨刷新稳定 | ❌（每次不同） | ✅（同一行代码永远同一 tag） |
| 包含源码位置 | ❌ | ✅（文件名+行号） |
| 调试信息 | 无 | 丰富 |

### 3.3 实现要点

```js
// vite-plugin-api-tag.js
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import crypto from 'crypto'

export function apiTagPlugin() {
  return {
    name: 'api-tag',
    transform(code, id) {
      if (id.includes('node_modules')) return  // 只转换业务代码
      if (!/\bfetch\s*\(/.test(code)) return   // 快速过滤

      const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
      let dirty = false

      traverse(ast, {
        CallExpression(path) {
          const callee = path.node.callee
          // 匹配 fetch(...) / window.fetch(...) / globalThis.fetch(...)
          if (!isFetchCall(callee)) return

          const line = path.node.loc?.start.line ?? 0
          const tag = crypto
            .createHash('sha1')
            .update(`${id}:${line}`)
            .digest('hex')
            .slice(0, 8)
          const buildTag = `${id.split('/').pop()}:${line}:${tag}`

          // 注入 X-Build-Tag header
          injectHeader(path, 'X-Build-Tag', buildTag)
          dirty = true
        }
      })

      return dirty ? generate(ast, {}, code) : null
    }
  }
}
```

---

## 4. Layer 1：Service Worker

### 4.1 SW 的职责

```
职责 1：traceId 发号器（唯一可信来源）
职责 2：把 traceId 写回响应 header（让 main thread 能读到）
职责 3：通过 BroadcastChannel 广播（让 SDK 提前知道，无需等响应返回）
职责 4：记录 build-tag ↔ traceId 映射（用于调试）
```

### 4.2 实现

```js
// sdk-sw.js
const bc = new BroadcastChannel('__api_trace__')

self.addEventListener('fetch', event => {
  const req = event.request
  if (!isAPIRequest(req.url)) return

  const traceId = crypto.randomUUID()
  const buildTag = req.headers.get('X-Build-Tag') ?? 'unknown'

  // 广播：让 main thread SDK 提前注册
  bc.postMessage({
    type: 'REQUEST_START',
    traceId,
    url: req.url,
    method: req.method,
    buildTag,
    ts: Date.now()
  })

  event.respondWith(
    fetch(req).then(response => {
      // 把 traceId 写入响应 header（关键！）
      const headers = new Headers(response.headers)
      headers.set('X-Trace-Id', traceId)
      headers.set('X-Build-Tag', buildTag)

      bc.postMessage({
        type: 'REQUEST_DONE',
        traceId,
        url: req.url,
        status: response.status,
        ts: Date.now()
      })

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      })
    }).catch(err => {
      bc.postMessage({ type: 'REQUEST_ERROR', traceId, url: req.url, error: err.message })
      throw err
    })
  )
})
```

### 4.3 SW 的局限与处理

| 局限 | 处理方式 |
|------|---------|
| 首次安装需刷新 | `skipWaiting()` + `clients.claim()` |
| 需要 HTTPS 或 localhost | 开发用 localhost，生产本来就是 HTTPS |
| SW 和 main thread 是独立上下文 | BroadcastChannel 通信 |
| SW 可能被浏览器 kill | 请求是事件驱动的，kill 了会自动 wake |

---

## 5. Layer 2：运行时 SDK

### 5.1 总体结构

```js
// sdk/index.js
import { setupBroadcastListener } from './broadcast'
import { setupFetchInterceptor } from './fetch-interceptor'
import { setupAsyncTracker } from './async-tracker'
import { setupReactHook } from './react-hook'

export function init() {
  setupBroadcastListener()   // 监听 SW 广播
  setupFetchInterceptor()    // fetch 拦截，读 traceId
  setupAsyncTracker()        // 异步传播（分情况）
  setupReactHook()           // React commit 捕获
}
```

### 5.2 fetch 拦截器（从响应 header 读 traceId）

```js
// sdk/fetch-interceptor.js

const activeTraces = new Map()  // url → { traceId, ts }

// 接收 SW 广播
const bc = new BroadcastChannel('__api_trace__')
bc.onmessage = ({ data }) => {
  if (data.type === 'REQUEST_START') {
    activeTraces.set(data.url, { traceId: data.traceId, ts: data.ts })
  }
}

// fetch 拦截
const origFetch = window.fetch
window.fetch = function(input, init) {
  const url = typeof input === 'string' ? input : input.url

  return origFetch.call(this, input, init).then(response => {
    // 优先从 SW 注入的 header 读 traceId
    const traceId = response.headers.get('X-Trace-Id')
              ?? activeTraces.get(url)?.traceId
              ?? generateTraceId()

    // 关键：把 traceId 推入同步执行跟踪器
    SyncTracker.push(traceId, url)

    return response
  })
}
```

### 5.3 核心：同步执行跟踪器（情况 A，80%，无 prototype patch）

**关键洞察**：JavaScript 是单线程的。一个 `.then()` 回调从开始执行到结束，中间不会有其他代码插入。所以在 `.then()` 回调执行期间，"当前 traceId" 是确定的。

```js
// sdk/async-tracker.js

// 同步栈（不是异步 context，就是普通 JS 变量）
const syncStack = []

export const SyncTracker = {
  push(traceId, url) {
    syncStack.push({ traceId, url })
  },
  pop() {
    syncStack.pop()
  },
  current() {
    return syncStack[syncStack.length - 1] ?? null
  }
}

// 关键：在 fetch 拦截的 .then() 链里，手动 push/pop
// 这不是 hack，是明确的 push 和 pop

// 修改 fetch 拦截器（在 5.2 基础上）：
window.fetch = function(input, init) {
  const url = typeof input === 'string' ? input : input.url

  return origFetch.call(this, input, init).then(response => {
    const traceId = response.headers.get('X-Trace-Id') ?? generateTraceId()

    SyncTracker.push(traceId, url)

    // 用 Promise 链确保 pop 发生在"这个 .then 的下游"处理完后
    // 但实际上 pop 需要在 setState 之后，不是这里
    // → 这就是情况 A 的局限：只能覆盖"直接在 .then 里 setState"

    return response
  })
}
```

**情况 A 的工作原理**：

```
fetch('/api/user')
  .then(r => r.json())      ← SW 已经注入 traceId
  .then(data => {
    // SyncTracker.current() = { traceId: 'abc', url: '/api/user' }
    setUser(data)           // ← setState 此时读 SyncTracker.current()
  })
```

在 `setUser(data)` 执行时，`SyncTracker.current()` 是有值的。因为：
- `fetch` 的 `.then()` 回调是 microtask
- 整个链 `then1 → then2 → setUser` 在同一个 microtask 队列里顺序执行
- 中间没有 macrotask（没有 setTimeout）
- 所以 `SyncTracker.current()` 在整个链里一直有效

**情况 A 的局限**：
```js
// 这种情况 SyncTracker 无效
fetch('/api/user').then(data => {
  setTimeout(() => setUser(data), 100)  // ← setTimeout 穿越 macrotask 边界
})
```

### 5.4 兜底：轻量 Promise.then patch（情况 B，20%）

```js
// sdk/async-tracker.js（续）

// 仅在检测到 macrotask 跨越时启用
// 默认关闭，通过配置开启

let _promisePatchEnabled = false

export function enablePromisePatch() {
  if (_promisePatchEnabled) return
  _promisePatchEnabled = true

  const origThen = Promise.prototype.then
  Promise.prototype.then = function(onFulfilled, onRejected) {
    // 只捕获快照，不做复杂操作
    const snapshot = syncStack.slice()

    return origThen.call(this,
      onFulfilled ? function(value) {
        const prev = syncStack.splice(0)    // 保存当前
        syncStack.push(...snapshot)          // 恢复快照
        try { return onFulfilled(value) }
        finally {
          syncStack.splice(0)
          syncStack.push(...prev)            // 还原
        }
      } : onFulfilled,
      onRejected ? function(err) {
        const prev = syncStack.splice(0)
        syncStack.push(...snapshot)
        try { return onRejected(err) }
        finally {
          syncStack.splice(0)
          syncStack.push(...prev)
        }
      } : onRejected
    )
  }

  // 同样处理 setTimeout / setInterval / queueMicrotask
  const origSetTimeout = window.setTimeout
  window.setTimeout = function(fn, delay, ...args) {
    const snapshot = syncStack.slice()
    return origSetTimeout.call(this, () => {
      const prev = syncStack.splice(0)
      syncStack.push(...snapshot)
      try { return fn(...args) }
      finally { syncStack.splice(0); syncStack.push(...prev) }
    }, delay)
  }
}
```

**关键设计决策**：Promise.then patch **默认关闭**，按需开启。
- 大多数 React 应用（直接 fetch → setState）不需要它
- 对于有 setTimeout/防抖/节流的应用，手动开启
- 与 Zone.js 的冲突降低（Zone.js 应用本来就有 Promise patch，我们不重复）

### 5.5 React DevTools Hook（commit 捕获）

```js
// sdk/react-hook.js

// 必须在 React 加载前设置（在 SDK 入口最顶部，或通过 Vite 插件确保顺序）
const _commitCallbacks = []

if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {}
}

const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__

// 保留 React DevTools 扩展的注入（不覆盖）
const prevOnCommit = hook.onCommitFiberRoot

hook.onCommitFiberRoot = function(rendererID, root, priorityLevel) {
  // 先调用原有的（DevTools 扩展）
  prevOnCommit?.call(this, rendererID, root, priorityLevel)

  // 捕获本次 commit 时的 traceId 上下文
  const activeTrace = SyncTracker.current()
  if (!activeTrace) return

  // 遍历 fiber 树，找出本次 commit 中被更新的节点
  traverseCommittedFibers(root.current, fiber => {
    if (!hasUpdates(fiber)) return

    const domNode = fiber.stateNode
    if (domNode instanceof Element) {
      recordBinding(domNode, activeTrace)
    }
  })
}

// 遍历 fiber 树（只访问有 flags 的节点，不全量遍历）
function traverseCommittedFibers(fiber, callback) {
  if (!fiber) return
  if (fiber.flags !== 0 || fiber.subtreeFlags !== 0) {
    callback(fiber)
  }
  traverseCommittedFibers(fiber.child, callback)
  traverseCommittedFibers(fiber.sibling, callback)
}

// flags 常量（React 源码）
const Placement = 0b000000000000000000000010
const Update    = 0b000000000000000000000100
function hasUpdates(fiber) {
  return (fiber.flags & (Placement | Update)) !== 0
}
```

**为什么优于 v5 的 `Object.defineProperty` 抓 `__reactFiber$`**：

| | v5（defineProperty hack） | 本方案（DevTools Hook） |
|--|--------------------------|----------------------|
| 触发时机 | fiber 挂载到 DOM 的瞬间 | React 整个 commit 批次完成后 |
| 拿到的信息 | 单个 fiber | 整个 commit 的 fiber 子树 |
| 稳定性 | 依赖 `__reactFiber$` key 名（理论上会变） | 官方 hook，React 17/18/19 均支持 |
| 与 commit 批处理兼容 | 每个 fiber 单独触发，需自己聚合 | 原生批次 |

### 5.6 绑定数据结构

```js
// sdk/store.js

// 最终产出：DOM 节点 → API 依赖
const bindingMap = new WeakMap()
// domNode → Set<{ traceId, url, method, buildTag, confidence, ts }>

// traceId 注册表
const traceRegistry = new Map()
// traceId → { url, method, buildTag, startTs, endTs }

export function recordBinding(domNode, trace) {
  if (!bindingMap.has(domNode)) {
    bindingMap.set(domNode, new Set())
  }
  const info = traceRegistry.get(trace.traceId)
  if (info) {
    bindingMap.get(domNode).add({
      traceId: trace.traceId,
      url: info.url,
      method: info.method,
      buildTag: info.buildTag,
      confidence: computeConfidence(trace),
      ts: Date.now()
    })
  }
}

// 查询接口
export function getBinding(domNode) {
  return [...(bindingMap.get(domNode) ?? [])]
}

export function exportBindingMap() {
  // 遍历 DOM，导出完整 mapping
  const result = []
  document.querySelectorAll('*').forEach(node => {
    const bindings = getBinding(node)
    if (bindings.length > 0) {
      result.push({
        selector: getStableSelector(node),
        apis: bindings.map(b => ({ url: b.url, confidence: b.confidence }))
      })
    }
  })
  return result
}
```

---

## 6. Layer 3：差分测试（独立验证）

```js
// playwright/api-dom-diff.spec.ts
import { test, expect } from '@playwright/test'

test.describe('API↔DOM binding discovery', () => {

  test('discover bindings via differential testing', async ({ page }) => {
    // 步骤 1：收集所有 API（从 HAR 或 SW 记录）
    const knownAPIs = await collectAPIs(page)

    // 步骤 2：基线 DOM 快照
    await page.goto('/', { waitUntil: 'networkidle' })
    const baseline = await captureSemanticSnapshot(page)

    const bindingResults = {}

    // 步骤 3：逐个 mock API，观察 DOM 变化
    for (const api of knownAPIs) {
      await page.route(api.url, route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildEmptyResponse(api.schema))
      }))

      await page.reload({ waitUntil: 'networkidle' })
      const mocked = await captureSemanticSnapshot(page)

      // 语义 diff（不是字符串 diff）
      const diff = semanticDiff(baseline, mocked)

      bindingResults[api.url] = {
        affectedSelectors: diff.changedNodes.map(n => n.selector),
        removedNodes: diff.removedNodes.map(n => n.selector),
        addedNodes: diff.addedNodes.map(n => n.selector)
      }

      await page.unroute(api.url)
    }

    // 步骤 4：与 runtime SDK 的结论对比（可选）
    // 步骤 5：写入 dom-contracts.json
    writeContracts(bindingResults)
  })
})

// 语义快照（不是 innerHTML，而是有意义的文本和结构）
async function captureSemanticSnapshot(page) {
  return page.evaluate(() => {
    const nodes = []
    document.querySelectorAll('[data-testid], main *, article *').forEach(el => {
      nodes.push({
        selector: getStableSelector(el),
        text: el.textContent?.trim().slice(0, 100),
        visible: el.offsetParent !== null,
        childCount: el.children.length
      })
    })
    return nodes
  })
}
```

### 6.1 差分测试的独立价值

差分测试不依赖 Layer 2 的任何代码，它是**完全独立的验证层**：
- Layer 2 说"DOM A 依赖 API K"
- 差分测试 mock 掉 API K，看 DOM A 是否消失/变化
- 如果一致 → 高置信度
- 如果不一致 → Layer 2 有 bug 或存在间接依赖

---

## 7. 各层的置信度模型

```js
function computeConfidence(evidence) {
  let score = 0

  // 基础分：traceId 来自 SW（最可信来源）
  if (evidence.source === 'sw-header') score += 0.4

  // 加分：同步执行链（不经过 macrotask）
  if (evidence.asyncBoundaries === 0) score += 0.3

  // 加分：差分测试验证一致
  if (evidence.differentialConfirmed) score += 0.2

  // 加分：build-tag 静态分析也认为有关联
  if (evidence.staticAnalysisMatch) score += 0.1

  return Math.min(score, 1.0)
}
```

---

## 8. 与 v5 方案的对比

| 维度 | v5 hack SDK | 本方案 |
|------|------------|--------|
| traceId 来源 | main thread 生成 UUID | **SW 生成（可信，不可被 JS 覆盖）** |
| 异步传播（80% 场景） | Promise.then patch（全量） | **同步执行跟踪器（无 patch）** |
| 异步传播（20% 场景） | Promise.then patch（全量） | Promise.then patch（**按需开启**）|
| React commit 检测 | `Object.defineProperty` + `__reactFiber$` | **`__REACT_DEVTOOLS_GLOBAL_HOOK__`** |
| V8 IC 污染 | 有（修改 Promise.prototype） | **无（默认不改原型链）** |
| 与 Zone.js 冲突 | 有风险 | **风险低（Promise patch 默认关闭）** |
| 字段级精度 | 无 | **无**（这个问题目前无解）|
| 独立验证层 | 无 | **差分测试** |
| SDK 大小 | ~1500 行 | **~300 行 + 测试** |
| 生产安全 | 中 | **高** |

---

## 9. 真实的局限性（不掩盖）

### 9.1 字段级精度（L3）仍然无解

```
API 响应：{ name: "Alice", age: 30, score: 95 }

我们能知道：DOM #card 依赖 /api/user ✅
我们不知道：#card 里哪个元素显示 name，哪个显示 age ❌
```

要做到字段级，唯一可行的是 Proxy 污点分析，但原始值（string/number）无法 Proxy，而 DOM 文本内容几乎都是原始值。**这是目前技术层面的硬限制，没有银弹。**

### 9.2 情况 B 的 Promise.then patch 仍然存在

对于有 setTimeout/debounce 的应用，还是要打开 Promise.then patch。本方案的改进是：**降级为可选**，而不是完全消除。

### 9.3 React 19 / Concurrent Mode 的不确定性

React 19 改变了 `__REACT_DEVTOOLS_GLOBAL_HOOK__` 的部分接口。`flags` 常量也在变化。需要版本检测：

```js
function getReactVersion() {
  return window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.values().next().value?.version
}
```

### 9.4 Service Worker 初次安装的空窗期

第一次加载页面时，SW 还没激活，那次的 fetch 不经过 SW。解决方式：
- `skipWaiting()` + `clients.claim()` 减少空窗
- 首次加载的 fetch 用 Layer 2 的 fetch 拦截器兜底（生成本地 traceId）

---

## 10. 实施顺序（6 周）

```
Week 1: Layer 1 Service Worker
  · sw.js 完整实现
  · BroadcastChannel 协议
  · 验证：能正确接收和广播所有 API 请求

Week 2: Layer 2 fetch 拦截 + 同步跟踪器（情况 A）
  · fetch 拦截器读 SW header
  · SyncTracker 实现
  · 验证：直接 fetch→setState 的场景 traceId 正确传播

Week 3: React DevTools Hook
  · onCommitFiberRoot 集成
  · fiber 遍历 + DOM 关联
  · 验证：commit 时能正确捕获更新的 DOM 节点

Week 4: Layer 0 Vite 插件
  · AST 转换，注入 X-Build-Tag
  · 验证：build-tag 出现在 SW 广播的日志里

Week 5: 情况 B（Promise.then patch）
  · 实现并封装为可选配置
  · setTimeout / setInterval / queueMicrotask
  · 验证：防抖场景下 traceId 正确传播

Week 6: Layer 3 差分测试
  · Playwright fixture
  · semanticDiff 实现
  · dom-contracts.json 自动生成
  · CI 集成
```

---

## 11. 一句话总结

**SW 作为可信发号器 + 同步执行跟踪（默认，无原型污染）+ Promise patch（可选兜底）+ DevTools Hook（稳定的 React 入口）+ 差分测试（独立验证）。**

核心改进不是"更多 hack"，而是**分层解耦**：每个子问题用最合适的手段，不用一把锤子打所有钉子。
