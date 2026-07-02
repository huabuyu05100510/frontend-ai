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
| 3 | **引擎级值污点**([Project Foxhound](https://github.com/SAP/project-foxhound),SpiderMonkey 给 JSString 嵌 taint,穿 transform、带 flow 历史) | 浏览器安全 | 引擎改造 + 字符串为主 | **最对路**:值→DOM 溯源,执行到的路径近精确;但定制 Firefox、dev-only |
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
   ├─ 请求侧:patch fetch/XHR/axios 发 traceId
   ├─ 传播侧:userland patch Promise.then + dev 期 async→promise 降级
   │           或引擎级 V8 PromiseHook / Node async_hooks(SSR/dev 工具侧)
   ├─ DOM 侧落点:react-scan onCommitFiberRoot + getMutatedHostFibers
   │           (本次 commit 改了哪些 host fiber + 打上引起它的 traceId)
   └─ 被包子树 host fiber 出现某 traceId → 绑定 子树 ⇐ 接口
补角:Project Foxhound 值污点(纯字符串值的值级溯源,补 traceId 传播不到的角落)
烘焙:框 → [traceId 集合 = 接口集] + bones 形状
生产:轻量揭示(只读烘焙结果,不再做追踪)
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

- 本调研**否决**了:纯 userland Proxy、纯 MutationObserver、纯静态切片单独使用、纯运行时启发式。
- 本调研**采纳并融合**:分布式追踪(traceId 主干)+ 引擎级传播(PromiseHook/降级)+ 值污点补角(Foxhound)+ commit 归因为 DOM 落点(react-scan)。
- **核心判据**(对齐"接口↔DOM 而非代码↔DOM"):**某接口的 traceId 出现在被包子树的 host fiber commit 里 = 绑定**。

---

## 8. 参考来源

- [Project Foxhound](https://github.com/SAP/project-foxhound) — SpiderMonkey 引擎级 string taint
- [OpenTelemetry Context Propagation](https://opentelemetry.io/docs/concepts/context-propagation) / [Traces](https://opentelemetry.io/docs/concepts/signals/traces/) — traceId + Span Links
- [K8s async trace context(KEP #5915)](https://github.com/kubernetes/enhancements/issues/5915) — Span Links 处理解耦异步
- [V8 PromiseHook commit](https://github.com/v8/v8/commit/c0fceaa0669b39136c9e780f278e2596d71b4e8a) / [V8 stack trace API](https://v8.dev/docs/stack-trace-api) — 引擎级异步上下文
- [Node async_hooks / AsyncLocalStorage](https://nodejs.org/api/async_hooks.html)
- [React Compiler DESIGN_GOALS](https://github.com/facebook/react/blob/main/compiler/docs/DESIGN_GOALS.md) / [MUTABILITY_ALIASING_MODEL](https://github.com/facebook/react/blob/main/compiler/packages/babel-plugin-react-compiler/src/Inference/MUTABILITY_ALIASING_MODEL.md)
- [react-scan instrumentation.ts](https://github.com/aidenybai/react-scan/blob/main/packages/scan/src/core/instrumentation.ts) — fiber commit 归因
- [bippy](https://www.bippy.dev/) — fiber 遍历工具
- [Provenance Semirings(Green 2007)](https://www.cs.ucdavis.edu/~green/papers/pods07.pdf) / [Provenance in Databases survey](https://homepages.inf.ed.ac.uk/jcheney/publications/provdbsurvey.pdf)
- [LoAF / PerformanceScriptTiming(MDN)](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming) — 浏览器原生脚本归因
- [MutationObserver 不带因果(StackOverflow)](https://stackoverflow.com/questions/53656494/how-to-get-the-function-which-caused-a-dom-mutation-with-a-mutationobserver) / [W3C 规范](https://lists.w3.org/Archives/Public/public-webapps/2011JulSep/1678.html)
- [Angular zone.js vs async/await(Issue #31730)](https://github.com/angular/angular/issues/31730) — userland async 不可 patch 的官方确认
- [Playwright networkidle 局限(Issue #37080)](https://github.com/microsoft/playwright/issues/37080) — 终止判定的行业天花板
