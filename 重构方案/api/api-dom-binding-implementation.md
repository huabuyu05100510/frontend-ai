# API ↔ DOM 绑定关系: 深度实现研究

> 基于 [api-dom-binding-research.md](./api-dom-binding-research.md) 的跨领域范式调研和 [api-dom-binding-solution.md](./api-dom-binding-solution.md) 的可行方案，本文聚焦**工程实现层面**的完整细节。
> 目标：从"方案可行"推到"每一行代码怎么写"。

---

## 0. 核心判据回顾

**被否决的路（有硬证据）**：

| 方案 | 死因 | 来源 |
|------|------|------|
| userland Proxy 污点 | `{...obj}` / `JSON.parse` 破坏 Proxy 身份 | 实测 |
| 纯 MutationObserver | W3C 规范确认 `MutationRecord` 不含因果 | W3C 邮件列表 |
| Zone.js userland async | `async/await` 绕过 userland Promise（Angular 官方确认） | Angular #31730 |
| Jalangi2 操作级插桩 | 30-100x 性能退化，生产不可用 | 学术共识 |
| Unicode 水印注入 | `"Alice\u200B" !== "Alice"`，破坏所有字符串比较 | 自证 |
| 纯时间窗口绑定 | 并发请求、debounce、虚拟滚动破坏时间假设 | 自证 |

**采纳的方案（有成熟领域背书）**：

| 方案 | 覆盖率 | 侵入性 | 核心机制 |
|------|--------|--------|----------|
| **层级 1: 静态分析** | ~70% | 零（只读 AST） | Babel parser → AST walk → 组件↔API 映射 |
| **层级 2: 编译时插桩** | ~90-95% | 编译期（改 bundle，不改源码） | Babel 插件注入追踪代码，利用闭包保留变量 |
| **层级 3: 差分测试** | 100% 检测率 | 零（黑盒） | Puppeteer 逐个拦截 API → DOM 快照 diff |

---

## 1. 关键架构决策

### 1.1 为什么"闭包保留变量"是正确的基础

这是整个方案最关键的洞察，也是与原 research doc 中 traceId 方案的**本质区别**：

```js
// 原 research doc 的思路（需要跨异步链传播，浏览器做不到）：
fetch('/api/user')  // 注入 traceId=123
  .then(res => res.json())      // traceId=123 需要自动传播到这里 ← 需要 PromiseHook
  .then(data => setState(data)) // traceId=123 需要自动传播到这里 ← 需要 PromiseHook

// 实际可行的思路（闭包自然保留）：
const __reqId = __trackStart('/api/user')  // ← 在闭包中
const data = await fetch('/api/user').then(r => r.json())
// await 之后 __reqId 仍在闭包中！
__trackEnd(__reqId)
setState(data)  // ← __currentRequests 知道是 __reqId
```

**关键区别**：不需要跨 `await` 传播 traceId，因为 `const` 变量在闭包中自然存活。只需要在 fetch 调用**同作用域**内注入 `__trackStart` / `__trackEnd`。

### 1.2 数据流追踪的粒度选择

```
❌ 值级追踪：每个字符串来自哪个 API → Proxy 丢失、水印破坏
❌ 函数级追踪：每行代码改了哪个 DOM → MO 不含因果
✅ 组件级追踪：每个组件 render 时依赖哪些 API → React 边界天然存在
```

**核心洞察**：不需要追踪"这个 `<span>` 的 `textContent` 来自 `/api/user` 返回的 `data.name`"。只需要追踪"`<UserCard>` 这个组件在 render 时使用了 `/api/user` 的数据"。粒度是**组件级**，不是 DOM 节点级。

组件级已经足够：因为 `<Skeleton>` 包裹的是组件子树，知道子树中每个组件依赖哪些 API，取并集就是整个骨架区域的依赖。

### 1.3 各层级职责边界

```
层级 1（静态分析）
  - 能力：识别 AST 中显式的 API 调用 → 组件映射
  - 盲区：动态 URL、store 绕路、条件分支、第三方库
  - 产物：binding-map-static.json（精确但可能不完整）

层级 2（编译时插桩）
  - 能力：注入运行时代码记录 API→组件→DOM 的实际运行路径
  - 盲区：eval()、WebSocket、Service Worker
  - 产物：binding-map-runtime.json（运行时采集的精确绑定）

层级 3（差分测试）
  - 能力：黑盒拦截 API → 观察 DOM 变化，纯黑盒无遗漏
  - 盲区：仅噪声导致的假阳性
  - 产物：最终验证 + 补充层级 1/2 的盲区
```

---

## 2. 数据结构设计

### 2.1 核心绑定地图（最终产物）

```ts
// packages/smarty/src/core/binding-schema.ts

/** 整个应用的完整绑定地图 */
export interface BindingMap {
  version: 1
  generatedAt: string  // ISO 8601
  /** key = 骨架区域 id（对应 <Bound id="..."> 或 <Skeleton name="...">） */
  regions: Record<string, RegionBinding>
}

export interface RegionBinding {
  /** 骨架区域 id */
  regionId: string
  /** 该区域依赖的所有 API */
  apis: ApiDependency[]
  /** 绑定来源 */
  source: BindingSource
  /** 置信度 */
  confidence: 'static' | 'runtime' | 'differential' | 'manual'
  /** 来源文件路径 */
  sourceFile?: string
  /** 组件名 */
  componentName?: string
}

export interface ApiDependency {
  /** API URL */
  url: string
  /** HTTP 方法 */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** API 来源标识 */
  source: 'fetch' | 'react-query' | 'swr' | 'axios' | 'relay' | 'custom'
  /** 数据在 store 中的 key（如果是通过 store 绕路的） */
  storeKey?: string
  /** 是否为动态 URL（运行时才能确定的） */
  dynamic?: boolean
  /** URL 参数依赖（如 /api/user/:id 中的 id） */
  paramDeps?: string[]
}

export type BindingSource =
  | { type: 'static-analysis'; file: string; line: number }
  | { type: 'compile-time-instrumentation'; file: string; reqId: string }
  | { type: 'differential-testing'; runId: string }
  | { type: 'manual' }

/** 运行时采集的临时数据（层级 2 使用） */
export interface RuntimeTrace {
  /** 请求 ID */
  reqId: string
  /** API URL */
  url: string
  /** 请求发起时间 */
  startTime: number
  /** 请求完成时间 */
  endTime: number
  /** 该请求数据流经的组件栈 */
  componentStack: ComponentTraceEntry[]
  /** 最终影响的 DOM 节点（React host fiber 的 DOM 映射） */
  affectedDomNodes?: string[]  // CSS selector or XPath
}

export interface ComponentTraceEntry {
  /** 组件名 */
  componentName: string
  /** render 时间 */
  renderTime: number
  /** 该组件本次 render 依赖的 API reqId 列表 */
  activeReqIds: string[]
  /** 对应的 fiber key */
  fiberKey?: string
}
```

### 2.2 静态分析产物（层级 1）

```ts
/** 静态分析直接输出 */
export interface StaticBinding {
  /** 组件名 */
  componentName: string
  /** 源文件路径 */
  file: string
  /** 在文件中的位置 */
  location: { line: number; column: number }
  /** API 依赖列表 */
  apis: StaticApiRef[]
  /** 组件所在骨架区域（如果能静态确定） */
  skeletonRegion?: string
}

export interface StaticApiRef {
  /** API URL */
  url: string
  /** URL 是否为动态拼接 */
  dynamic: boolean
  /** 动态 URL 的模板部分（如 `/api/user/${id}`） */
  urlTemplate?: string
  /** 参数变量名（如 ['id']） */
  paramNames?: string[]
  /** API 调用方式 */
  callType: 'fetch' | 'axios' | 'useQuery' | 'useSWR' | 'relay' | 'custom'
  /** 数据存储目标 */
  targetState?: 'useState' | 'store' | 'setState' | 'dispatch' | 'unknown'
  /** 如果存入 store，store 的 key */
  storeName?: string
  /** 置信度 */
  confidence: number  // 0-1
}
```

---

## 3. 层级 1 实现：静态分析 Babel 插件

### 3.1 插件架构

