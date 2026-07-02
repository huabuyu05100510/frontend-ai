# API ↔ DOM 绑定关系:跨领域调研

> 目标:精确得到"被包裹的某块 DOM 依赖哪些接口"。本文件汇总十几个领域的成熟范式,评估能否用到本问题,并给出综合最优解。
> 关联:[skeleton-build-pipeline-design.md](./skeleton-build-pipeline-design.md) §5、[skeleton-architecture-design.md](./skeleton-architecture-design.md)。
> 日期:2026-06-29。

---

## 0. 问题精确定义

> **给定一块被 `<Skeleton>` 包裹的 DOM 区域 X,精确求出:渲染 X 所需的数据来自哪些接口请求 K₁…Kₙ。**

要点:
- 是 **接口↔DOM 的数据血缘**(值级 provenance),**不是**"哪段代码改了 DOM"(代码级因果)。两者不同。
- 中间数据可能经任意 transform(normalize / map / 格式化)、绕路(全局 store / Context / HOC 注入)、并发。
- 老项目裸 `fetch + useState` 要适用,不限制写法。

---

## 1. 跨领域范式总览

### A. 信息流 / 血缘类(追"值"的来源)

| # | 范式 | 领域 | 精确性前提 | 适用到本问题 |
|---|------|------|------------|--------------|
| 1 | **数据库 provenance**(where/why/how,semiring 多项式,Green 2007) | 数据库 | 关系算子封闭集 | 思路对,但前端数据流不是封闭算子集 |
| 2 | **数据血缘**(OpenLineage / Spark lineage) | ETL | 管道是显式 DAG | 偏离场景 |
| 3 | **引擎级值污点**([Project Foxhound](https://github.com/SAP/project-foxhound),SpiderMonkey 给 JSString 嵌 taint,穿 transform、带 flow 历史) | 浏览器安全 | 引擎改造 + 字符串为主 | **学术验证**:证明引擎级值级溯源在理论上是可行的;但需定制 SpiderMonkey/Firefox,无可用分发 → **不纳入工程方案** |
| 4 | **静态后向切片 / 污点**(CodeQL / Joern,PDG/SDG 图可达) | 安全 SAST | 语言可分析 | 过近似(误报)+ 漏动态;React Compiler 可作基座 |
| 5 | **React Compiler HIR/SSA**([facebook/react/compiler](https://github.com/facebook/react/blob/main/compiler/docs/DESIGN_GOALS.md)) | 编译器 | React 规则 | 基座现成、精确推导"JSX 依赖哪些值";漏 store/Context/动态 URL |

### B. 执行追踪类(追"动作"的因果)

| # | 范式 | 领域 | 核心机制 | 适用到本问题 |
|---|------|------|----------|--------------|
| 6 | **分布式追踪**(OpenTelemetry,trace context 注入/提取 + span parent-child + Span Links) | 微服务 | traceId 沿请求链传播 | **★ 直接可用**:请求=span,commit=子 span,traceId 串因果。**正解主干** |
| 7 | **事件溯源 / Temporal Tables** | 数据库/审计 | 存事件序列/时点重建 | 偏离(我们不是审计) |
| 8 | **增量计算**(Salsa / Adapton / SAC,DDG/MDDG) | PL | 运行时记"读了哪些输入" | 需数据过被记录的 thunk,老项目裸 fetch 不满足 |
| 9 | **响应式信号**(Solid / MobX / Angular / TC39 proposal-signals) | 前端 | "当前订阅者"全局 + getter 登记 | 要数据访问过 getter 关卡 |
| 10 | **React fiber commit 归因**(react-scan / bippy,onCommitFiberRoot + getMutatedHostFibers) | 前端调试 | 哪段代码引起 commit | 精确,但是"代码↔DOM"非"接口↔DOM";可作 DOM 侧落点 |
| 11 | **LoAF / LongTask API**(浏览器原生) | 性能 | 归因到脚本 URL/函数/字符位置 | **新发现**:浏览器能精确归因脚本来源;但只对长帧触发,粒度是脚本不是请求 |

### C. 对照(已被证失败的路)

| # | 范式 | 失败原因 |
|---|------|----------|
| 12 | **userland Proxy 污点** | 数据经 spread/map/JSON.parse 后身份丢失 |
| 13 | **MutationObserver** | `MutationRecord` **不含"谁改的"**(W3C 官方确认),只能靠 DOM 断点(手动)或异步栈(需 DevTools) |
| 14 | **Zone.js userland async** | `async/await` 绕过 userland promise(Angular 官方确认不可 patch);要降级 async→promise(Angular CLI 做法) |

> **扩展调研见 §8**。§8–§12 深入安全、测试、PL 领域,新增 CDP async stack、AsyncContext、IFC、动态污点分析、差分测试等 10+ 范式,并给出最终的可行性结论与更新后的方案层次。

---

## 2. 两条被官方确认的硬事实(决定可行性边界)

1. **`MutationObserver` 不带因果**。W3C 规范与 StackOverflow 高票答案一致:"It doesn't provide information about how those changes were effected." → 纯 MO 判不出"哪个请求导致这块 DOM 变",这条路死。
2. **react-scan/bippy 能精确拿到"哪次 commit 由哪段代码引起"**(`getMutatedHostFibers` + `changes: [FunctionalState...]`)。→ 运行时归因有可靠基座,但它是**代码↔DOM**,需配合 traceId 才能升级到**接口↔DOM**。

---

## 3. 关键新发现:OpenTelemetry 式 trace 传播 = 正解主干

OT 的核心:**给请求一个 traceId,沿调用链注入/提取,所有下游副作用都带 traceId,按 traceId 聚合 = 因果链。** 跨进程、跨异步、跨消息队列都成立(K8s 用 Span Links 处理解耦异步)。

**映射到本问题(前端内的分布式追踪):**

```
fetch('/api/user') → 发 traceId = T_user
  ↓ patch Promise.then / React dispatcher / setState:把 T_user 沿执行链传播
  ↓ (async/await 用 V8 PromiseHook 或 dev 期 async→promise 降级,绕过 userland 限制)
setState(data) 带 T_user → React commit 带 T_user
被包子树的 host fiber 变化 → 带 T_user → 绑定 子树 ⇐ /api/user
```

- 不追值(避开 Proxy 失败)、不追代码(避开 MO 失败),**追 traceId(请求身份)沿执行链传播**。
- **transform 免疫**(不碰值)、**绕路免疫**(只要 setState/commit 带 traceId,经 store/Context 也能跟)、**并发免疫**(每请求独立 traceId)。
- async/await 硬限用 **V8 PromiseHook(引擎级)** 或 **dev 期 async→promise 降级(Angular CLI 同款)** 解决 —— 这正是 OT 在 Node 侧已经做的事(`async_hooks` 建在 PromiseHook 上)。

---

## 4. 综合最优解:多范式融合

**单一范式都有洞;它们的洞互不重叠,合起来覆盖最广。**

```
主干:分布式追踪(traceId 沿执行链传播)
   ├─ 请求侧:page.route() 或 CDP Network.requestIntercepted 注入 traceId
   ├─ 传播侧:CDP async stack(V8 PromiseHook 引擎级,不需降级 async/await)
   │          中期迁移:浏览器 AsyncContext.Variable(Stage 2.7,Chrome Canary 已实现)
   ├─ DOM 侧落点:react-scan onCommitFiberRoot + getMutatedHostFibers
   │           (本次 commit 改了哪些 host fiber + 当前 async stack 上的 traceId)
   └─ 被包子树 host fiber 出现某 traceId → 绑定 子树 ⇐ 接口
补角:值污点追踪(学术验证:Project Foxhound 证明引擎级值级溯源理论可行;工程上暂无可用实现)
补角:静态后向切片+Babel/React Compiler HIR 预标注(编译期 tag + 运行时 traceId 验活)
烘焙:Puppeteer/CDP headless 录制 + 绑定计算 → 静态绑定地图 (JSON)
生产:轻量揭示(只读烘焙结果,不再做追踪)
验证:差分测试(differential testing)——拦截绑定地图声明的接口,对比 DOM 快照,正确性复核
```

**每个部件都有成熟领域背书**,且**它们的洞互不重叠**。

---

## 5. 精确度分级(诚实)

| 场景 | 精确度 | 依赖的部件 |
|------|--------|-----------|
| RQ/SWR + `.then` 直链 | **精确** | traceId + commit 落点 |
| RQ/SWR + async/await(降级后) | **精确** | 同上 + async 降级 |
| 裸 fetch + `.then(setState)` | **精确** | traceId + commit 落点 |
| 裸 fetch + async/await + 并发(降级后) | **精确** | 同上 |
| 数据经 store / Context 绕路 | **精确**(只要 setState/commit 带 traceId) | traceId 传播 |
| 裸 fetch + async/await(未降级) | 退化(userland 异步栈断) | 需 CDP 或降级修 |
| WS / SSE / 轮询 | 无清晰"完成"语义 | 专门策略或排除 |
| 纯本地 state / 用户输入驱动(无请求) | 不绑(本就不该骨架化) | — |
| 第三方库内部取数(node_modules) | traceId 仍能抓 URL;但库内部分支不可见 | traceId + 标记 |

---

## 6. 诚实边界(不可消灭,但比任何单一范式都小)

1. **浏览器运行时无 PromiseHook**(只有 Node/SSR 侧有)→ 浏览器 dev 靠 CDP 异步栈或 dev 期 async→promise 降级;**生产无引擎 hack → 生产用烘焙结果**。
2. **WS/SSE/轮询** 无"请求完成"语义 → 专门策略或排除。
3. **纯本地 state / 用户输入驱动**(无请求)→ 不绑(本来也不该骨架化)。
4. **引擎/CDP 是 dev-only**;生产靠烘焙的 `框→接口集`。
5. **async/await userland 异步栈断** 是语言级事实(Angular/Zone 已证),只能靠引擎级(PromiseHook)或 dev 降级修,不是 userland 能解。

---

## 7. 与既有讨论的关系

- 本调研**否决**了:纯 userland Proxy、纯 MutationObserver、纯静态切片单独使用、纯运行时启发式、纯时序窗口绑定(HAR-based)、Jalangi2 操作级插桩(性能不可接受),以及差分测试作为主干(耗时爆炸、组合效应漏)。
- 本调研**采纳并融合**:分布式追踪(traceId 主干)+ CDP async stack(V8 引擎级,消除 async 降级需求)+ Babel/React Compiler HIR 预标注(编译期 tag)+ react-scan commit 归因为 DOM 落点 + 差分测试作为正确性复核。
- 本调研**关注中期利好**:TC39 AsyncContext.Variable(Stage 2.7)落地后将大幅简化传播层。
- **核心判据**(更新后):**CDP async stack 将 fetch 与 setState 连成因果链,traceId 出现在被包子树的 host fiber commit 里 = 绑定。** 比原方案更直接,因 CDP 引擎级异步追踪消除了 userland 异步传播的所有不确定性。

---

## 8. 扩展调研:安全、测试、PL 与更多领域

> 本节是对 §1 的补充,按领域逐一评估新增范式,并给出与主干方案的融合/否决判据。

---

### 9. 安全领域

#### 9.1 动态污点分析引擎 (Jalangi2 / Aran)

| 维度 | 内容 |
|------|------|
| **机制** | Jalangi2 对 JavaScript 做源码级插桩,在每个操作(读/写/运算/调用)前后插入回调,对值标注污点标签(taint label)。Aran 是 Jalangi2 的下一代,更侧重影子值(shadow value)语义。 |
| **能做什么** | 可以从 `fetch` 响应体提取字符串→打污点→跟踪经 `+`、`.slice`、模板字符串等操作→最终写入 `textContent`/`innerHTML` 时检测到污点传播。能覆盖 Proxy 方案丢失的 identity 问题,因为是基于操作的影子值追踪。 |
| **为什么不能用** | **(1) 性能毁灭级**:每个 JS 操作都插入函数调用,慢 30-100x,生产不可用。**(2) 字符串覆盖不全**:Object property、number 传播、经过 JSON.parse 的字符串等,非字符串值丢失标签。**(3) 只覆盖 instrumented code**:node_modules 默认不插桩,库内部变换断链。 |
| **判据** | **否决作为主干**。但在 dev 工具链中,对关键路径(已知的 fetch→setState 段)做轻量插桩可作为补角参考。 |

#### 9.2 信息流控制 (IFC: Information Flow Control)

| 维度 | 内容 |
|------|------|
| **机制** | IFC 是安全领域经典理论(Denning 1976):给每个值贴安全标签(如 `secret`, `public`),在整个程序执行中按格(lattice)规则传播。有静态 IFC(FlowCaml, JFlow)、动态 IFC 和混合 IFC(HLIO)。 |
| **映射** | 把接口返回的数据贴 `tainted_by_K1`,沿着执行每条指令传播,最终在 DOM mutation 点读到标签集 → 即 K1...Kn。 |
| **为什么不能用** | **(1) 静态 IFC** 在 JavaScript 上做不到 sound:动态属性访问、eval、原型链修改。**(2) 动态 IFC** 需要引擎级支持(类似 Foxhound),无现成浏览器实现。**(3) 隐式流(implicit flow)**:`if (secret) { div.text = "a" }` 理论上也是信息泄露——这对我们的场景反而是要精确绑定的信号,但纯 IFC 会把条件分支也计入。 |
| **判据** | **理论优美,无工程路径**。但 IFC 的格模型(lattice)可作为"接口标签传播"的数学基础,证明 traceId 方案的 soundness。 |

#### 9.3 浏览器 XSS 过滤 / CSP 报告

| 维度 | 内容 |
|------|------|
| **机制** | CSP `report-uri` + Trusted Types + Sanitizer API。浏览器已有的安全边界监控。 |
| **为什么不能用** | 粒度是"脚本来源",不是"接口请求"。完全不适用。 |

---

### 10. 测试 / 调试领域

#### 10.1 CDP 异步栈追踪 (Async Stack Tagging)

| 维度 | 内容 |
|------|------|
| **机制** | Chrome DevTools Protocol (CDP) 的 `Debugger` 域支持 **async stack trace**(`Debugger.setAsyncCallStackDepth`)。V8 引擎对 `Promise.then`、`async/await` 和 `setTimeout` 内置异步调用链记录。当你在 console 看到 async stack trace 时,就是靠 V8 引擎级的 `PromiseHook` 把 `.then` 的调用者栈保留下来的。 |
| **为什么关键** | CDP async stack 是**引擎级**能力,**Zone.js 做不到的 async/await 这里能做到**——因为这不是 userland patch,是 V8 在创建 Promise 时就把闭包/调用帧关联上了。 |
| **直接可用性** | 从 CDP 侧拦截:发起请求→异步链上所有 `.then` / `await` 都被 V8 连成一条 async stack→最终 `setState` 出现在该栈中→关联请求 URL。**不需要降级 async/await!** |
| **局限** | CDP 只在开启 DevTools 或 headless 时生效,生产不能用。但我们的方案本来就是 dev 烘焙+生产消费,所以**天然匹配**。 |
| **判据** | **高价值补入主干**。比 §4 中"async→promise 降级"更优雅,直接用 V8 原生能力。在 Puppeteer/CDP headless 环境下烘焙时使用。 |

#### 10.2 Replay.io 录制回放引擎

| 维度 | 内容 |
|------|------|
| **机制** | Replay.io 做了两件事:一是录制浏览器进程的系统调用(renderer 进程的 GC、事件循环 tick、网络包)和 GC 堆来确定性重放;二是提供 DevTools-like 的前端。重放时可以添加当时不存在的 console.log/断点。 |
| **关联** | 如果能录制一次"骨架页加载→所有接口返回→DOM 渲染完毕"的执行,重放时通过 CDP 注入 traceId 标记,做到**事后关联**。 |
| **为什么不能作主干** | 需要整个系统的录制基础架构,不是 light-weight 方案。且重放时无法触发真实网络。 |
| **判据** | **作远期参考但不纳入当前方案**。如果团队已有 Replay 基础架构,可作为协议一部分。 |

#### 10.3 Playwright / Puppeteer 拦截式绑定(HAR-based)

| 维度 | 内容 |
|------|------|
| **机制** | 在 Playwright 中:`page.route()` 拦截每个请求并注入 traceId → `page.waitForResponse()` 获取时序 → 用 DOM mutation 的时间窗口做**时间相关性绑定**:假设在某请求的响应到达后 Nms 内发生的 DOM 变化,与该请求有关。 |
| **为什么不能用** | 时间相关性是最弱的关联方式:并发请求、后端耗时差异、虚拟滚动、懒加载、debounce 都会破坏时间假设。 |
| **判据** | **否决作为主要绑定机制**,但可作为 traceId 方案的 fallback(在 traceId 丢失时用时间窗口+元素路径做弱关联)。 |

#### 10.4 差分测试(Differential Testing / Differential Fuzzing)

| 维度 | 内容 |
|------|------|
| **机制** | 对同一页面运行两次:一次所有接口正常,一次拦截某个接口返回 mock/error。对比两次 DOM 的差异区域 = 被拦截接口影响的范围。 |
| **优点** | 不需要改源码,不需要 traceId。理论上是纯黑盒、零侵入方案。 |
| **局限** | **(1) 指数级接口数**:N 个接口需至少 N 次运行(每次拦截一个)或 2^N 次(组合)。**(2) JSON diff 噪声大**:DOM 的 diff 受时间戳、随机 key、动画 tween 等影响。**(3) 组合依赖**:两个接口的数据同时影响同一块 DOM,单独拦截都不能完整揭示。**(4) 非确定性**:autoplay 轮播、倒计时、WebSocket 推送在当前帧的影响不可控。 |
| **判据** | **否决作主干,但可作独立验证手段**:用主干方案得到绑定关系后,差分测试拦截对应接口,看 DOM 是否真的少了对应区域,作为**正确性复核**。 |

#### 10.5 Coverage-Guided UI Fuzzing

| 领域 | 内容 |
|------|------|
| **机制** | 类似 AFL 但 target 是浏览器:通过随机/启发式 UI 交互(点击、输入、滚动)探索状态空间,用 JS 代码覆盖率作为反馈信号。 |
| **关联** | 覆盖更多代码路径 → 发现更多接口调用 → 帮助烘焙阶段提高绑定覆盖率。 |
| **判据** | 不直接解决"接口↔DOM 绑定"问题,但可用于提高烘焙覆盖率。**可选补充**。 |

#### 10.6 Snapshot / Regression Testing 工具(Percy, Chromatic)

| 领域 | 内容 |
|------|------|
| **机制** | Percy/Chromatic 截取组件截图,对比 DOM snapshot 的 diff。 |
| **关联** | 不提供因果,只提供"什么变了"。 |
| **判据** | 不适用。偏离场景。 |

---

### 11. 编程语言 / 编译器领域

#### 11.1 TC39 AsyncContext 提案

| 维度 | 内容 |
|------|------|
| **机制** | `AsyncContext.Variable` 是 Node.js `AsyncLocalStorage` 的标准化版本。创建变量 → `variable.run(value, callback)`,在 callback 及其所有异步分支(包括 `await`、`Promise.then`、`setTimeout`)中都能读到该值。**目前 Stage 2.7,Chrome 正在实现。** |
| **革命性** | 如果 `AsyncContext` 落地浏览器:发起请求时 `requestContext.run({ traceId, url }, async () => { ... fetch/await/setState ... })`,所有下游异步操作都能通过 `requestContext.get()` 读到这个 traceId。**直接消灭了整个 async/await 传播问题。** 不再需要 V8 PromiseHook hack,不再需要 async→promise 降级。 |
| **当前状态** | 截至 2026-06,Chrome Canary 已实现,标准接近 Stage 3。预计 2027-2028 年 shipping。 |
| **判据** | **中期最重要利好**。一旦落地,§4 的传播侧复杂度大幅下降,整个方案从"可行但复杂"变成"直截了当"。建议在方案中标注:"当前用 CDP async stack 做传播,待 AsyncContext shipping 后迁移至此"。 |

#### 11.2 静态分析:基于图的 Program Slicing(WALA/TAJS/SAFE)

| 维度 | 内容 |
|------|------|
| **机制** | WALA(IBM 开发)能对 JavaScript 做 Anderson-style 指针分析+调用图构建。TAJS(AAU 开发)是专门的 JS 静态分析器。从 DOM 操作点(如 `div.textContent = x`)做**后向切片**:沿着调用图反向追踪 x 的来源→经多少层函数→最终追溯到 fetch API 的调用参数。Slice 结果就是"这个 DOM 操作依赖的代码路径"。 |
| **为什么不能单独用** | **(1) 动态属性/原型链/闭包导致 sound 的不可能**。**(2) 过近似(over-approximation)**:静态分析会报告很多实际上不会被执行到的路径。**(3) 面向对象和函数式写法的处理与精确度,在 JS 中差异极大。** 正确率就算做到足够好,也无法直接映射到运行时 traceId。 |
| **混合方案** | 静态切片+React Compiler HIR 做 **soundy**(非 sound 的实用近似)预处理:在编译期标注"这个变量依赖的数据来自哪个 fetch 调用的哪个返回值",作为**编译期标注(tag)+运行时 traceId 关联**。这样不要求静态分析完全精确,运行时 traceId 来验活,两者互补。 |
| **判据** | **不单独用,但与 React Compiler HIR 联合可做预标注**。优先级中等。 |

#### 11.3 Facebook MemLab(堆快照对象追溯)

| 维度 | 内容 |
|------|------|
| **机制** | MemLab 对 V8 heap snapshot 做支配树(dominator tree)和保留路径(retaining path)分析,找出内存泄漏的根因对象→追溯到哪段代码创建了该对象。核心:给定一个堆中的对象,找到它的"出处"(allocation site)。 |
| **映射** | 对于 DOM 节点,可以用 Memlab 反查堆中 `__reactFiber$xxx.stateNode` 对应的数据对象,然后追溯该数据对象的保留路径→如果路径上有 fetch 的 response data → 就能直接关联。 |
| **局限** | **(1) Heap snapshot 是静态快照,类似一个时间点,不能反映"这个 DOM 在 render 时用的是哪个请求的数据"。**(2) 需手动触发 heap dump。**(3) 不区分实时数据 vs 旧数据。 |
| **判据** | **作为交叉验证手段**。给定一个 DOM 节点→用 heap 追溯其 fiber.stateNode→看他依赖的数据对象→看数据对象的 allocation site→看它是在哪个 fetch callback 中创建的。**一锤定音的验证而非主流程。** |

#### 11.4 Soufflé/Datalog 式声明式分析

| 维度 | 内容 |
|------|------|
| **机制** | 用 Datalog 声明"如果有一条 fetch 边+一条赋值边+一条 DOM 写入边,则存在 fetch→DOM 的绑定关系"。Soufflé 把事实和规则编译为 C 代码执行。 |
| **关联** | 如果把 traceId 传播得到的事实(traceId 到了哪些 fiber)+组件树层级事实(DOM 树的 parent-child)输入 Datalog,可自动推导"某被包子树的所有叶子节点的 traceId 并集 = 该子树的接口依赖集"。 |
| **判据** | 不是新范式,是 **traceId 方案的规则引擎**。可用于烘焙阶段的绑定计算。 |

#### 11.5 Babel 编译期插桩(Compile-Time Instrumentation)

| 维度 | 内容 |
|------|------|
| **机制** | 传统方案:Babel 插件在编译时对每个变量赋值/读取/函数调用的 AST 节点注入 `__trace(变量名, 值, 源码位置)` 调用。类似 Istanbul/nyc 的代码覆盖率插桩。 |
| **与 Jalangi 的关键区别** | Jalangi 是**运行时操作级**插桩(每个 `+`、`.`、`=` 都插入调用),Babel 插桩是**编译时语句级**(只在源码层面)。开销从 30-100x 降到 ~3-10x。 |
| **能做但不够好** | 编译期 insert `__trace()` 调用来捕获数据流,但 JS 的动态特性(属性访问、函数调用链、闭包)导致覆盖率不如 Jalangi,同时仍要面对 Proxy 的 identity 丢失问题。 |
| **判据** | **不作主干**。Babel 插桩+JSX scope tracking 联合可作为**浏览器端 dev 工具链的补充**(对裸 fetch→useState 的显式链做快速关联)。 |

---

### 12. 可行性结论(综合 §1–§11 后的最终判定)

#### 12.1 确实有方案可实现目标——并且不止一个

| 方案 | 可行性 | 工程代价 | 精确度 | 覆盖场景 |
|------|--------|----------|--------|----------|
| **主干:OT traceId + CDP async stack + react-scan DOM 落点** | **高** | 中 | 精确 | fetch/XHR/axios + useState/Redux/Context |
| 差分测试(拦截单个接口比 DOM 快照) | 中 | 高(每个接口一次运行) | 近似(组合效应漏) | 所有接口,但耗时爆炸 |
| CDP 请求拦截+DOM mutation 时序窗口 | 低 | 低 | 弱关联 | 仅有页面,时序不准 |
| 静态后向切片+Babel tag+运行时 traceId | 中 | 高 | 中(过近似) | 代码可直接分析的项目 |

#### 12.2 最优方案更新(融合 §9–§11 新发现)

```
更新后的方案层次:

第0层(传播基座): CDP async stack (DevTools/V8 引擎级)
  ✦ 不降级 async/await ← 新发现的关键能力
  ✦ 在 Puppeteer headless 烘焙时使用

第1层(请求侧): patch fetch/XHR 注入 traceId
  ✦ 通过 CDP Network.requestIntercepted 或 page.route() 注入
  ✦ 每个请求生成唯一 traceId
  ✦ traceId 存储在请求的 async context 中

第2层(传播): CDP async stack 自然传播
  ✦ V8 自动维护 async 链: fetch → .then → await → setState
  ✦ 不需要 userland patch Promise.then
  ✦ 在 setState 时刻,通过 CDP Debugger 在当前 async stack 上读出 traceId

第3层(DOM落点): react-scan onCommitFiberRoot + getMutatedHostFibers
  ✦ 本次 commit 改了哪些 host fiber
  ✦ 关联到第2层的 traceId

第4层(烘焙): Puppeteer/CDP headless 录制 + 绑定计算
  ✦ 框 → [traceId集] → [接口集]
  ✦ 产物: 静态绑定地图 (JSON)

中期迁移路径:
  浏览器 AsyncContext 落地 → 第2层从 CDP → AsyncContext.Variable
  → 不再依赖 CDP/Debugger → 可在普通浏览器 run → 更轻量
```

#### 12.3 对各场景的最终判定

| 场景 | 原方案判定 | 更新后判定 | 变化原因 |
|------|-----------|-----------|----------|
| RQ/SWR + .then 直链 | 精确 | **精确**(更简单) | CDP async stack |
| RQ/SWR + async/await | 精确(需降级) | **精确**(不需降级!) | CDP 引擎级支持 |
| 裸 fetch + .then(setState) | 精确 | **精确**(更简单) | 同上 |
| 裸 fetch + async/await + 并发 | 精确(需降级) | **精确**(不需降级!) | 同上 |
| store/Context 绕路 | 精确 | **精确** | 只要 setState 在堆栈上能追到 fetch → 不变 |
| fetch + async/await(未降级) | 退化 | **精确**(CDP 补) | 不再需要降级 |
| WS/SSE/轮询 | 无清晰语义 | 无清晰语义 | 无变化;补充:可按消息帧分配 traceId,但"完成"要手动判定 |
| 第三方库内部取数 | traceId 能抓 URL | 取决于库是否暴露 async 链 | 若 CDP async stack 能把库内部链也抓到,可以覆盖 |

#### 12.4 关键风险下降

- **原方案最大风险**:async→promise 降级影响开发体验(堆栈变形、try-catch 差异)
- **更新后**: CDP async stack 不需要降级 → **该风险消除**
- **新方案最大风险**: CDP 只在 headless/Puppeteer 环境可用,需要 CI 环境跑 Puppeteer。但烘焙本来就是在构建时做,所以**天然匹配**

---

## 13. 参考来源(完整)

- [Project Foxhound](https://github.com/SAP/project-foxhound) — SpiderMonkey 引擎级 string taint(学术验证)
- [OpenTelemetry Context Propagation](https://opentelemetry.io/docs/concepts/context-propagation) / [Traces](https://opentelemetry.io/docs/concepts/signals/traces/) — traceId + Span Links
- [K8s async trace context(KEP #5915)](https://github.com/kubernetes/enhancements/issues/5915) — Span Links 处理解耦异步
- [V8 PromiseHook commit](https://github.com/v8/v8/commit/c0fceaa0669b39136c9e780f278e2596d71b4e8a) / [V8 stack trace API](https://v8.dev/docs/stack-trace-api) — 引擎级异步上下文
- [Node async_hooks / AsyncLocalStorage](https://nodejs.org/api/async_hooks.html)
- [TC39 AsyncContext Proposal](https://github.com/tc39/proposal-async-context) — AsyncContext.Variable 浏览器标准化 (Stage 2.7)
- [CDP Debugger Domain](https://chromedevtools.github.io/devtools-protocol/tot/Debugger/) — async stack trace API, `setAsyncCallStackDepth`
- [React Compiler DESIGN_GOALS](https://github.com/facebook/react/blob/main/compiler/docs/DESIGN_GOALS.md) / [MUTABILITY_ALIASING_MODEL](https://github.com/facebook/react/blob/main/compiler/packages/babel-plugin-react-compiler/src/Inference/MUTABILITY_ALIASING_MODEL.md)
- [react-scan instrumentation.ts](https://github.com/aidenybai/react-scan/blob/main/packages/scan/src/core/instrumentation.ts) — fiber commit 归因
- [bippy](https://www.bippy.dev/) — fiber 遍历工具
- [MemLab](https://facebook.github.io/memlab/) — Facebook heap snapshot 对象追溯、allocation site 反查
- [Jalangi2](https://github.com/Samsung/jalangi2) — JavaScript 运行时操作级动态插桩框架
- [WALA](https://github.com/wala/WALA) — IBM T.J. Watson 静态分析框架 (Anderson-style 指针分析)
- [Provenance Semirings(Green 2007)](https://www.cs.ucdavis.edu/~green/papers/pods07.pdf) / [Provenance in Databases survey](https://homepages.inf.ed.ac.uk/jcheney/publications/provdbsurvey.pdf)
- [Denning 1976 IFC](https://www.cs.purdue.edu/homes/ninghui/readings/InfoFlow/denning76.pdf) — 信息流控制格模型基础理论
- [LoAF / PerformanceScriptTiming(MDN)](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming) — 浏览器原生脚本归因
- [MutationObserver 不带因果(StackOverflow)](https://stackoverflow.com/questions/53656494/how-to-get-the-function-which-caused-a-dom-mutation-with-a-mutationobserver) / [W3C 规范](https://lists.w3.org/Archives/Public/public-webapps/2011JulSep/1678.html)
- [Angular zone.js vs async/await(Issue #31730)](https://github.com/angular/angular/issues/31730) — userland async 不可 patch 的官方确认
- [Playwright networkidle 局限(Issue #37080)](https://github.com/microsoft/playwright/issues/37080) — 终止判定的行业天花板
