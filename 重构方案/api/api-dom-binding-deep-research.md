# API ↔ DOM 绑定关系：全领域深度调研（第二轮）

> 抛开现有技术方案，从零开始，逐领域地毯式扫描，评估每一个可能的范式。
> 硬约束：不可修改浏览器引擎（不可发版 Firefox 私叉）、不可依赖未 ship 的 TC39 提案、必须兼容裸 `fetch + useState`。
> 日期：2026-06-29

---

## 0. 调研方法论

### 0.1 扫描的领域

```
数据库溯源 —— 值级 provenance，从数据出发
分布式追踪 —— 请求级传播，从调用链出发
编译器/PL —— 程序分析，从代码出发
安全分析 —— 污点/信息流，从攻击面出发
软件测试 —— 差分/变异，从行为差异出发
响应式系统 —— 依赖图，从状态订阅出发
浏览器引擎 —— 原生能力，从平台出发
录制/回放 —— 确定性重放，从时间旅行出发
可视化/图论 —— 图可达性，从关系出发
```

### 0.2 评估维度

对每个候选方案，从 7 个维度打分（0-5）：

| 维度 | 含义 |
|------|------|
| **精确度** | 能多准确地关联 API↔DOM（0=随机，5=精确到字符位置） |
| **覆盖率** | 覆盖多大的代码模式范围（0=仅一种写法，5=所有写法） |
| **侵入性** | 对源码/构建/运行的修改程度（0=改引擎，5=零侵入） |
| **性能开销** | 在 dev/bake 阶段的额外耗时（0=不可接受，5=可忽略） |
| **工程复杂度** | 实现和维护的成本（0=不可实现，5=开箱即用） |
| **可落地性** | 当前是否可工程化（0=纯学术/不可行，5=npm install 即用） |
| **未来潜力** | 3 年内预期改进空间（0=无改进可能，5=被标准化） |

---

## 1. 数据库领域 —— 数据血缘（Provenance）

### 1.1 核心理论：Why/Where/How Provenance + Semiring Polynomial

**来源**：Green et al. (2007) "Provenance Semirings"，Cheney et al. "Provenance in Databases: Why, How, and Where"

**机制**：在关系代数中，provenance semiring 给每个 tuple 附加一个多项式，描述它是从哪些源 tuple 通过哪些算子产生的。例如：
```
result tuple t = (a₁ ⊗ a₂) ⊕ (a₃ ⊗ a₄)
// 表示 t 来自(源 a₁ AND 源 a₂) OR (源 a₃ AND 源 a₄)
```
对于聚合查询，`how-provenance` 记录聚合前的所有参与行。对于 WHERE 子句，`why-provenance` 记录哪些源行是结果行的"最小见证集"。

**直接映射到本问题**：
```
接口返回的 JSON 字段 = 数据库源 tuple
setState 的 data 对象 = 中间结果
DOM textContent = 最终输出
问题 = 从 textContent 反向求 provenance polynomial
```

### 1.2 可行性评估

| 前提条件 | 前端是否满足 |
|----------|------------|
| 数据流经过封闭的关系代数算子 | **不满足**——前端数据流是任意 JS 函数，不是 SELECT/JOIN/GROUP BY |
| 源 tuple 有唯一标识 | 部分满足——fetch 的 URL 可作为源标识 |
| 算子语义可形式化 | **不满足**——`data.map(x => transform(x))` 的 transform 是任意 ES 代码 |

**关键障碍**：Provenance semiring 依赖封闭的算子集（relational algebra）。一旦数据经过 `Array.map(f)` 且 `f` 是任意函数，多项式就会爆炸——每个 f 分支都会产生新的项，而且是**无界的**。

### 1.3 可借鉴的部分

1. **Why-provenance 的"最小见证集"概念**：可以问"哪些接口是导致这段 DOM 存在的**充分必要条件**"——这正是差分测试的数学基础。
2. **Polynomial 作为模型的表达能力**：用多项式表达"DOM 区域 = (API_A AND API_B) OR (API_C AND API_D)" 比简单的 Set<API> 更精确。
3. **半环结构**：如果只是"知道这个 DOM 依赖哪些 API"，可以用**min-set semiring**（求并集）而不是 full polynomial。

**评分**：

| 精确度 | 覆盖率 | 侵入性 | 性能 | 工程 | 可落地 | 未来 |
|--------|--------|--------|------|------|--------|------|
| 4（理论） | 2 | 5 | 5 | 1 | 1 | 2 |

**判定：纯学术参考，不做工程路径。但"最小见证集"概念用于差分测试的理论基础。** 在实现文档的层级 3（差分测试）中，拦截单个接口后 DOM 消失 = 该接口是"最小见证集"元素。

---

## 2. 分布式追踪领域 —— OpenTelemetry 式上下文传播

### 2.1 成熟度对比：Node.js vs Browser

这是原 research doc 明确提出、"API↔DOM 绑定方案"进一步深化的方向。关键区分在于**传播层的可用性**：