```
@smarty/babel-plugin-bind-static
├── src/
│   ├── index.ts                 # Babel 插件入口
│   ├── visitors/
│   │   ├── call-expression.ts  # 识别 API 调用（fetch/axios/useQuery/useSWR）
│   │   ├── hook-pattern.ts     # 识别 React Hook 使用模式
│   │   ├── store-pattern.ts    # 识别 Zustand/Redux store 模式
│   │   └── component-finder.ts # 找到 API 调用所在的最近组件/hook
│   ├── resolvers/
│   │   ├── import-resolver.ts  # 解析 import 路径 → 文件追踪
│   │   ├── store-resolver.ts   # 追踪 store 定义 → 找到内部 API 调用
│   │   └── prop-resolver.ts    # 追踪 props 数据来源
│   ├── output/
│   │   ├── binding-writer.ts   # 输出 binding-map-static.json
│   │   └── reporter.ts         # 诊断/警告输出
│   └── utils/
│       ├── ast-helpers.ts
│       └── url-detector.ts     # 判断字符串是否为 URL
└── test/
    ├── fixtures/
    │   ├── basic-fetch.tsx
    │   ├── use-query.tsx
    │   ├── store-zustand.tsx
    │   └── complex-transform.tsx
    └── visitors.test.ts
```

### 3.2 核心识别逻辑

```ts
// packages/smarty/src/core/static-bind/visitors/call-expression.ts

import type { NodePath } from '@babel/traverse'
import type { CallExpression, StringLiteral, TemplateLiteral } from '@babel/types'

/**
 * 判断一个 CallExpression 是否是 API 调用
 *
 * 识别模式：
 *   fetch('/api/user')
 *   fetch('/api/user', options)
 *   axios.get('/api/user')
 *   axios.post('/api/user', data)
 *   useQuery(['key', params], fetchFn)  // React Query v4+
 *   useQuery({ queryKey: [...], queryFn: ... })
 *   useSWR('/api/user', fetcher)
 *   useSWR(['/api/user', params], fetcher)
 *   request.get('/api/user')  // umi-request
 */
export function detectApiCall(path: NodePath<CallExpression>): ApiCallInfo | null {
  const callee = path.node.callee

  // 1. 直接 fetch(url)
  if (callee.type === 'Identifier' && callee.name === 'fetch') {
    const url = extractUrlFromArg(path.node.arguments[0])
    if (url) {
      return {
        type: 'fetch',
        url: url.value,
        dynamic: url.dynamic,
        paramNames: url.paramNames,
      }
    }
  }

  // 2. axios.get(url) / axios.post(url, data)
  if (callee.type === 'MemberExpression') {
    const obj = callee.object
    const prop = callee.property
    if (
      obj.type === 'Identifier' &&
      obj.name === 'axios' &&
      prop.type === 'Identifier' &&
      ['get', 'post', 'put', 'delete', 'patch'].includes(prop.name)
    ) {
      const url = extractUrlFromArg(path.node.arguments[0])
      if (url) {
        return {
          type: 'axios',
          method: prop.name.toUpperCase(),
          url: url.value,
          dynamic: url.dynamic,
          paramNames: url.paramNames,
        }
      }
    }

    // 3. request.get(url) / request.post(url, data) - umi-request 模式
    if (
      obj.type === 'Identifier' &&
      obj.name === 'request' &&
      prop.type === 'Identifier' &&
      ['get', 'post', 'put', 'delete'].includes(prop.name)
    ) {
      const url = extractUrlFromArg(path.node.arguments[0])
      if (url) {
        return {
          type: 'umi-request',
          method: prop.name.toUpperCase(),
          url: url.value,
          dynamic: url.dynamic,
          paramNames: url.paramNames,
        }
      }
    }
  }

  // 4. useQuery / useSWR 模式
  if (callee.type === 'Identifier') {
    if (callee.name === 'useQuery') {
      return extractReactQueryCall(path)
    }
    if (callee.name === 'useSWR') {
      return extractSWRCall(path)
    }
  }

  return null
}

/**
 * 从 AST 参数提取 URL
 *
 * 处理三种情况：
 *   1. 字面字符串：'/api/user' → { value: '/api/user', dynamic: false }
 *   2. 模板字符串：`/api/user/${id}` → { value: '/api/user/${id}', dynamic: true, paramNames: ['id'] }
 *   3. 字符串拼接：'/api' + endpoint → { value: null, dynamic: true }（无法静态确定）
 */
function extractUrlFromArg(
  arg: Node | undefined
): { value: string; dynamic: boolean; paramNames?: string[] } | null {
  if (!arg) return null

  // 字面字符串
  if (arg.type === 'StringLiteral') {
    return { value: arg.value, dynamic: false }
  }

  // 模板字符串
  if (arg.type === 'TemplateLiteral') {
    const quasis = arg.quasis.map(q => q.value.cooked || '')
    const exprs = arg.expressions.map(e => {
      if (e.type === 'Identifier') return e.name
      return '...'
    })
    // 重建模板: `/api/user/${id}` → quasis=['/api/user/',''], exprs=['id']
    let template = quasis[0]
    for (let i = 0; i < exprs.length; i++) {
      template += '${' + exprs[i] + '}' + (quasis[i + 1] || '')
    }
    return {
      value: template,
      dynamic: true,
      paramNames: exprs.map(e => e === '...' ? undefined : e).filter(Boolean) as string[],
    }
  }

  // 字面 URL + options（fetch 第二个参数是 options 对象）
  // 此时不是 URL，检查一下
  if (arg.type === 'ObjectExpression') return null

  // 其他情况：字符串拼接、函数调用、变量引用 → 无法静态确定
  return { value: 'DYNAMIC', dynamic: true }
}

/**
 * 提取 React Query useQuery 的 queryKey
 *
 * useQuery(['key', params], fn)
 * useQuery({ queryKey: ['key', params], queryFn: fn })
 */
function extractReactQueryCall(path: NodePath<CallExpression>): ApiCallInfo | null {
  const arg0 = path.node.arguments[0]

  // useQuery({ queryKey: [...], queryFn: fn })
  if (arg0.type === 'ObjectExpression') {
    const queryKeyProp = arg0.properties.find(
      p => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'queryKey'
    ) as ObjectProperty | undefined
    if (queryKeyProp && queryKeyProp.value.type === 'ArrayExpression') {
      const firstElem = queryKeyProp.value.elements[0]
      if (firstElem && firstElem.type === 'StringLiteral') {
        return {
          type: 'react-query',
          url: firstElem.value,
          dynamic: false,
        }
      }
    }
  }

  // useQuery(['key', ...params], fn)
  if (arg0.type === 'ArrayExpression') {
    const firstElem = arg0.elements[0]
    if (firstElem && firstElem.type === 'StringLiteral') {
      const dynamic = arg0.elements.length > 1 || arg0.elements.some(
        e => e.type !== 'StringLiteral'
      )
      return {
        type: 'react-query',
        url: firstElem.value,
        dynamic,
      }
    }
  }

  // useQuery('key', fn)
  if (arg0.type === 'StringLiteral') {
    return {
      type: 'react-query',
      url: arg0.value,
      dynamic: false,
    }
  }

  return null
}

/** 提取 SWR useSWR 的 key */
function extractSWRCall(path: NodePath<CallExpression>): ApiCallInfo | null {
  const arg0 = path.node.arguments[0]

  if (arg0.type === 'StringLiteral') {
    return { type: 'swr', url: arg0.value, dynamic: false }
  }

  if (arg0.type === 'ArrayExpression') {
    const first = arg0.elements[0]
    if (first && first.type === 'StringLiteral') {
      return {
        type: 'swr',
        url: first.value,
        dynamic: arg0.elements.length > 1,
      }
    }
  }

  return null
}

export interface ApiCallInfo {
  type: 'fetch' | 'axios' | 'react-query' | 'swr' | 'relay' | 'umi-request'
  url: string
  dynamic: boolean
  paramNames?: string[]
  method?: string
}
```

### 3.3 组件归属定位

```ts
// packages/smarty/src/core/static-bind/visitors/component-finder.ts

import type { NodePath } from '@babel/traverse'
import type { FunctionDeclaration, FunctionExpression, ArrowFunctionExpression } from '@babel/types'

/**
 * 从 API 调用点向上查找最近的 React 组件或 hook
 *
 * 规则：
 *   - 函数名为大写字母开头 → React 函数组件
 *   - 函数名为 'use' 开头 → React hook
 *   - export default function → 组件
 *   - 在 render 函数内部 → 类组件（v17 老代码）
 */
export function findNearestComponent(
  path: NodePath
): ComponentInfo | null {
  let current: NodePath | null = path

  while (current) {
    if (current.isFunctionDeclaration()) {
      const name = current.node.id?.name
      if (name && isComponentName(name)) {
        return { type: 'function-component', name, path: current }
      }
      if (name && isHookName(name)) {
        return { type: 'hook', name, path: current }
      }
    }

    if (current.isArrowFunctionExpression() || current.isFunctionExpression()) {
      // 检查是否是变量声明: const UserCard = () => { ... }
      const parent = current.parentPath
      if (parent.isVariableDeclarator() && parent.node.id.type === 'Identifier') {
        const name = parent.node.id.name
        if (isComponentName(name)) {
          return { type: 'function-component', name, path: current }
        }
        if (isHookName(name)) {
          return { type: 'hook', name, path: current }
        }
      }

      // export default function/arrow
      if (parent.isExportDefaultDeclaration()) {
        return { type: 'function-component', name: 'default', path: current }
      }
    }

    // 类组件 render 方法
    if (current.isClassMethod() && current.node.key.type === 'Identifier' && current.node.key.name === 'render') {
      const classPath = current.parentPath?.parentPath
      if (classPath?.isClassDeclaration() && classPath.node.id) {
        return {
          type: 'class-component',
          name: classPath.node.id.name,
          path: current,
        }
      }
    }

    current = current.parentPath
  }

  return null
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name)
}

function isHookName(name: string): boolean {
  return /^use[A-Z]/.test(name)
}

interface ComponentInfo {
  type: 'function-component' | 'class-component' | 'hook'
  name: string
  path: NodePath
}
```

### 3.4 Store 绕路追踪

```ts
// packages/smarty/src/core/static-bind/resolvers/store-resolver.ts

/**
 * 追踪 store 定义，建立 store key → API URL 的映射
 *
 * 支持的模式：
 *
 * 1. Zustand:
 *   const useUserStore = create((set) => ({
 *     user: null,
 *     fetch: async () => {
 *       const data = await fetch('/api/user').then(r => r.json())
 *       set({ user: data })           // ← 'user' → '/api/user'
 *     }
 *   }))
 *
 * 2. Redux Toolkit:
 *   const userSlice = createSlice({
 *     name: 'user',
 *     reducers: {},
 *     extraReducers: (builder) => {
 *       builder.addCase(fetchUser.pending, ...)
 *     }
 *   })
 *   // fetchUser 是 createAsyncThunk('user/fetch', async () => fetch('/api/user'))
 *
 * 3. Jotai:
 *   const userAtom = atom(async () => {
 *     const res = await fetch('/api/user')
 *     return res.json()
 *   })
 */
export function resolveStoreToApi(
  storeCallPath: NodePath,       // 如 create(...) 调用点
  importResolver: ImportResolver
): Map<string, string> {         // storeKey → apiUrl
  const result = new Map<string, string>()

  // Zustand 模式：遍历 create 回调中的 set() 调用
  if (isZustandCreate(storeCallPath)) {
    const callback = storeCallPath.node.arguments[0]
    if (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') {
      // 找到回调中所有的 set({ key: value }) 调用
      storeCallPath.scope.traverse(storeCallPath.node, {
        CallExpression(setPath) {
          if (isStateSetter(setPath)) {
            // set({ user: data }) → search backward for fetch
            const fetchCall = findPrecedingApiCall(setPath)
            if (fetchCall) {
              const objArg = setPath.node.arguments[0]
              if (objArg.type === 'ObjectExpression') {
                for (const prop of objArg.properties) {
                  if (prop.type === 'ObjectProperty' && prop.key.type === 'Identifier') {
                    result.set(prop.key.name, fetchCall.url)
                  }
                }
              }
            }
          }
        }
      })
    }
  }

  return result
}

/**
 * 回到 AST 中前一条语句，寻找 API 调用
 * 处理模式：
 *   const data = await fetch('/api/user').then(r => r.json())
 *   set({ user: data })  ← 找前一条的 fetch
 */
function findPrecedingApiCall(setPath: NodePath<CallExpression>): ApiCallInfo | null {
  // 向上找到语句级别
  let stmt = setPath.parentPath
  while (stmt && !stmt.isStatement()) {
    stmt = stmt.parentPath
  }
  if (!stmt) return null

  // 在语句列表中向前遍历
  const body = stmt.parentPath
  if (body.isBlockStatement()) {
    const stmts = body.node.body
    const idx = stmts.indexOf(stmt.node as any)
    if (idx > 0) {
      // 在 AST 中遍历前面的语句，找 fetch/api 调用
      for (let i = idx - 1; i >= 0; i--) {
        const prevStmt = stmts[i]
        // 简单 AST 遍历查找
        const result = findApiCallInStatement(prevStmt)
        if (result) return result
      }
    }
  }

  return null
}
```

### 3.5 插件入口组装

```ts
// packages/smarty/src/core/static-bind/index.ts

import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import type { File, CallExpression, JSXElement } from '@babel/types'
import { detectApiCall } from './visitors/call-expression'
import { findNearestComponent } from './visitors/component-finder'
import { resolveStoreToApi } from './resolvers/store-resolver'
import type { StaticBinding, BindingMap, RegionBinding } from '../binding-schema'

/**
 * 静态分析入口
 *
 * 输入：源码文件内容 + 文件路径
 * 输出：StaticBinding 列表
 */
export function analyzeFile(
  code: string,
  filePath: string
): StaticBinding[] {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript', 'decorators-legacy'],
  })

  const bindings: StaticBinding[] = []

  traverse(ast, {
    CallExpression(path: NodePath<CallExpression>) {
      const apiInfo = detectApiCall(path)
      if (!apiInfo) return

      const component = findNearestComponent(path)
      if (!component) return

      const binding: StaticBinding = {
        componentName: component.name,
        file: filePath,
        location: {
          line: path.node.loc?.start.line ?? 0,
          column: path.node.loc?.start.column ?? 0,
        },
        apis: [{
          url: apiInfo.url,
          dynamic: apiInfo.dynamic,
          urlTemplate: apiInfo.dynamic ? apiInfo.url : undefined,
          paramNames: apiInfo.paramNames,
          callType: apiInfo.type,
          targetState: detectTargetState(path),
          confidence: apiInfo.dynamic ? 0.5 : 1.0,
        }],
      }

      bindings.push(binding)
    },
  })

  return bindings
}

/**
 * 聚合 all bindings → 输出绑定地图
 *
 * 逻辑：一个骨架区域包含多个组件，取所有组件的 API 并集
 * 组件 → 骨架区域的映射来自：
 *   1. 静态分析找到的 <Bound id="X"> / <Skeleton name="X"> 包裹关系
 *   2. 从 JSX 结构推导的组件包含关系
 */
export function aggregateBindings(
  allBindings: StaticBinding[],
  componentToRegion: Map<string, string>  // componentName → regionId
): BindingMap {
  const regions: Record<string, RegionBinding> = {}

  for (const binding of allBindings) {
    const regionId = componentToRegion.get(binding.componentName)
    if (!regionId) continue

    if (!regions[regionId]) {
      regions[regionId] = {
        regionId,
        apis: [],
        source: { type: 'static-analysis', file: binding.file, line: binding.location.line },
        confidence: 'static',
        sourceFile: binding.file,
        componentName: binding.componentName,
      }
    }

    // 去重合并
    for (const api of binding.apis) {
      const exists = regions[regionId].apis.find(a => a.url === api.url)
      if (!exists) {
        regions[regionId].apis.push({
          url: api.url,
          source: api.callType,
          dynamic: api.dynamic,
          paramDeps: api.paramNames,
        })
      }
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    regions,
  }
}
```

---

## 4. 层级 2 实现：编译时插桩

### 4.1 插桩策略总览

```
要注入的运行时函数（打包到 smarty/runtime）：

  __trackStart(url: string): number
    → 生成 reqId，记录请求开始

  __trackEnd(reqId: number): void
    → 记录请求结束

  __withActiveRequest(reqIds: number[], fn: () => void): void
    → 在 fn 执行期间设置 currentActiveRequests = reqIds

  __registerComponentDeps(componentName: string, deps: DepEntry[]): void
    → 在 render 期间记录组件依赖

  __recordStoreSource(storeName: string, key: string, url: string, reqId: number): void
    → 记录 store 数据来源

  __getBindingMap(): BindingMap
    → 返回整个运行时采集的绑定数据

运行时状态：

  __currentActiveRequests: number[]
    → 当前执行上下文中的活跃请求列表
    → setState 调用时会自动捕获
```

### 4.2 Babel 插桩插件实现