| 传播层 | Node.js | Browser |
|--------|---------|---------|
| `async_hooks` / `AsyncLocalStorage` | **原生可用**，Node 8+ built-in | **不存在** |
| V8 PromiseHook（引擎级） | 可用（通过 async_hooks） | **不可用**——PromiseHook 是 V8 内部 API，浏览器不暴露 |
| CDP `Debugger.setAsyncCallStackDepth` | — | **可用**，但仅在 DevTools/headless 模式，且只能读 async stack **不能写自定义数据** |
| TC39 AsyncContext.Variable | Stage 2.7 实验 | **未来可用**——Chrome Canary 已实验实现 |
| Zone.js userland | **有致命缺陷** | async/await 绕过 userland Promise，**Angular 官方确认不可 patch** |
| Babel async→promise 降级 | 可行 | 可行但**严重破坏开发体验**（堆栈变形、try-catch 行为差异） |

### 2.2 OpenTelemetry JS Browser SDK 的真实状态

OpenTelemetry 的 browser SDK 提供以下能力：

- **`@opentelemetry/auto-instrumentations-web`**：自动插桩 `fetch`、`XMLHttpRequest`、`document` load、User Interaction、LongTask
- **Context Manager**：基于 Zone.js 的实现（`ZoneContextManager`），**受限于 Zone.js 的 async/await 缺陷**
- **Span 可带自定义 attribute**（如 URL、method、status code、traceId）

**对于本问题的价值**：
- 可以**自动创建 span** 给每个 fetch 请求——不需要改业务代码
- 每个 span 天然携带 URL、method、start/end time
- **但** span 只覆盖 fetch 调用本身，**不覆盖** fetch→setState→DOM 的链路
- ZoneContextManager 在 async/await 中**不可靠**

### 2.3 一个被忽略的 OT 能力：Span Links