```ts
// packages/smarty/src/core/compile-time-inject/index.ts

import { declare } from '@babel/helper-plugin-utils'
import type { NodePath } from '@babel/traverse'
import type {
  CallExpression,
  AwaitExpression,
  VariableDeclaration,
  JSXElement,
  ArrowFunctionExpression,
  FunctionExpression,
  FunctionDeclaration,
  ExpressionStatement,
} from '@babel/types'
import template from '@babel/template'

/**
 * @smarty/babel-plugin-bind-runtime
 *
 * 编译期插桩，注入运行时追踪代码。
 *
 * 只插桩到 smarty/runtime 的 import，不增大业务 bundle。
 * 插桩代码只在 baking 模式（process.env.SMARTY_BAKE=true）下执行。
 */
export default declare((api) => {
  api.assertVersion(7)

  let reqIdCounter = 0
  const generateReqId = (url: string) => `__smarty_req_${reqIdCounter++}_${hash(url)}`

  return {
    name: 'smarty-bind-runtime',
    visitor: {
      Program: {
        enter(path) {
          // 注入 import { __trackStart, __trackEnd, ... } from 'smarty/runtime'
          if (!hasSmartyImport(path)) {
            const importStmt = template.statement(`
              import { __trackStart, __trackEnd, __withActiveRequest, __registerComponentDeps, __recordStoreSource } from 'smarty/runtime';
            `)()
            path.node.body.unshift(importStmt)
          }
        },
      },

      // ── 1. API 调用插桩 ──
      CallExpression(path: NodePath<CallExpression>) {
        const apiInfo = detectApiCallInfo(path)
        if (!apiInfo) return

        const reqIdVar = generateReqId(apiInfo.url)
        const urlLiteral = JSON.stringify(apiInfo.url)

        // 注入: const __reqId_N = __trackStart('/api/user')
        const trackStartStmt = template.statement(`
          const ${reqIdVar} = __trackStart(${urlLiteral});
        `)()

        // 在 API 调用语句之前插入
        const statementPath = path.getStatementParent()
        if (statementPath) {
          statementPath.insertBefore(trackStartStmt)
        }

        // ── 2. 处理 await ──
        // 在 await 之后注入 __trackEnd
        handleAwaitInstrumentation(path, reqIdVar)

        // ── 3. 处理 .then() 链 ──
        handleThenInstrumentation(path, reqIdVar)

        // ── 4. 在 setState 包裹 __withActiveRequest ──
        handleSetStateInstrumentation(path, reqIdVar)
      },

      // ── 5. 组件 render 插桩 ──
      FunctionDeclaration: {
        exit(path: NodePath<FunctionDeclaration>) {
          const name = path.node.id?.name
          if (!name || !isReactComponent(name)) return

          const jsxReturn = findJSXReturn(path)
          if (!jsxReturn) return

          injectComponentDepsRegistration(path, name)
        },
      },

      ArrowFunctionExpression: {
        exit(path: NodePath<ArrowFunctionExpression>) {
          const parent = path.parentPath
          if (!parent.isVariableDeclarator()) return
          const name = parent.node.id.type === 'Identifier' ? parent.node.id.name : null
          if (!name || !isReactComponent(name)) return

          injectComponentDepsRegistration(path as any, name)
        },
      },

      // ── 6. Store 创建插桩 ──
      CallExpression: {
        exit(path: NodePath<CallExpression>) {
          // Zustand create()
          if (isZustandCreateCall(path)) {
            injectStoreSourceTracking(path)
          }
        },
      },
    },
  }
})

/**
 * 处理 await 后的 __trackEnd 注入
 *
 * 原始:
 *   const data = await fetch('/api/user')
 *
 * 插桩后:
 *   const data = await fetch('/api/user')
 *   __trackEnd(__reqId)
 */
function handleAwaitInstrumentation(
  path: NodePath<CallExpression>,
  reqIdVar: string
) {
  // 向上找最近的 AwaitExpression
  let current = path.parentPath
  while (current) {
    if (current.isAwaitExpression()) {
      const stmtAfter = current.parentPath
      if (stmtAfter.isExpressionStatement() || stmtAfter.isVariableDeclaration()) {
        const nextStmt = getNextSiblingStatement(stmtAfter)
        if (nextStmt) {
          const trackEndStmt = template.statement(`__trackEnd(${reqIdVar});`)()
          nextStmt.insertBefore(trackEndStmt)
        }
      }
      return
    }
    current = current.parentPath
  }
}

/**
 * 处理 .then() 裸函数引用
 *
 * 原始:
 *   fetch('/api/user').then(handleResponse)
 *
 * 插桩后:
 *   const __reqId = __trackStart('/api/user')
 *   fetch('/api/user').then(res => {
 *     __trackEnd(__reqId)
 *     return handleResponse(res)
 *   })
 */
function handleThenInstrumentation(
  path: NodePath<CallExpression>,
  reqIdVar: string
) {
  // 检查调用链: fetch(...).then(callback)
  const parent = path.parentPath
  if (!parent.isMemberExpression()) return
  const grandParent = parent.parentPath
  if (!grandParent?.isCallExpression()) return

  const prop = parent.node.property
  if (prop.type !== 'Identifier' || prop.name !== 'then') return

  // 找到 .then 的回调参数
  const thenCall = grandParent
  const thenCallback = thenCall.node.arguments[0]

  // 如果是箭头函数/函数表达式：在函数体开头注入 __trackEnd
  if (
    thenCallback.type === 'ArrowFunctionExpression' ||
    thenCallback.type === 'FunctionExpression'
  ) {
    const body = thenCallback.body
    if (body.type === 'BlockStatement') {
      body.body.unshift(
        template.statement(`__trackEnd(${reqIdVar});`)()
      )
    }
    // 如果是表达式体 (arg => expr)，需要改成块语句
    if (body.type !== 'BlockStatement') {
      thenCallback.body = {
        type: 'BlockStatement',
        body: [
          template.statement(`__trackEnd(${reqIdVar});`)(),
          { type: 'ReturnStatement', argument: body },
        ],
      }
    }
  }
}

/**
 * 在 setState 调用点包裹 __withActiveRequest
 *
 * 原始:
 *   setState(data)
 *
 * 插桩后:
 *   __withActiveRequest([__reqId_1, __reqId_2], () => setState(data))
 */
function handleSetStateInstrumentation(
  path: NodePath<CallExpression>,
  reqIdVar: string
) {
  // 找到同一作用域内的所有活跃 reqId
  const scope = path.scope
  const allReqIds = Object.keys(scope.getAllBindings()).filter(k => k.startsWith('__smarty_req_'))

  if (allReqIds.length === 0) return

  // 检查是否是 setState / dispatch 等状态更新调用
  const callee = path.node.callee
  if (callee.type === 'Identifier') {
    const isStateUpdater = [
      'setState', 'dispatch', 'set',
      // React useState 的 setter（通常在组件 scope 中，名字各异）
    ].includes(callee.name)

    if (!isStateUpdater) return

    // 包裹：__withActiveRequest([...reqIds], () => originalCall())
    const reqIdsArray = `[${allReqIds.join(', ')}]`
    const originalCall = path.node

    path.replaceWith(
      template.expression(`
        __withActiveRequest(${reqIdsArray}, () => CALLEE)
      `)({ CALLEE: originalCall })
    )
  }
}

/**
 * 在组件 render 函数末尾注入 __registerComponentDeps
 */
function injectComponentDepsRegistration(
  path: NodePath<FunctionDeclaration | ArrowFunctionExpression | FunctionExpression>,
  componentName: string
) {
  const deps = collectComponentDeps(path)
  if (deps.length === 0) return

  const depsLiteral = JSON.stringify(deps)

  // 在 return 之前插入
  const body = path.node.body
  if (body.type === 'BlockStatement') {
    const returnIdx = body.body.findLastIndex(s => s.type === 'ReturnStatement')
    const insertStmt = template.statement(`
      __registerComponentDeps(${JSON.stringify(componentName)}, ${depsLiteral});
    `)()
    if (returnIdx >= 0) {
      body.body.splice(returnIdx, 0, insertStmt)
    } else {
      body.body.push(insertStmt)
    }
  }
}

/**
 * 收集组件内部的数据依赖描述
 */
function collectComponentDeps(
  path: NodePath<FunctionDeclaration | ArrowFunctionExpression>
): DepEntry[] {
  const deps: DepEntry[] = []

  path.traverse({
    CallExpression(callPath) {
      // useQuery('/api/orders') → { hook: 'useQuery', url: '/api/orders' }
      if (callPath.node.callee.type === 'Identifier' && callPath.node.callee.name === 'useQuery') {
        const url = extractUrlFromArg(callPath.node.arguments[0])
        if (url) deps.push({ hook: 'useQuery', url: url.value })
      }

      // useSWR('/api/orders', fetcher)
      if (callPath.node.callee.type === 'Identifier' && callPath.node.callee.name === 'useSWR') {
        const url = extractUrlFromArg(callPath.node.arguments[0])
        if (url) deps.push({ hook: 'useSWR', url: url.value })
      }

      // useUserStore() → { store: 'useUserStore', key: 'user' }
      if (callPath.node.callee.type === 'Identifier' && callPath.node.callee.name.startsWith('use') && callPath.node.callee.name.endsWith('Store')) {
        deps.push({ store: callPath.node.callee.name, key: '*' })
      }
    },
  })

  return deps
}

/**
 * 给 Zustand store 注入 __api_source 元数据
 */
function injectStoreSourceTracking(path: NodePath<CallExpression>) {
  const callback = path.node.arguments[0]
  if (
    callback.type !== 'ArrowFunctionExpression' &&
    callback.type !== 'FunctionExpression'
  ) return

  // 在 set 调用处注入 __recordStoreSource
  if (callback.type === 'ArrowFunctionExpression' && callback.body.type === 'BlockStatement') {
    // 遍历回调中的 set 调用
    // 对每个 set({ key: value }) 前面的 fetch 调用注入追踪
    // ...实现细节
  }
}

// ── Helpers ──

function isReactComponent(name: string): boolean {
  return /^[A-Z]/.test(name)
}

function isZustandCreateCall(path: NodePath<CallExpression>): boolean {
  const callee = path.node.callee
  return (
    callee.type === 'Identifier' &&
    callee.name === 'create'
  ) || (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'zustand' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'create'
  )
}

function hash(str: string): string {
  let h = 0
  for (let i = 0; i < Math.min(str.length, 100); i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36).slice(0, 6)
}

interface DepEntry {
  hook?: string
  url?: string
  store?: string
  key?: string
}
```

### 4.3 运行时追踪库实现

```ts
// packages/smarty/src/web/runtime/tracker.ts

import type { BindingMap, RegionBinding, RuntimeTrace } from '../../core/binding-schema'

/**
 * 全局请求追踪器
 *
 * 核心数据结构：
 *   pendingRequests: Map<reqId, RequestEntry>  — 当前进行中的请求
 *   completedTraces: RuntimeTrace[]              — 已完成请求的追踪记录
 *   currentActiveIds: number[]                   — 当前执行上下文活跃的请求 ID
 *   componentDeps: Map<componentName, DepEntry[]>— 组件声明的依赖
 *   storeSources: Map<storeName.key, string>     — store 数据来源
 *   fiberToDom: WeakMap<Fiber, HTMLElement>      — React fiber → DOM 映射
 */
class RequestTracker {
  private pendingRequests = new Map<number, RequestEntry>()
  private completedTraces: RuntimeTrace[] = []
  private currentActiveIds: number[] = []
  private componentDeps = new Map<string, DepEntry[]>()
  private storeSources = new Map<string, string>()
  private fiberToDom = new WeakMap<any, HTMLElement>()
  private domBindingMap = new Map<string, Set<string>>()  // DOM selector → apiUrls

  private nextReqId = 1

  // ── Public API ──

  trackStart(url: string, method: string = 'GET'): number {
    const reqId = this.nextReqId++
    this.pendingRequests.set(reqId, {
      reqId,
      url,
      method,
      startTime: performance.now(),
      componentStack: [],
    })
    return reqId
  }

  trackEnd(reqId: number): void {
    const entry = this.pendingRequests.get(reqId)
    if (!entry) return

    entry.endTime = performance.now()

    // 移动至完成列表
    this.pendingRequests.delete(reqId)

    const trace: RuntimeTrace = {
      reqId: entry.reqId,
      url: entry.url,
      startTime: entry.startTime,
      endTime: entry.endTime,
      componentStack: [...entry.componentStack],
    }
    this.completedTraces.push(trace)
  }

  /**
   * 在 fn 执行期间，将 reqIds 设为活跃请求
   * 用于包裹 setState 等状态更新调用
   */
  withActiveRequest(reqIds: number[], fn: () => void): void {
    const prev = [...this.currentActiveIds]
    this.currentActiveIds = [...new Set([...prev, ...reqIds])]
    try {
      fn()
    } finally {
      this.currentActiveIds = prev
    }
  }

  /**
   * 组件 render 时注册其依赖
   */
  registerComponentDeps(componentName: string, deps: DepEntry[]): void {
    this.componentDeps.set(componentName, deps)

    // 将当前活跃请求关联到该组件
    if (this.currentActiveIds.length > 0) {
      for (const reqId of this.currentActiveIds) {
        const entry = this.pendingRequests.get(reqId)
        if (entry) {
          entry.componentStack.push({
            componentName,
            renderTime: performance.now(),
            activeReqIds: [...this.currentActiveIds],
          })
        }
      }
    }
  }

  /**
   * 记录 store 数据来源
   */
  recordStoreSource(storeName: string, key: string, url: string): void {
    this.storeSources.set(`${storeName}.${key}`, url)
  }

  /**
   * 记录 fiber → DOM 映射
   */
  recordFiberDom(fiber: any, domNode: HTMLElement): void {
    this.fiberToDom.set(fiber, domNode)
  }

  /**
   * 在 React commit 阶段关联 DOM 节点和接口
   *
   * 调用时机：React onCommitFiberRoot 钩子
   * 逻辑：遍历 host fibers → 找所属组件 → 查组件依赖 → 标记 DOM 节点
   */
  onCommitFiberRoot(root: any): void {
    const hostFibers = this.getMutatedHostFibers(root)

    for (const fiber of hostFibers) {
      const domNode = this.fiberToDom.get(fiber) || fiber.stateNode
      if (!domNode) continue

      const componentName = this.getNearestComponentName(fiber)
      if (!componentName) continue

      const deps = this.componentDeps.get(componentName)
      if (!deps || deps.length === 0) continue

      // 解析依赖到具体 API URL
      const apiUrls = new Set<string>()
      for (const dep of deps) {
        if (dep.url) {
          apiUrls.add(dep.url)
        }
        if (dep.store && dep.key) {
          const url = this.storeSources.get(`${dep.store}.${dep.key}`)
          if (url) apiUrls.add(url)
        }
      }

      if (apiUrls.size === 0) continue

      // 生成 DOM 选择器
      const selector = this.generateSelector(domNode)

      if (!this.domBindingMap.has(selector)) {
        this.domBindingMap.set(selector, new Set())
      }
      for (const url of apiUrls) {
        this.domBindingMap.get(selector)!.add(url)
      }
    }
  }

  /**
   * 生成最终的绑定地图
   */
  getBindingMap(): BindingMap {
    const regions: Record<string, RegionBinding> = {}

    for (const [selector, apiSet] of this.domBindingMap.entries()) {
      const regionId = this.findSkeletonRegion(selector)
      if (!regionId) continue

      if (!regions[regionId]) {
        regions[regionId] = {
          regionId,
          apis: [],
          source: { type: 'compile-time-instrumentation', file: '', reqId: '' },
          confidence: 'runtime',
        }
      }

      for (const url of apiSet) {
        if (!regions[regionId].apis.find(a => a.url === url)) {
          regions[regionId].apis.push({
            url,
            source: 'fetch',  // 运行时可能有更精确的类型
          })
        }
      }
    }

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      regions,
    }
  }

  // ── Internal Helpers ──

  private getMutatedHostFibers(root: any): any[] {
    // 遍历 fiber 树，找本次 commit 有变化的 HostComponent
    const results: any[] = []
    this.walkFibers(root.current, (fiber: any) => {
      if (fiber.tag === 5 /* HostComponent */) {  // React 内部常量
        if (fiber.alternate === null || fiber.memoizedProps !== fiber.alternate.memoizedProps) {
          results.push(fiber)
        }
      }
    })
    return results
  }

  private walkFibers(fiber: any, callback: (fiber: any) => void): void {
    if (!fiber) return
    callback(fiber)
    this.walkFibers(fiber.child, callback)
    this.walkFibers(fiber.sibling, callback)
  }

  private getNearestComponentName(fiber: any): string | null {
    let current = fiber.return
    while (current) {
      if (current.type && typeof current.type === 'function') {
        return current.type.displayName || current.type.name || null
      }
      if (current.type && typeof current.type === 'object' && current.type.$$typeof === Symbol.for('react.memo')) {
        return current.type.type?.displayName || current.type.type?.name || null
      }
      current = current.return
    }
    return null
  }

  private generateSelector(node: HTMLElement): string {
    // 优先使用 data-skeleton-region 属性
    const region = node.closest('[data-skeleton-region]')
    if (region) {
      return `[data-skeleton-region="${region.getAttribute('data-skeleton-region')}"]`
    }

    // fallback: 生成 CSS path
    const parts: string[] = []
    let current: HTMLElement | null = node
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase()
      if (current.id) {
        selector = `#${current.id}`
        parts.unshift(selector)
        break
      }
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2)
        selector += '.' + classes.join('.')
      }
      parts.unshift(selector)
      current = current.parentElement
    }
    return parts.join(' > ')
  }

  private findSkeletonRegion(selector: string): string | null {
    // 从 DOM 节点找到所属的 <Bound> / <Skeleton> 区域
    const el = document.querySelector(selector)
    if (!el) return null
    const region = el.closest('[data-skeleton-region]')
    return region?.getAttribute('data-skeleton-region') || null
  }

  // ── Singleton ──
  private static instance: RequestTracker
  static getInstance(): RequestTracker {
    if (!RequestTracker.instance) {
      RequestTracker.instance = new RequestTracker()
    }
    return RequestTracker.instance
  }
}