OpenTelemetry 的 **Span Links**（[K8s KEP #5915 使用 Span Links 处理解耦异步](https://github.com/kubernetes/enhancements/issues/5915)）是一个关键的原语：

```
Span Link = "span B 不是 span A 的子 span（不在同一个 trace tree 中），
             但 B 的语义是由 A 引起的"
```

**映射到本问题**：setState 不是 fetch 的子操作，但 setState **是由** fetch 引起的。即：
```
fetch span ──(Link)──> setState effect span
```

这避免了 traceId 必须在调用栈上传播的问题——改为**事后关联**：只要在 fetch 的 resolve 和 setState 的执行之间建立 Link，因果链就建立。

但 Span Links 目前依赖 userland 调用 `span.addLink()`——如果插桩能做到"每个 .then 回调自动创建 Link"，就能建立关联。

**评分（当前可用性）**：

| 精确度 | 覆盖率 | 侵入性 | 性能 | 工程 | 可落地 | 未来 |
|--------|--------|--------|------|------|--------|------|
| 3（fetch 侧精确，DOM 侧不确定） | 3（同步 .then 覆盖，async/await 不全） | 4 | 4 | 3 | 2 | 5 |

**判定：前端内的分布式追踪在异步传播层有致命缺陷。AsyncContext 落地后大幅提升。当前不作为传播主干。**

---

## 3. 编译器/PL 领域

### 3.1 React Compiler (Forget) —— 现成的依赖分析基座

React Compiler（Facebook/Meta，2024 开源）是对本问题**最有价值的现有学术-工业交叉产物**。

#### 3.1.1 它做了什么

React Compiler 将 Babel AST 转换为 **HIR（High-level IR）**，建**控制流图（CFG）**，然后用 **SSA（Static Single Assignment）** 形式精确追踪每个值的定义和使用。

核心概念——**Reactive Scope**：
```
Reactive Scope = "一组创建/变更在一起的 values，和涉及创建/变更这些 values 的指令集合"
```

当 React Compiler 分析组件时，它能确定：
- 组件的每个 JSX 表达式依赖哪些值
- 这些值来自哪些 hook 调用或 props
- 哪些值的变更会触发重新渲染

#### 3.1.2 对本问题的直接适用性

React Compiler 已经能回答：
```
"这个 JSX 节点依赖哪些 hook 调用的返回值？"
```

而我们需要的答案是：
```
"这个 DOM 子树依赖哪些 API 请求？"
```

**差距是 hook 返回值 → API URL 的映射。** React Compiler 不做 API URL 分析——它对数据来源的理解停在"这个值来自 hook X 的返回值"，而"hook X 对应 `/api/user`"是我们的业务知识。

#### 3.1.3 为什么不能直接复用 React Compiler

1. **React Compiler 是 React 项目的构建工具，不是库。** 它没有导出 API 让第三方分析。需要 fork 或反向工程其 HIR 格式。
2. **只分析组件内部。** store 绕路（Zustand/Redux）不在其分析范围内。
3. **不分析 fetch 调用。** 它是一个 memoization 编译器，目标是减少 re-render，不是追溯数据来源。
4. **ES5/class component 不支持**——老项目覆盖不了。

#### 3.1.4 但它验证了一个关键路径

React Compiler 证明了**在 React 框架下，静态分析完全可以精确追踪"JSX 依赖哪些值"**——这是本问题中最难的部分之一。如果它是可行的，那么我们在它之上再加一层"值→API URL 的映射"就是可行的。

**评分**：

| 精确度 | 覆盖率 | 侵入性 | 性能 | 工程 | 可落地 | 未来 |
|--------|--------|--------|------|------|--------|------|
| 4（值级精确，但不含 API URL） | 3（仅函数组件，无 store） | 5 | 4 | 1（无公开 API） | 2 | 5 |

**判定：作为长期基座方向重点关注。短期工程代价高（无公开 API），但它的存在证明了"静态分析可行"这一关键命题。** 如果未来 React Compiler 开源其 HIR API 或提供插件机制，本方案可在此基础上建立。

### 3.2 TC39 AsyncContext —— 革命性改变但尚未可用

#### 3.2.1 API 及其能力

```js
const requestCtx = new AsyncContext.Variable()

// 在请求发起处设置 context
requestCtx.run({ traceId: '123', url: '/api/user' }, async () => {
  await fetch('/api/user')          // context 自然传播
  const data = await transform()    // 仍然在 context 中
  setState(data)                    // 仍能读到 context
  setTimeout(() => {
    // 即使跨 macrotask，context 也传播！
    console.log(requestCtx.get())   // { traceId: '123', url: '/api/user' }
  }, 1000)
})
```

如果这个 API 在所有浏览器中可用，**整个 API↔DOM 绑定问题几乎解决了一半**：只需要在每个 fetch 调用时包一层 `requestCtx.run()`，在 `setState` 时读 `requestCtx.get()`，就能知道"这次 setState 是由哪个 fetch 引起的"。

#### 3.2.2 当前状态（2026-06）

| 维度 | 状态 |
|------|------|
| TC39 Stage | **Stage 2.7**（接近 Stage 3，但还未到） |
| Chrome/V8 | Canary 实验实现，未 shipping |
| Firefox/SpiderMonkey | 无公开进度 |
| Safari/JavaScriptCore | 无公开进度 |
| Node.js | `AsyncLocalStorage` 已可用（功能等价但 API 不同） |
| 预计 shipping | **2027-2028**（乐观估计） |

#### 3.2.3 它改变什么

如果 AsyncContext shipping：
- **不需要 Babel 插桩**来"利用闭包保留变量"——`AsyncContext.Variable` 自动跨所有异步边界传播
- **不需要 CDP async stack**——直接读 `requestCtx.get()` 即可
- **不需要 async→promise 降级**——原生支持
- **不需要区分 .then vs await**——两者都支持
- **不需要手动 `__withActiveRequest` 包裹 setState**——只要 setState 在 `requestCtx.run()` 的回调链中，自动携带

**评分**：

| 精确度 | 覆盖率 | 侵入性 | 性能 | 工程 | 可落地 | 未来 |
|--------|--------|--------|------|------|--------|------|
| 5 | 5 | 5 | 5 | 5 | 1（未 ship） | 5 |

**判定：一旦 shipping，就是绝对最佳方案。当前不可作为依赖，但所有工程决策都应为此做准备。** 建议的迁移路径：

```
当前:   Babel 插桩 "利用闭包保留变量" + 注入追踪代码
中期:   迁移至 AsyncContext.Variable → 删除所有 Babel 插桩代码
        → 保留 RequestTracker 数据结构不变，只改传播层
        → 删除 __withActiveRequest / __registerComponentDeps 等 hack
```

### 3.3 TC39 Signals 提案 —— 与 MobX/Solid 同宗

**状态**：Stage 1（2025），离 shipping 至少 3-5 年。

**机制**：
```js
const counter = new Signal.State(0)
const isEven = new Signal.Computed(() => counter.get() % 2 === 0)

// 当 counter 变化时，isEven 自动重新计算
// 底层维护依赖图：isEven 依赖 counter
```

**对本问题的价值**：如果所有状态都用 Signals 管理，那么 Signals 的依赖图天然记录了"哪个 DOM 渲染依赖哪个状态"，再往上追溯"哪个状态来自哪个 API"即可完成绑定。

但 Signals 要求**所有状态都必须是 Signal**——这等于要求业务全部重写，不现实。且 Signals 提案目前只 Stage 1。

**判定**：长期利好（5 年后），当前不纳入工程路径。

### 3.4 静态程序切片（Program Slicing）

#### 3.4.1 学术界现状

**工具**：WALA（IBM）、TAJS（AAU）、SAFE、CodeQL

**核心思路**：给定程序中的一个点（slicing criterion，如 `div.textContent = x`），沿**程序依赖图（PDG）**反向追踪——数据依赖（data dependence）+ 控制依赖（control dependence）——找到所有可能影响 `x` 的值的语句。这些语句的集合就是 slice。

**在 JavaScript 上的可行性与不可行性**：

| 能做 | 不能做 |
|------|--------|
| Anderson 式指针分析（WALA 支持 JS 的大子集） | 动态属性访问 `obj[dynamicKey]` |
| 调用图构建（识别直接调用、方法调用） | `eval()` 和 `new Function()` |
| 简单的数据流追踪（赋值、返回值） | 闭包中的变量捕获（函数式编程的核心） |
| 简单的控制流（if/else/for） | 原型链上的方法解析在 static 时不可判定 |

**核心结论**：静态切片在 JS 上是 **soundy**（非 sound 的实用近似），误差率在 20-60% 之间（取决于代码风格）。

#### 3.4.2 CodeQL 能做但做不到

CodeQL（GitHub 的 SAST 引擎）对 JS 有数据流分析能力。它可以写查询：

```ql
from DataFlow::Node source, DataFlow::Node sink
where
  source = API::moduleExport("fetch") and
  sink = DOM::textContentAssignment()
select source, sink
```

**问题**：
1. CodeQL 的 DOM 模型是对运行时 DOM API 的静态近似——它知道 `element.textContent = x` 是 DOM 写入，但不知道这个 element 对应渲染树中哪个节点
2. 同样是 soundy，过近似严重
3. CodeQL 需要整个项目的数据库（包含所有依赖），在大型项目中构建慢

#### 3.4.3 Slicing 的价值定位

静态切片单独用不行，但**作为预标注工具**有明确价值：
- 用 slicing 找到所有"可能来自 API 的数据→组件的路径"
- 标注为 `@api-source candidate`
- 运行时 traceId 验证哪些 candidate 实际生效
- 静态过近似被运行时过滤 → 精确

**评分**：

| 精确度 | 覆盖率 | 侵入性 | 性能 | 工程 | 可落地 | 未来 |
|--------|--------|--------|------|------|--------|------|
| 2（过近似严重） | 4 | 5 | 3 | 1 | 2 | 3 |

**判定：不单独用，可作为编译时预标注的补充路径（优先级低）。**

### 3.5 Babel 编译期插桩 —— 当前工程最可行的路径

**机制已在实现文档详尽描述。这里只做跨领域对比定位。**

相比其他编译路径：

| 对比项 | React Compiler | CodeQL 切片 | Babel 插桩 |
|--------|---------------|-------------|------------|
| JSX 依赖追踪 | **精确**（HIR/SSA） | 过近似 | 过近似（仅 AST 级） |
| API URL 识别 | 不识别 | 可识别 | **可识别** |
| Store 绕路 | 不追踪 | 可静态追踪部分 | 可静态＋运行时 |
| 工业成熟度 | 实验性 | 成熟 | **成熟** |
| 可复用性 | 无公开 API | 可写 query | **直接编译** |

**判定：Babel 插桩在工程可行性上明显优于其他编译器路径。React Compiler 在分析精度上有理论优势，但没有公开 API。** 建议路径：当前用 Babel 插桩，等 React Compiler API 公开后迁移。

---

## 4. 安全分析领域

### 4.1 引擎级值污点追踪 —— Project Foxhound（SAP）

#### 4.1.1 它证明了什么

Project Foxhound 是 SAP 维护的 Firefox 分支，在 SpiderMonkey 引擎中给每个 `JSString` 嵌入了 `StringTaint` 数据结构。taint 标记在字符串的每个操作（`+`、`.slice`、`.trim()` 等）中**自动传播**。当 taint 到达 sink（如 `innerHTML`、`eval`）时，触发 `__taintreport` 事件，其中包含**完整的传播路径**。

**这是对"值级溯源是否可能"的正面回答——答案是"可能，在引擎级"。**

#### 4.1.2 对本问题的理想适用性

如果 Foxhound 可以直接用：

```
1. 在每个 fetch 响应数据到达时标记为 tainted_by_/api/user
2. 数据经过任何 transform（map/filter/格式化）→ taint 自动传播
3. 最终写入 div.textContent → 触发 taint report
4. report 包含：这个 DOM 节点的 textContent 的 taint 来源是 /api/user
5. 精确到字符位置（string taint 按字符索引标记）
```

**这将是本问题的最优解——100% 精确、0 假阳性/假阴性、不挑代码写法。**

#### 4.1.3 但工程上不可行

| 障碍 | 严重度 |
|------|--------|
| **需要定制浏览器分发**（Firefox 私叉） | 致命 |
| **只标记字符串，不标记 number** | 中——number 值（如订单数量、价格）的 taint 会丢失 |
| **JSON.parse 保留 taint 需要改造 JSON parser** | 中 |
| **Object property 不携带 label**——`obj.newProp = taintedStr` 后，读 `obj.newProp` 仍能看到 taint（因为值是 JSString），但通过 `Object.keys` 枚举时不可见 | 低 |
| **跨 realm（iframe/Worker）的 taint 传播需额外处理** | 低 |
| **性能降级 1.4x 吞吐**（vs 不插桩的 Firefox 大约 4-8x 降级 from JS engine overhead） | 高——baking 阶段可接受 |
| **只能跑在 Firefox**，而大部分开发者的 baking 工具（Puppeteer/Playwright）用 Chromium | 中 |

#### 4.1.4 核心借鉴

Foxhound 证明了：**引擎级值追踪是精确可行的。** 如果 Chromium 团队提供一个类似的 `--enable-taint-tracking` flag（哪怕是 dev-only），整个问题就是一行代码调用。**这是应该推动的方向——给 Chromium 提 feature request 或在 W3C/WebPerf WG 提议。**

**评分**：

| 精确度 | 覆盖率 | 侵入性 | 性能 | 工程 | 可落地 | 未来 |
|--------|--------|--------|------|------|--------|------|
| 5（值级精确） | 4（只缺 number） | 5（对源码） | 2（1.4x） | 1（需引擎 fork） | 0 | 3 |

**判定：梦想方案。给 Chromium 提 feature request 的价值（即便是 dev-only flag），但不作为当前工程路径。**

### 4.2 动态污点分析（Jalangi2）

#### 4.2.1 机制

Jalangi2 是 Samsung 维护的 JS 动态分析框架。它对每个 JS 操作进行**运行时插桩**——在 `+`、`.`、`=` 等操作前后插入回调。分析员写回调函数来追踪值的传播：

```js
// Jalangi2 分析示例（伪代码）
J$.analysis = {
  binary: function(iid, op, left, right, result) {
    // 当 left 或 right 是 tainted 时，result 也 tainted
    if (J$.tainted[left] || J$.tainted[right]) {
      J$.tainted[result] = combineLabels(J$.tainted[left], J$.tainted[right])
    }
  }
}
```

#### 4.2.2 为什么不能用

| 障碍 | 详情 |
|------|------|
| **性能毁灭** | 每个 JS 操作都插入回调 → **30-100x 慢**。即使只在 baking 用，运行页面可能需要几分钟而非几秒 |
| **ES5 仅实验支持** | 官方"ES5.1 only, some ES6 may work"——现代 JS（ES6+）的核心特性（箭头函数参数、解构、模板字符串、class、generator、async/await）均未测试 |
| **不覆盖 node_modules** | 默认只插桩项目源码——但 React/React Query/Zustand 的数据流传递是通过 node_modules 实现的 |
| **Object property 的 taint 传播需要手动写规则** | 工作量巨大 |

**评分**：

| 精确度 | 覆盖率 | 侵入性 | 性能 | 工程 | 可落地 | 未来 |
|--------|--------|--------|------|------|--------|------|
| 4（操作级） | 2（ES5/no node_modules） | 5 | 0（30-100x） | 1 | 0 | 0 |

**判定：否决。** 即使只在 dev/baking 用，ES5 限制和 30-100x 性能下降不可接受。

### 4.3 信息流控制（IFC）—— Denning 格模型

**理论**：Denning (1976) 的信息流控制：每个值有安全标签（如 `secret`, `public`），标签按格（lattice）规则传播。格定义了"信息从低到高允许流，从高到低阻止"。

**为什么在前端 JS 中不能 sound**：
1. **隐式流（implicit flow）**：`if (secret === 'admin') { div.text = 'hello' }` —— `div.text` 的值"hello"不携带 `secret` 标签（因为不是直接赋值），但它**泄露了** `secret` 的信息。动态 IFC 需要在每个分支点监控"条件依赖的标签"——在 JS 中，这意味着每个 `if`、`switch`、`?:`、`&&`、`||`、`for`、`while` 都需插桩。
2. **原型链污染**：`Object.prototype[taintedKey] = value` —— 标签传播到所有对象。
3. **eval**：动态代码的标签不可静态推理。

**判定**：理论上优美——格模型的"标签沿格传播"与我们的"接口标签沿数据流传播"同构。但工程上无 browser 内建 IFC 机制。学术参考价值。不纳入工程路径。

---

## 5. 软件测试领域

### 5.1 差分测试 / 变异测试 —— 这在实现文档中已经是最优兜底方案

**核心改进 vs 实现文档**：

除了 "拦截 API → 对比 DOM 指纹"，还有两个重要变体在测试领域被研究：

#### 5.1.1 快照差分（Snapshot Differencing）

类似 Percy / Chromatic，但方向相反：不比较不同版本，而是比较"同一版本、不同数据"的渲染结果。

**Percy 的反向使用**：Percy 的 diff 引擎（基于 pixelmatch + DOM snapshot 对比）可以用来检测：
```
正常渲染的组件 snapshot vs 拦截 API A 后的 snapshot → diff 比例
```

如果 diff 在某区域 > 阈值，则标记该区域依赖此 API。

**Percy 的反向使用的缺点**：Percy 是 SaaS 服务，本地 CI 调用 API 慢且有调用次数限制。不适合作为主干，但作为手动验证工具很好。

#### 5.1.2 可复现渲染（Reproducible Rendering）

测试领域的"确定性渲染"：固定 `Math.random()`、`Date.now()`、`requestAnimationFrame`、CSS Animation。确保两次页面加载除了"某个 API 被拦截"外无其他变量。

**Chrome 的 `--deterministic-mode` flag**（实验性）：

```
chrome --headless --deterministic-mode
→ Math.random() 固定 seed
→ Date.now() 从固定 epoch 开始计时
→ crypto.getRandomValues() 使用固定 seed
→ 所有异步调度使用固定优先级
```

这对差分测试是**革命性改进**——消除了所有的非确定性噪声源。目前 Chrome 的这个 flag 只在特定版本可用。

**评分**（更新后，考虑了确定性渲染）：

| 精确度 | 覆盖率 | 侵入性 | 性能 | 工程 | 可落地 | 未来 |
|--------|--------|--------|------|------|--------|------|
| 4 | 5 | 5 | 3 | 5 | 4 | 5 |

**判定：已经是最好的兜底方案。确定性渲染 flag 可大幅提升精确度。O(N) 页面加载在 CI 中完全可接受。**

### 5.2 反例：纯时间窗口绑定的正式推翻

**来自数据库隔离理论**：

前端接口和 DOM 的关系可以用数据库的**读-写依赖**建模：
```
fetch 请求 = 读事务（从后端"读"数据）
DOM mutation = 写事务（"写"到屏幕）
```

在数据库中，读-写依赖的判定标准是**可串行化（serializability）**：如果事务 A 读的数据后来被事务 B 写，则 A 依赖 B 的前一个版本。反例：
```
时间线：
t=0ms:   fetch('/api/orders') 发起
t=100ms: fetch('/api/user') 发起
t=200ms: /api/user 响应到达，setState → DOM 变化
t=300ms: /api/orders 响应到达，setState → DOM 变化
此时时间窗口 ((200ms, 350ms) 内有两个接口响应先后到达，
        把 DOM 变化归因到时间窗口内唯一的请求是不可靠的
```

如果在中间插入网络抖动：
```
t=0ms:   fetch('/api/orders') 发起
t=100ms: fetch('/api/user') 发起
t=500ms: /api/user 响应到达（后端很慢）
t=510ms: setState → DOM 变化
此时如果时间窗口是 (0, 600ms)，则变化被归因到 "两个接口一起"
而不是"只有 /api/user"
```

**数据库的解法**：用**锁或时间戳**来判定依赖。在前端中，锁等价于 Mutex/semaphore；时间戳等价于 reqId/traceId。时间窗口本质上是不精确的版本号。

**判定**：时间窗口方案对应数据库隔离理论中的**最低隔离级别（Read Uncommitted）**——可能错。需要真正的 traceId 才能达到**快照隔离**。

---

## 6. 响应式编程领域

### 6.1 信号/响应式系统的依赖图

MobX、SolidJS、Vue Composition API、Svelte 的共同机制：

```
运行时：
1. 读取 observable → 自动调用 getter → 记录"当前正在执行的 derivation 依赖这个 observable"
2. 写入 observable → 自动调用 setter → 通知所有订阅的 derivation 重新计算

所以每个 derivation 都知道"我依赖哪些 observable"
```

**直接映射**：如果 API 响应数据存储为 observable，组件渲染作为 derivation，那么运行时已经建立了 `observable → component → DOM` 的依赖图。完全精确、自动！

**但要求**：所有数据流经 observable。裸 `fetch + useState(const [data, setData] = useState())` 不在依赖图中。

### 6.2 为什么当前不用这个路径

React 的 `useState` 不是 observable 模型——它没有 getter/setter 自动订阅。React 是 push-based batch update：setState 后批量 re-render，不追踪"这个 re-render 具体是因为哪个值变了"。

但有一个方向值得关注：**React Forget（React Compiler 的 memoization）内部依赖追踪可以用作此目的。** 如果 React Compiler 开放 API，就能知道每个组件的哪次 re-render 是由哪个值的变化触发的。

**评分**：

| 精确度 | 覆盖率 | 侵入性 | 性能 | 工程 | 可落地 | 未来 |
|--------|--------|--------|------|------|--------|------|
| 5 | 3（仅 observable 项目） | 3（需改数据层） | 5 | 4 | 3 | 4 |

**判定**：如果项目恰好全面用了 MobX/Solid/Vue，天然就是最优解。但对"任意 React 项目"不作假设。

---

## 7. 浏览器原生能力领域

### 7.1 CDP（Chrome DevTools Protocol）的能力与边界

| 能力 | API | 可以做 | 不能做 |
|------|-----|--------|--------|
| 拦截请求 | `Network.requestWillBeSent` | 知道每个请求的 URL + 时间 + 请求头 | 不知道这个请求响应后会用在哪个 DOM 上 |
| 修改响应 | `Network.requestIntercepted` | 在 baking 中注入 traceId 到响应体 | 生产不可用 |
| DOM 快照 | `DOM.getDocument` | 获取完整 DOM 序列化 | 快照不反映"DOM 和请求的关系" |
| 异步栈追踪 | `Debugger.setAsyncCallStackDepth` | **连接 async 链：fetch → .then → ... → setState** | **只能读栈，不能写自定义数据到栈上** |
| 性能追踪 | `Performance.getMetrics` | 收集性能数据 | 粒度不够（不追踪数据流） |
| JS 覆盖率 | `Profiler.startPreciseCoverage` | 知道哪段代码被执行了 | 不追踪数据 |

**关键发现：CDP 的异步栈不能"写"。** CDP 可以告诉你"fetch 的回调链上发生了 setState"，但它不能在栈上附加"这是来自 `/api/user` 的栈"的标记。

**这意味着**：
- CDP 可以告诉你"过去的一帧中，setState 是由某个 async 链触发的"
- 但 CDP 不能区分"这个 async 链来自 `/api/user` 还是 `/api/orders`"
- 除非你在发起 fetch 时，把 URL 信息编码进某个 CDP 能读到的地方（如函数的 name→临时重命名、在栈上赋一个特殊值等 hack）

**更新：此问题解决方案**

实现文档中提出用"闭包保留变量"——这在 CDP 的 async stack 视角下仍然有效：因为 CDP 能看到调用栈中的局部变量。**如果 `__trackStart('/api/user')` 返回的 reqId 被闭包捕获，CDP 就能在 async stack 的栈帧中看到闭包变量。**

### 7.2 Long Animation Frames API（LoAF）

```js
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    for (const script of entry.scripts) {
      console.log(script.sourceURL, script.sourceFunctionName)
      // → 能定位到"哪段代码引起了长帧"
    }
  }
})
observer.observe({ type: 'long-animation-frame', buffered: true })
```

**价值**：能精确归因"哪段代码引起渲染"，粒度为函数名+URL+位置。

**局限**：
- **只在长帧触发**（> 50ms），短帧不记录
- 粒度是**函数**不是**数据**——知道 `handleResponse` 引起了长帧，但不知道 handleResponse 处理的是哪个 API 的数据
- 生产不可用（只触发长帧）
- 仅 Chromium

**判定**：低价值。在 baking 场景中，不如 Babel 插桩直接。

### 7.3 Performance API + Resource Timing

```js
performance.getEntriesByType('resource')
  .filter(e => e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest')
  .map(e => ({ url: e.name, startTime: e.startTime, responseTime: e.responseEnd }))
```

能拿到所有 HTTP 请求的 URL 和时序——但与 DOM 变化的关联仍是时间窗口级，不可靠。

### 7.4 `--disable-background-timer-throttling` 等 Chromium flags

对 baking 有用的 flags：

| Flag | 效果 |
|------|------|
| `--disable-background-timer-throttling` | setTimeout 不延迟（后台 tab 超时排队） |
| `--disable-renderer-backgrounding` | 渲染不暂停 |
| `--deterministic-mode` | 确定性渲染（实验性） |
| `--disable-animations` | 关闭所有 CSS 动画 |
| `--force-device-scale-factor=1` | 固定 DPR |

---

## 8. 录制/回放领域

### 8.1 Replay.io 引擎

Replay.io 记录了整个浏览器进程的系统调用——包括网络包、GC、事件循环 tick。重放时可以添加断点、console.log。

对本问题的价值：
- 录制一次完整加载 → 在重放时在 fetch 回调中加 traceId 标记 → 事后关联

**不纳入当前方案**：需要整个 Replay 基础设施，太重。

### 8.2 rrweb

rrweb 录制 DOM 快照+增量 mutation。对本问题的价值：回放 DOM 变化序列 → 与 network log 做时间关联。但仍是时间窗口级，不可靠。

### 8.3 时间旅行调试（Redux DevTools / React DevTools）

Redux DevTools 记录了所有 action + state 变化——天然知道"哪个 action 引发了哪个 state 变化"。如果 action 包含 API 来源信息，就能关联。

**局限**：只覆盖 Redux state。不是所有前端项目都用 Redux。

---

## 9. 综合评分矩阵（所有领域 × 7 维度）

| # | 方案 | 精确度 | 覆盖率 | 侵入性 | 性能 | 工程 | 可落地 | 未来 | **综合** |
|---|------|--------|--------|--------|------|------|--------|------|----------|
| 1 | **引擎级值污点（Foxhound）** | 5 | 4 | 5 | 2 | 1 | 0 | 3 | 20 |
| 2 | **AsyncContext.Variable（已 ship）** | 5 | 5 | 5 | 5 | 5 | 5 | 5 | **35** ✦ |
| 3 | **Babel 插桩 + 闭包保留（当前方案）** | 4 | 4 | 4 | 4 | 4 | 4 | 3 | **27** ✦ |
| 4 | 差分测试（确定性渲染） | 4 | 5 | 5 | 3 | 5 | 4 | 5 | **31** |
| 5 | React Compiler HIR | 4 | 3 | 5 | 4 | 1 | 2 | 5 | 24 |
| 6 | 响应式信号（MobX/Solid） | 5 | 3 | 3 | 5 | 4 | 3 | 4 | 27 |
| 7 | CDP async stack | 3 | 3 | 5 | 4 | 3 | 4 | 5 | 27 |
| 8 | 静态程序切片（CodeQL/WALA） | 2 | 4 | 5 | 3 | 1 | 2 | 3 | 20 |
| 9 | OT traceId + 引擎传播 | 4 | 4 | 4 | 4 | 3 | 2 | 5 | 26 |
| 10 | 数据库 provenance semiring | 4 | 2 | 5 | 5 | 1 | 1 | 2 | 20 |
| 11 | 信息流控制格模型（IFC） | 4 | 2 | 5 | 3 | 0 | 0 | 1 | 15 |
| 12 | Jalangi2 操作级污点 | 4 | 2 | 5 | 0 | 1 | 0 | 0 | 12 |
| 13 | 录制回放（Replay.io） | 3 | 4 | 5 | 3 | 1 | 2 | 4 | 22 |
| 14 | Playwright 时间窗口 | 1 | 3 | 5 | 4 | 5 | 5 | 2 | 25 |
| 15 | LoAF/LongTask API | 2 | 1 | 5 | 5 | 5 | 4 | 3 | 25 |
| 16 | React fiber commit 归因（react-scan） | 3 | 2 | 4 | 4 | 4 | 4 | 4 | 25 |
| 17 | Babel 静态分析（不插桩） | 3 | 3 | 5 | 5 | 4 | 5 | 3 | 28 |
| 18 | 纯差分测试（无确定性渲染） | 3 | 5 | 5 | 3 | 5 | 5 | 3 | 29 |

✦ = 当前工程首选

---

## 10. 被否决但曾被寄予厚望的方向（诚实复盘）

### 10.1 纯 CDP 异步栈作为传播主干 —— 为什么不行

**误解**："CDP 能跟踪 async stack → CDP 能传播 traceId"

**事实**：CDP 的 `Debugger.setAsyncCallStackDepth` 只填充 async stack trace 的**栈帧信息**（函数名、文件、行列号）。它**不包含自定义数据**。你可以看到 "fetch → UserCard → setState" 这条链上的**函数名**，但看不到 `/api/user` 和 `/api/orders` 的区别。

**关键反击**："那我能不能在栈上放一个局部变量，CDP 在断点时读到它？"

技术上可行但需要**在每个可能的 setState 处下断点**——这等于调试所有 setState，对 baking 自动化的影响：Puppeteer 需要在每个 `setState` 处 `Debugger.pause` → 读调用栈中的局部变量 → 继续。慢 100x，且要求所有 setState 在同步栈上。

### 10.2 纯 MutationObserver —— 为什么是死路

已在上一个 research doc 中确认——W3C 规范 `MutationRecord` 不含因果信息。

### 10.3 纯 Userland Proxy —— 为什么是死路

```
const d = new Proxy({ name: 'Alice' }, handler)
const d2 = { ...d }             // d2 是普通对象，Proxy 丢失
const d3 = JSON.parse(JSON.stringify(d))  // d3 是普通对象
```

JS 的解构、扩展和 JSON 序列化破坏 Proxy 身份——而这些都是前端代码中最常见的模式。

---

## 11. 关键结论

### 11.1 最优方案就是 Babel 插桩，没有银弹

**经过 10+ 个领域的完整扫描，没有发现比"Babel 插桩（利用闭包保留变量）+ 差分测试兜底"更优的工程方案。**

原因：
1. **更优的方案都有致命缺陷**：Foxhound 要改引擎、Jalangi2 不可接受慢、IFC 无实现、Replay.io 太重
2. **更优的方案还没 shipping**：AsyncContext、React Compiler API、确定性渲染 flag
3. **Babel 插桩的方案刚好站在工程可行性的 Pareto 前沿上**：成本可接受、覆盖 90%+、当前可落地

### 11.2 方案不是一成不变的，要设计迁移路径

```
2026（当前）: Babel 插桩（利用闭包保留变量） + 差分测试
2027（乐观）: 迁移至 AsyncContext.Variable → 删除 Babel 插桩代码
            → 保留 RequestTracker 数据结构
            → 传播层从 Babel 插桩 → AsyncContext 天然传播
2028（乐观）: React Compiler API 可用 → 静态分析精度大幅提升
            → 覆盖 store 绕路和复杂 transform
            → Babel 插桩仅需处理 React Compiler 不覆盖的边缘场景
```

### 11.3 应该推动的外部变化

| 推动事项 | 目标 | 如果落地会怎样 |
|----------|------|---------------|
| **Chromium feature request: `--taint-tracking` flag** | 给 JSString 嵌 taint（类似 Foxhound），但只在 dev flag 下 | 整个问题变成一行代码调用 |
| **Chromium `--deterministic-mode` 正式 support** | 消除差分测试的非确定性噪声 | 差分测试从 95% 精确 → 99.9% 精确 |
| **TC39 AsyncContext 推进** | 尽快 Stage 3 → shipping | 消除传播层所有 hack |
| **React Compiler 公开 API** | 允许第三方读 HIR/ReactiveScope 信息 | 静态分析从 ~70% 覆盖 → ~95% 覆盖 |

### 11.4 方案的核心定理

**这个问题的上限由 JavaScript 语言本身决定：**

```
1. 你无法在 userland 给 string/number 附加元数据
   → 值级追踪不可行

2. 你无法在 userland 可靠地追踪 async 上下文
   → 执行上下文追踪需要引擎支持

3. 但你可以利用闭包保留变量 + 编译期注入追踪代码
   → Babel 插桩是当前 userland 能做到的最好

4. 你可以在黑盒层面拦截输入观察输出
   → 差分测试是兜底的最终验证

5. 引擎级的能力可以解决 1 和 2，但不能依赖
   → 等待 AsyncContext + 推动 Chromium taint tracking
```

---

## 12. 与现有文档的关系

| 文档 | 本文的增量贡献 |
|------|--------------|
| [api-dom-binding-research.md](./api-dom-binding-research.md) | 本文对 CDP async stack、AsyncContext、Foxhound 的实际能力做了代码级的验证分析，明确了它们能做什么、不能做什么 |
| [api-dom-binding-solution.md](./api-dom-binding-solution.md) | 本文对方案中的"闭包保留变量"核心机制做了跨领域的理论验证（数据库 provenance、IFC 格模型、安全分析等都证实这是正确方向） |
| [api-dom-binding-implementation.md](./api-dom-binding-implementation.md) | 本文为实施文档中的每个层级找到了领域背书，并为未来迁移路径做了明确的"when/then"决策 |

---

## 13. 参考来源

- [Project Foxhound (SAP)](https://github.com/SAP/project-foxhound) — SpiderMonkey 引擎级 string taint
- [Jalangi2 (Samsung)](https://github.com/Samsung/jalangi2) — JavaScript 动态分析框架
- [React Compiler Design Goals](https://github.com/facebook/react/blob/main/compiler/docs/DESIGN_GOALS.md) — HIR/SSA/ReactiveScope
- [TC39 AsyncContext Proposal](https://github.com/tc39/proposal-async-context) — Stage 2.7
- [TC39 Signals Proposal](https://github.com/tc39/proposal-signals) — Stage 1
- [CodeQL JavaScript Analysis](https://codeql.github.com/docs/codeql-language-guides/codeql-library-for-javascript/) — 静态数据流
- [WALA Framework](https://github.com/wala/WALA) — Anderson 式 JS 指针分析
- [OpenTelemetry JS](https://github.com/open-telemetry/opentelemetry-js) — Browser SDK
- [Replay.io](https://www.replay.io/) — 浏览器录制回放引擎
- [Green et al. 2007 - Provenance Semirings](https://www.cs.ucdavis.edu/~green/papers/pods07.pdf)
- [Denning 1976 - Information Flow Control](https://www.cs.purdue.edu/homes/ninghui/readings/InfoFlow/denning76.pdf)
- [K8s Span Links KEP #5915](https://github.com/kubernetes/enhancements/issues/5915)
- [CDP Debugger Domain](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/)
- [LoAF / PerformanceLongAnimationFrameTiming (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming)
- [react-scan instrumentation.ts](https://github.com/aidenybai/react-scan/blob/main/packages/scan/src/core/instrumentation.ts)
- [Angular zone.js vs async/await (Issue #31730)](https://github.com/angular/angular/issues/31730)