interface RequestEntry {
  reqId: number
  url: string
  method: string
  startTime: number
  endTime?: number
  componentStack: {
    componentName: string
    renderTime: number
    activeReqIds: number[]
  }[]
}

interface DepEntry {
  hook?: string
  url?: string
  store?: string
  key?: string
}

// ── 导出给 Babel 插桩使用的全局函数 ──

let __trackerInstance: RequestTracker | null = null

function getTracker(): RequestTracker {
  // 只在 baking 模式下激活
  if (process.env.SMARTY_BAKE !== 'true' && process.env.NODE_ENV === 'production') {
    // 生产环境返回 noop tracker
    return __trackerInstance || (__trackerInstance = createNoopTracker())
  }
  return __trackerInstance || (__trackerInstance = RequestTracker.getInstance())
}

function createNoopTracker(): RequestTracker {
  return new Proxy({} as RequestTracker, {
    get: () => () => {},  // 所有方法都是 noop
  })
}

// 全局函数（Babel 插桩的调用目标）
;(window as any).__trackStart = (url: string) => getTracker().trackStart(url)
;(window as any).__trackEnd = (reqId: number) => getTracker().trackEnd(reqId)
;(window as any).__withActiveRequest = (reqIds: number[], fn: () => void) => getTracker().withActiveRequest(reqIds, fn)
;(window as any).__registerComponentDeps = (name: string, deps: DepEntry[]) => getTracker().registerComponentDeps(name, deps)
;(window as any).__recordStoreSource = (storeName: string, key: string, url: string) => getTracker().recordStoreSource(storeName, key, url)
;(window as any).__getBindingMap = () => getTracker().getBindingMap()
```

---

## 5. 层级 3 实现：差分测试

### 5.1 Puppeteer 烘焙脚本

```ts
// packages/smarty/src/cli/bake-differential.ts

import puppeteer, { Browser, Page } from 'puppeteer'
import { createHash } from 'crypto'
import { writeFileSync, mkdirSync } from 'fs'
import type { BindingMap, RegionBinding } from '../core/binding-schema'

/**
 * 差分测试烘焙脚本
 *
 * 流程：
 *   1. 加载页面，获取所有骨架区域列表
 *   2. 加载页面（正常状态），对每个区域取 DOM 指纹
 *   3. 对每个 API 端点：拦截返回 {}，重新加载，取 DOM 指纹
 *   4. 对比指纹：变化的区域 = 依赖该 API
 *   5. 聚合输出绑定地图
 */
export async function differentialBake(options: {
  url: string
  apiEndpoints: string[]
  regionSelector: string  // e.g. '[data-skeleton-region]'
  outputPath: string
  viewport?: { width: number; height: number }
  parallel?: number       // 并行数，默认 3
}): Promise<BindingMap> {
  const { url, apiEndpoints, regionSelector, outputPath, viewport = { width: 1440, height: 900 }, parallel = 3 } = options

  console.log(`[differential-bake] 目标页面: ${url}`)
  console.log(`[differential-bake] API 端点: ${apiEndpoints.length} 个`)

  // Step 1: 建立 baseline（正常状态下的 DOM 指纹）
  const browser = await puppeteer.launch({ headless: true })
  const baselineFingerprints = await captureBaseline(browser, url, regionSelector, viewport)

  console.log(`[differential-bake] Baseline: ${baselineFingerprints.size} 个骨架区域`)

  // Step 2: 逐个拦截 API 并对比
  const regionBindings = new Map<string, Set<string>>()  // regionId → Set<apiUrl>

  // 分批并行，避免浏览器实例过多
  for (let i = 0; i < apiEndpoints.length; i += parallel) {
    const batch = apiEndpoints.slice(i, i + parallel)
    const results = await Promise.all(
      batch.map(apiUrl =>
        compareWithInterceptedApi(browser, url, apiUrl, regionSelector, baselineFingerprints, viewport)
      )
    )

    for (const result of results) {
      for (const regionId of result.changedRegions) {
        if (!regionBindings.has(regionId)) {
          regionBindings.set(regionId, new Set())
        }
        regionBindings.get(regionId)!.add(result.apiUrl)
      }
    }

    console.log(`[differential-bake] 进度: ${Math.min(i + parallel, apiEndpoints.length)}/${apiEndpoints.length}`)
  }

  await browser.close()

  // Step 3: 构建 BindingMap
  const regions: Record<string, RegionBinding> = {}
  for (const [regionId, apiSet] of regionBindings.entries()) {
    regions[regionId] = {
      regionId,
      apis: Array.from(apiSet).map(url => ({ url, source: 'fetch' as const })),
      source: { type: 'differential-testing', runId: new Date().toISOString() },
      confidence: 'differential',
    }
  }

  // 也包含 baseline 中没有任何 API 依赖的区域（纯静态区域）
  for (const regionId of baselineFingerprints.keys()) {
    if (!regions[regionId]) {
      regions[regionId] = {
        regionId,
        apis: [],
        source: { type: 'differential-testing', runId: new Date().toISOString() },
        confidence: 'differential',
      }
    }
  }

  const bindingMap: BindingMap = {
    version: 1,
    generatedAt: new Date().toISOString(),
    regions,
  }

  // 输出
  mkdirSync(require('path').dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, JSON.stringify(bindingMap, null, 2))

  console.log(`[differential-bake] 完成: ${Object.keys(regions).length} 个区域, ${apiEndpoints.length} 个 API`)
  return bindingMap
}

/**
 * 捕获 baseline：正常加载页面，记录每个骨架区域的 DOM 指纹
 */
async function captureBaseline(
  browser: Browser,
  url: string,
  regionSelector: string,
  viewport: { width: number; height: number }
): Promise<Map<string, DomFingerprint>> {
  const page = await browser.newPage()
  await page.setViewport(viewport)
  await page.goto(url, { waitUntil: 'networkidle2' })

  // 等待骨架消失（如果有的话）
  await page.waitForFunction(() => {
    return document.querySelectorAll('[data-skeleton-loading="true"]').length === 0
  }, { timeout: 10000 }).catch(() => {
    console.warn('[differential-bake] 超时等待骨架消失，继续采集')
  })

  // 关闭所有动画
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => {
      (el as HTMLElement).style.animation = 'none'
      ;(el as HTMLElement).style.transition = 'none'
    })
  })

  // 获取指纹
  const fingerprints = await page.evaluate((selector) => {
    const result: Record<string, DomFingerprint> = {}
    const regions = document.querySelectorAll(selector)

    for (const region of regions) {
      const id = region.getAttribute('data-skeleton-region') ||
                 region.getAttribute('data-bound-id') ||
                 region.getAttribute('id') ||
                 `region-${Math.random().toString(36).slice(2, 8)}`

      result[id] = extractFingerprint(region)
    }

    return result
  }, regionSelector)

  await page.close()
  return new Map(Object.entries(fingerprints))
}

/**
 * 拦截单个 API，加载页面，对比变化
 */
async function compareWithInterceptedApi(
  browser: Browser,
  url: string,
  apiUrl: string,
  regionSelector: string,
  baselineFingerprints: Map<string, DomFingerprint>,
  viewport: { width: number; height: number }
): Promise<{ apiUrl: string; changedRegions: string[] }> {
  const page = await browser.newPage()
  await page.setViewport(viewport)

  // 拦截请求
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    if (request.url() === apiUrl || request.url().includes(apiUrl)) {
      // 返回空对象
      request.respond({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      })
    } else {
      request.continue()
    }
  })

  await page.goto(url, { waitUntil: 'networkidle2' })

  // 等待骨架消失
  await page.waitForFunction(() => {
    return document.querySelectorAll('[data-skeleton-loading="true"]').length === 0
  }, { timeout: 10000 }).catch(() => {})

  // 关闭动画
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => {
      (el as HTMLElement).style.animation = 'none'
      ;(el as HTMLElement).style.transition = 'none'
    })
  })

  // 获取指纹并对比
  const changedRegions = await page.evaluate(
    (selector, baselineMap) => {
      const regions = document.querySelectorAll(selector)
      const changed: string[] = []

      for (const region of regions) {
        const id = region.getAttribute('data-skeleton-region') ||
                   region.getAttribute('data-bound-id') ||
                   region.getAttribute('id') ||
                   ''

        const currentFp = extractFingerprint(region)
        const baselineFp = baselineMap[id]

        if (baselineFp && isFingerprintChanged(baselineFp, currentFp)) {
          changed.push(id)
        }
      }

      return changed
    },
    regionSelector,
    Object.fromEntries(baselineFingerprints)
  )

  await page.close()
  return { apiUrl, changedRegions }
}

// ── DOM 指纹 ──

interface DomFingerprint {
  structure: string      // tagName 序列
  textHash: string       // 文本内容 hash
  childCount: number     // 子节点数
  skeletonMarkers: number  // 骨架标记（占位元素）数量
}

function extractFingerprint(element: Element): DomFingerprint {
  // 消噪：替换时间戳/UUID/随机值
  const normalizeText = (text: string): string => {
    return text
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/g, '__TIMESTAMP__')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '__UUID__')
      .replace(/[0-9a-f]{32,}/gi, '__HASH__')
      .replace(/\d{13,}/g, '__EPOCH__')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const structure = [...element.querySelectorAll('*')]
    .map(el => el.tagName.toLowerCase())
    .join(',')

  const text = normalizeText(element.textContent || '')
  const textHash = createHash('md5').update(text).digest('hex').slice(0, 16)

  const childCount = element.children.length

  const skeletonMarkers = element.querySelectorAll(
    '[class*="skeleton"], [class*="placeholder"], [class*="shimmer"], [class*="loading"]'
  ).length

  return { structure, textHash, childCount, skeletonMarkers }
}

function isFingerprintChanged(a: DomFingerprint, b: DomFingerprint): boolean {
  // 结构变了 → 强信号
  if (a.structure !== b.structure) return true

  // 文本变了 → 强信号
  if (a.textHash !== b.textHash) return true

  // 子节点数变了 → 强信号
  if (a.childCount !== b.childCount) return true

  // 骨架标记数变了 → 中等信号
  if (a.skeletonMarkers !== b.skeletonMarkers) return true

  return false
}
```

---

## 6. 完整烘焙流水线

### 6.1 统一的 baking 入口

```ts
// packages/smarty/src/cli/bake.ts

import { analyzeFile, aggregateBindings } from '../core/static-bind'
import { differentialBake } from './bake-differential'
import { glob } from 'glob'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { BindingMap, StaticBinding } from '../core/binding-schema'

/**
 * 主烘焙命令: smarty bake
 *
 * 流程:
 *   1. 静态分析所有源文件 → binding-map-static.json
 *   2. 编译时插桩 bundle（通过 SWC/Vite 插件，在构建时完成）
 *   3. Puppeteer 加载插桩后的页面 → 收集运行时追踪数据
 *   4. 差分测试验证 + 补充盲区
 *   5. 合并 → 最终 binding-map.json
 *
 * 输出: bones/regions/web/bindings.json
 */
export async function bake(options: {
  srcDir: string
  outputDir: string
  pageUrl: string
  regionSelector?: string
}): Promise<void> {
  const { srcDir, outputDir, pageUrl, regionSelector = '[data-skeleton-region]' } = options

  console.log('[smarty bake] 开始烘焙 API-DOM 绑定关系...')

  // ── Step 1: 静态分析 ──
  console.log('[smarty bake] Step 1/4: 静态分析...')
  const srcFiles = glob.sync(join(srcDir, '**/*.{tsx,jsx,ts,js}'), {
    ignore: ['**/node_modules/**', '**/*.test.*', '**/*.spec.*'],
  })

  let allStaticBindings: StaticBinding[] = []
  for (const file of srcFiles) {
    const code = readFileSync(file, 'utf-8')
    try {
      const bindings = analyzeFile(code, file)
      allStaticBindings = allStaticBindings.concat(bindings)
    } catch (e) {
      console.warn(`[smarty bake] 跳过文件 ${file}: ${(e as Error).message}`)
    }
  }

  // Step 1b: 找组件→骨架区域的映射
  const componentToRegion = findComponentToRegionMap(srcFiles)

  const staticMap = aggregateBindings(allStaticBindings, componentToRegion)

  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, 'binding-map-static.json'), JSON.stringify(staticMap, null, 2))

  console.log(`[smarty bake] 静态分析完成: ${allStaticBindings.length} 条绑定, ${Object.keys(staticMap.regions).length} 个区域`)

  // ── Step 2: 收集所有 API 端点（从静态分析结果） ──
  const allApis = new Set<string>()
  for (const binding of allStaticBindings) {
    for (const api of binding.apis) {
      if (!api.dynamic) {
        allApis.add(api.url)
      }
    }
  }

  console.log(`[smarty bake] Step 2/4: 发现 ${allApis.size} 个 API 端点`)

  // ── Step 3: 运行时采集（如果页面提供了插桩后的 bundle） ──
  console.log('[smarty bake] Step 3/4: 运行时采集（需插桩后的 bundle）...')
  // 如果构建流程中包含了编译时插桩，则这里从页面采集运行时数据
  // 否则跳过

  // ── Step 4: 差分测试验证 ──
  console.log('[smarty bake] Step 4/4: 差分测试验证...')
  const diffMap = await differentialBake({
    url: pageUrl,
    apiEndpoints: Array.from(allApis),
    regionSelector,
    outputPath: join(outputDir, 'binding-map-differential.json'),
    parallel: 3,
  })

  // ── Final: 合并结果 ──
  const finalMap = mergeBindingMaps([staticMap, diffMap])

  writeFileSync(join(outputDir, 'bindings.json'), JSON.stringify(finalMap, null, 2))

  console.log(`[smarty bake] 完成! 最终产物: ${join(outputDir, 'bindings.json')}`)
  printSummary(finalMap)
}

/**
 * 合并多层级的绑定地图
 *
 * 优先级：runtime > static > differential
 *   - runtime 有数据 → 用 runtime（最精确）
 *   - runtime 没有 → 用 static（较精确但可能不完整）
 *   - 都没有 → 用 differential（黑盒但完整）
 */
function mergeBindingMaps(maps: BindingMap[]): BindingMap {
  const merged: BindingMap = {
    version: 1,
    generatedAt: new Date().toISOString(),
    regions: {},
  }

  // 按优先级从低到高合并
  const priority = ['differential', 'static', 'runtime'] as const

  for (const source of priority) {
    const map = maps.find((_, i) => {
      const confidences = ['differential', 'static', 'runtime']
      return i === priority.indexOf(source)
    })

    if (!map) continue

    for (const [regionId, binding] of Object.entries(map.regions)) {
      if (merged.regions[regionId] && binding.confidence !== 'runtime') {
        // 已有更高优先级的数据，跳过
        continue
      }
      merged.regions[regionId] = binding
    }
  }

  return merged
}

function printSummary(map: BindingMap): void {
  let totalApis = 0
  const byConfidence: Record<string, number> = {}

  for (const region of Object.values(map.regions)) {
    totalApis += region.apis.length
    byConfidence[region.confidence] = (byConfidence[region.confidence] || 0) + 1
  }

  console.log(`  总区域数: ${Object.keys(map.regions).length}`)
  console.log(`  总 API 依赖: ${totalApis}`)
  console.log(`  置信度分布: ${JSON.stringify(byConfidence)}`)
}

/**
 * 从源码中扫描组件→骨架区域的映射
 *
 * 找 <Bound id="X" deps={[...]}> 和 <Skeleton name="X"> 的包裹关系
 */
function findComponentToRegionMap(srcFiles: string[]): Map<string, string> {
  const map = new Map<string, string>()

  // 扫描所有 JSX，找 <Bound>/<Skeleton> 的 children 中的组件引用
  // 使用简单的正则或 AST 扫描
  // ...实现细节

  return map
}
```

---

## 7. 特殊情况处理

### 7.1 动态 URL

```ts
// 模式识别：模板字符串中的变量
// `/api/user/${id}`  → 标记为 dynamic，记录 paramNames=['id']

// 运行时：通过插桩的 __trackStart 捕获实际 URL
//   const id = props.userId
//   const data = await fetch(`/api/user/${id}`)
//
// 插桩后：
//   const id = props.userId
//   const __reqId = __trackStart(`/api/user/${id}`)  // ← 运行时求值
//   const data = await fetch(`/api/user/${id}`)
//   __trackEnd(__reqId)
//
// __trackStart 记录的是实际 URL（如 '/api/user/42'），所以运行时精确
```

### 7.2 并发请求

```ts
// 并发场景：
async function loadPage() {
  const __reqId1 = __trackStart('/api/user')
  const __reqId2 = __trackStart('/api/orders')

  const [user, orders] = await Promise.all([
    fetchUser(),   // 内部 /api/user
    fetchOrders(), // 内部 /api/orders
  ])

  __trackEnd(__reqId1)
  __trackEnd(__reqId2)

  __withActiveRequest([__reqId1, __reqId2], () => {
    setState({ user, orders })  // setState 关联两个请求
  })
}

// 每个请求有独立的 reqId，并发互不干扰
```

### 7.3 Store 绕路（最难场景）

```ts
// 完整例子：API → Store → Component → DOM

// 原始代码：
const useUserStore = create((set) => ({
  user: null,
  fetch: async () => {
    const { data } = await axios.get('/api/user')
    set({ user: data })
  },
}))

function UserCard() {
  const user = useUserStore(s => s.user)
  return <div>{user?.name}</div>
}

// ── 插桩后（Babel 自动生成） ──

// Store 侧：
const useUserStore = create((set) => ({
  user: null,
  __api_source: {},           // ← 注入
  fetch: async () => {
    const __reqId = __trackStart('/api/user')  // ← 注入
    const { data } = await axios.get('/api/user')
    __trackEnd(__reqId)                        // ← 注入
    __recordStoreSource('useUserStore', 'user', '/api/user', __reqId)  // ← 注入
    set({ user: data })
  },
}))

// Component 侧：
function UserCard() {
  const user = useUserStore(s => s.user)

  // ← 注入：自动识别 useUserStore
  __registerComponentDeps('UserCard', [
    { store: 'useUserStore', key: 'user' },
  ])

  return <div>{user?.name}</div>
}

// ── 运行时链路 ──
// 1. useUserStore.fetch() → __recordStoreSource('useUserStore', 'user', '/api/user')
// 2. UserCard render → __registerComponentDeps('UserCard', [{ store: 'useUserStore', key: 'user' }])
// 3. React commit → onCommitFiberRoot → 遍历 fiber → 找 UserCard → 查 deps →
//    解析 store: 'useUserStore' + key: 'user' → 查 __storeSources → '/api/user'
// 4. 输出：UserCard 的 DOM → /api/user ✓
```

### 7.4 条件请求（A/B 分支）

```ts
// 静态分析覆盖不到的情况：
function Dashboard() {
  if (experimentVariant === 'A') {
    // 分支 A
    return <Bound id="dashboard" deps={['query:user', 'query:orders-v2']}>
      <DashboardV2 />
    </Bound>
  } else {
    // 分支 B
    return <Bound id="dashboard" deps={['query:user', 'query:orders-v1']}>
      <DashboardV1 />
    </Bound>
  }
}

// 处理策略：
// 1. 静态分析：标记两根分支的 API 并集 ([query:user, query:orders-v1, query:orders-v2])
// 2. 运行时采集：实际执行的分支被追踪
// 3. 差分测试：两个 variant 分别测试，合并结果
```

### 7.5 WebSocket / SSE

```ts
// WS 无请求-响应语义，需要专门处理：

// 模式 1：WS 消息按事件类型分配 source id
const ws = new WebSocket('wss://example.com/ws')
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.type === 'user_update') {
    __trackStart('ws://user_update')  // ← 消息类型作为虚拟 API
    setUser(msg.payload)
    __trackEnd(wsReqId)
  }
}

// 模式 2：SSE 按 event type 分配
const es = new EventSource('/api/events')
es.addEventListener('order', (e) => {
  __trackStart('sse://order')
  setOrders(JSON.parse(e.data))
  __trackEnd(sseReqId)
})

// 在绑定地图中标记 source: 'websocket' | 'sse'
```

---

## 8. 与既有框架的集成路径

### 8.1 React Query 项目

```ts
// 项目已有 React Query？最小改动方案：

// Step 1: 静态分析直接走（不需要改业务代码）
// Babel 插件能识别 useQuery / useMutation 调用

// Step 2: 可选——attach adapter 让 <Bound> 组件用上（与绑定分析独立）
import { attachReactQueryAdapter } from 'smarty/adapters/react-query'
import { queryClient } from './query-client'
attachReactQueryAdapter(queryClient)
```

### 8.2 裸 fetch 项目

```ts
// 不需要改业务代码。
// Babel 插桩会在编译期自动注入追踪代码。
// 业务方只需要在构建配置中加入 Babel 插件：

// babel.config.js
module.exports = {
  plugins: [
    process.env.SMARTY_BAKE ? '@smarty/babel-plugin-bind-runtime' : null,
    // ...其他插件
  ].filter(Boolean),
}
```

### 8.3 不使用 Babel 的项目（SWC/esbuild）

```ts
// SWC 插件（Rust 实现）略复杂，但原理相同
// 优先支持 Babel 路径
// SWC 路径可以等 Babel 插件验证后再迁移

// esbuild 用户：在 esbuild 之前加一个 Babel 步骤
// vite.config.ts
import { smartyPlugin } from 'smarty/vite-plugin'
// vite-plugin 内部处理 Babel 步骤
```

---

## 9. 实施优先级与周级里程碑

| 周 | 交付物 | 产出 |
|----|--------|------|
| **W1-2** | Babel 静态分析插件 | `@smarty/babel-plugin-bind-static` + 能输出 `binding-map-static.json` |
| **W3-4** | 运行时追踪库 + DOM 落点 | `smarty/runtime/tracker` + React fiber commit 钩子 |
| **W5-6** | Babel 编译时插桩插件 | `@smarty/babel-plugin-bind-runtime` + 输出 `binding-map-runtime.json` |
| **W7-8** | Puppeteer 差分测试脚本 | `differentialBake()` + 输出 `binding-map-differential.json` |
| **W9** | 合并流水线 + CLI | `smarty bake` 命令 + 三合一输出 |
| **W10** | 文档 + 示例项目 | 3 个示例项目的完整烘焙流程 |

---

## 10. 诚实边界（更新）

| 场景 | 覆盖情况 | 说明 |
|------|---------|------|
| useQuery/useSWR 直链 | **精确** | 静态分析直接识别 |
| 裸 fetch + async/await | **精确** | Babel 插桩，闭包保留变量 |
| store 绕路（Zustand/Redux） | **精确** | 插桩给 store 注入 source 元数据 |
| 数据经复杂 transform | **精确** | 不追踪值，追踪组件级依赖 |
| 并发请求 | **精确** | 每个请求独立 reqId |
| 动态 URL | **精确（运行时）** | 插桩的 trackStart 在运行时求值 |
| 条件分支（A/B 测试） | **合并覆盖** | 静态分析 + 差分测试合并 |
| 第三方库内部请求 | **差分测试覆盖** | 黑盒层级 3 兜底 |
| WebSocket/SSE | **需手动标记** | 无请求-响应语义，按消息类型标记 |
| eval / new Function | **不能覆盖** | 排除 |
| Service Worker 拦截 | **需额外处理** | SW 层注入 |

---

## 11. 与 research doc 和 solution doc 的对齐

| # | 原 research doc 的新发现 | 本实现方案对应 |
|---|--------------------------|---------------|
| 1 | CDP async stack（§8 扩展调研） | 不需要。本方案用闭包保留变量，不依赖 CDP |
| 2 | TC39 AsyncContext（§11.1） | 不需要。不作为依赖 |
| 3 | react-scan commit 归因（§4） | 采纳。层级 2 的 React commit 钩子基于此思路 |
| 4 | OT traceId 主干（§3） | 部分采纳。reqId 概念保留，但不跨异步链传播 |
| 5 | 差分测试验证（§10.4） | 采纳为层级 3 |
| 6 | Babel 编译期插桩（§11.5） | 采纳为层级 2 |
| 7 | 静态后向切片（§11.2） | 简化为层级 1 的 AST 模式匹配 |

---

## 12. 参考

- 本目录 [api-dom-binding-research.md](./api-dom-binding-research.md) — 跨领域范式调研
- 本目录 [api-dom-binding-solution.md](./api-dom-binding-solution.md) — 层次化可行方案
- [14-step5-Bound显式接口态.md](../14-step5-Bound显式接口态.md) — `<Bound>` 组件设计
- [02-最佳生成算法.md](../02-最佳生成算法.md) — BGv2 骨架生成算法
- [01-架构与模型.md](../01-架构与模型.md) — 整体架构与数据契约
