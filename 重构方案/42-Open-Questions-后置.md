# 42 · Open Questions（后置项）

> 本方案明确**不做**的能力清单。每条标明：**为什么不做**、**触发恢复的条件**、**未来实施时的入口文档**。
> 任何想把"后置项"提升为"必做"的提议，走 [00 §4 决策修改流程](./00-总览与决策锚点.md)。

---

## Q1 · SkeletonScheduler（仿 React Scheduler 全套）

**原方案描述**：[skeleton-architecture-design.md §3](../boneyard-main/packages/boneyard/src/skeleton-architecture-design.md) 提出完整的 lane + expirationTime + 最小堆 + MessageChannel + isInputPending 仿 React Scheduler。

**为什么不做**：

- 当前骨架副作用规模（拆除 + 预加载 + 接口态切换）远小于 React Fiber 渲染巨树
- `requestIdleCallback` + 简单优先级队列已足够
- 引入巨大复杂度（约 800 行代码），且需要每个平台适配 host backend
- 设计原文 §A1 自己也承认"对纯 CSR 单页是有点重"

**触发恢复条件（任一）**：

1. 实测 INP > 200ms 且火焰图证明来自骨架预加载/拆除
2. 接入页面数 > 50 时预加载导致首屏卡顿（实测 TBT 增加 > 100ms）
3. 多路由预加载场景下 `requestIdleCallback` 在 Safari 实测不可靠（已知问题：iOS rIC 触发率低）

**入口**：原文档 §3.1–§3.8 可直接复用；新建 `packages/smarty/src/scheduler/`，host backend 由各端实现（web=MessageChannel / rn=setImmediate / mp=wx.nextTick）。

---

## Q2 · Tier 1/2/3 自动 binding graph + 编译期 `autoBound`

**原方案描述**：[skeleton-build-pipeline-design.md §5.2](../boneyard-main/packages/boneyard/src/skeleton-build-pipeline-design.md) 用网络层 patch + onCommitFiberRoot + 数据层订阅表三信号自动建立 region ⇄ dataKey 边。

**为什么不做**：

- Tier 1 依赖 React Query / SWR 私有 API（QueryCache.observers），库版本升级易碎
- Tier 2 要 patch `setState/dispatch`，对自研 hook / Zustand 失效
- Tier 3 时间因果在并发 fetch 多的页面置信度低（多 fetch 同时返回时无法归因）
- `autoBound` 编译期自动插 `<Bound>` wrapper div 会破坏 CSS Grid / Flex / `:first-child` 选择器
- 显式 `<Bound deps>`（[14-step5](./14-step5-Bound显式接口态.md)）的运维成本可接受

**触发恢复条件**：

1. 业务方平均每页 ≥ 15 个 `<Bound>` 且开发者明确要求"少写 deps"
2. React 19 的 use() / Suspense 数据驱动 + Server Actions 普及，commit 与数据的归因变得更可靠
3. 业务方愿意接受"自动模式 + 人工校对"的工作流

**入口**：复用原 [skeleton-build-pipeline-design.md §5.2–§5.4]，新建 `packages/smarty/src/auto-binding/`，输出 `bindings.json` 带 `via:'subscription'|'origin-tag'|'time-causal'` + `conf` 置信度。

---

## Q3 · SSR Transform Stream 中间件

**原方案描述**：[ssr-injection-design.md §五](../boneyard-main/packages/boneyard/src/ssr-injection-design.md) 用 Node Transform Stream 逐块扫 `</body>` 注入 snippet，支持 React 18 流式 SSR + Next App Router。

**为什么不做**：

- 当前业务是 CSR 为主（[00 §1 D1](./00-总览与决策锚点.md)），SSG-lite 已覆盖
- Transform Stream 要处理 `Content-Length` / 压缩中间件顺序 / Edge Runtime 无 Node Stream API 等坑
- 每个适配器（Express/Fastify/Next/Cloudflare/Edge）都要单独实现 + 维护

**触发恢复条件**：

1. 业务方上 Next.js App Router 且明确要 RSC streaming 时的骨架
2. 业务方上 Remix / 类似 SSR 框架

**入口**：保留原文档不动；新建 `packages/skeleton-middleware/`，按原文档 §五 实现 Transform Stream。

---

## Q4 · i18n 文本宽度自适应

**问题**：英文 vs 中文 vs 阿拉伯文同一字段宽度差异大 → 骨架尺寸偏差。

**为什么不做**：

- 大多数业务首版只需 1 种语言 + 全屏占位
- 文本 gradient 模式（[02 §7](./02-最佳生成算法.md)）下宽度差异肉眼可接受

**触发恢复**：多语言切换观感投诉 > 月 5 起。

**实施思路**：dev:ske 模式下要求开发者**主动切换语言重浏**（与多断点同思路），bones.json 多一维 `locale` 索引；运行时 `<Bound>` 根据 `lang` 选择对应 bones。

---

## Q5 · 暗色 / 亮色实时切换（不刷新页面）

**问题**：当前 snippet 的暗色 CSS 由 `{{DARK_SELECTOR}}` 注入；但 snippet HTML 是构建期固化的颜色——切换主题时如果 `<Skeleton>` 重渲染，会闪 baseline 色。

**为什么不做**：

- SSG-lite snippet 只活到 React mount 前几十 ms，切换不可能发生在 snippet 显示期间
- 组件级 `<Skeleton>` 在加载状态下基本不重渲染颜色

**触发恢复**：业务方支持频繁主题切换 + 长加载状态（如 dashboard 数据慢）。

**实施思路**：CSS 变量 + `prefers-color-scheme` + JS 监听 `<html>` class 变化重渲染 bones className → light/dark 命中不同变量。

---

## Q6 · A/B 实验感知的 snippet 缓存

**问题**：A/B 实验导致同 URL 有不同布局 → 一份 snippet 无法适配。

**为什么不做**：复杂度高、收益对应业务窄。

**触发恢复**：业务方接入 A/B 平台，且 A/B 影响首屏布局 ≥ 20% 的实验组。

**实施思路**：snippet 文件名带 `[exp-id]` 后缀；bridge fetch 时按 cookie 选取；manifest 改为二级索引。

---

## Q7 · 多租户 / 多主题 site 的 snippet 缓存

**问题**：白标 SaaS 一个域名多个租户主题色不同。

**为什么不做**：现阶段无此业务。

**触发恢复**：白标客户接入。

**实施思路**：snippet 颜色用 CSS 变量 `var(--sk-color)`；运行时由租户配置 `:root { --sk-color: #... }` 覆盖。

---

## Q8 · 接口请求 / WebSocket 自动归因（Tier 3 启发式）

**问题**：用户不写 `<Bound deps>` 时能否启发式归因？

**为什么不做**：归因不准时盖错骨架体验比"没骨架"还差。

**触发恢复**：Q2 自动 binding graph 实施时配套。

---

## Q9 · 骨架 generator 走 Service Worker 缓存（smarty-smarty 模式）

**问题**：二次访问能否直接从 SW 缓存读 snippet HTML？

**为什么不做**：

- SSG-lite 已经把 snippet 内联 `index.html`，浏览器 HTTP 缓存就够了
- SW 注册时序复杂，调试成本高

**触发恢复**：首屏 HTML 体积过大（> 100 KB）需要分离。

---

## Q10 · 浏览器扩展可视化编辑

**参考**：[smarty-skeleton-toolchain DevTools toolbar](file:///Users/didi/Documents/smart/smarty-skeleton-toolchain) + [trinity-chrome-extension](file:///Users/didi/Documents/smart/smarty-skeleton-toolchain/trinity-chrome-extension)。

**问题**：dev:ske 之外，能否在 production 上用扩展可视化调整骨架（拖拽 bone、改颜色、导出 JSON）？

**为什么不做**：

- BGv2 自动化已经很高，手工编辑场景少
- 扩展开发 + 维护成本独立

**触发恢复**：业务方有"设计师参与骨架视觉调整"的诉求。

**实施思路**：参考 smarty-skeleton-toolchain `toolbar.ts` + `db.ts`（DSL ⇄ bin），新建独立扩展包。

---

## Q11 · 静态 AST 异步接口扫描升级为"自动包裹"

**问题**：[40 G8](./40-验收清单-G1-G8.md) 当前只扫描 + 告警；未来能否自动 `withSkeleton(Comp)` 包裹？

**为什么不做**：包裹引入 wrapper 影响样式（同 Q2 autoBound）。

**触发恢复**：业务方接受 wrapper（如所有页面统一 `<div className="page-section">…</div>` 已经天然有 wrapper）。

---

## Q12 · CDN / Edge Cache 视口断点协商

**问题**：CDN 缓存 `index.html`，没法按用户 viewport 返回不同断点的 snippet。

**为什么不做**：复杂度高，多数业务首屏移动端为主，375 断点能覆盖。

**触发恢复**：桌面用户首次访问 375 断点窄骨架投诉 > 月 10 起。

**实施思路**：

- 短期：Vary by Cookie（`__bvp`）
- 长期：Client Hints `Sec-CH-Viewport-Width`（参考 [ssr-injection-design.md §七](../boneyard-main/packages/boneyard/src/ssr-injection-design.md)）

---

## Q13 · 反向 Visual Diff（用骨架反推 fixture）

**问题**：能否反过来——拿骨架反推 fixture 是否正确实现？这能在设计师只提供骨架稿的情况下帮助验证开发。

**为什么不做**：超出本方案目标范围。

**触发恢复**：研发流程改革。

---

## Q14 · Next.js App Router / RSC 适配

**问题**：Next 14+ App Router 的 RSC payload 不是简单 HTML，注入点完全不同。

**为什么不做**：业务方目前不用 Next。

**触发恢复**：业务方迁移 Next。

**入口**：新建 `packages/skeleton-next/`，参考 [ssr-injection-design.md §五 Next.js middleware](../boneyard-main/packages/boneyard/src/ssr-injection-design.md)。

---

## Q15 · 实测性能数据回填到 02 §14

**问题**：[02 §14 性能基线](./02-最佳生成算法.md) 是设计目标，没有实测数据。

**触发恢复**：[41 P6 复盘](./41-Rollout-里程碑与回滚.md) 后回填。

---

## Q16 · 图片色采样默认开启（v2 新增）

**问题**：[02 §8](./02-最佳生成算法.md) 设计的"构建期 sharp 采样图片主色"是 11 个项目都没做的新能力，但**设计师是否接受、收益是否值得加复杂度**没验证过。

**为什么 v2 不默认开**：

- 业务方风险厌恶（虽然实际只在构建期跑，但担忧合理）
- 采样色 vs 默认灰的观感差异主观，需要设计师主导验证

**v2 处理**：

- 默认 `imageColorSample: false`
- P3 阶段做**独立浏览器扩展原型**：5–10 个真实页面对比"采样色 vs 默认灰"
- 设计师打分认可后，P4+ 改默认 `true` 并写进 [40 验收](./40-验收清单-G1-G8.md)

**触发恢复**：设计师认可 + P4+ 启动。

**入口**：[02 §8.1 实验性 + 验证再开](./02-最佳生成算法.md)；扩展原型代码新建 `apps/skeleton-color-experiment-ext/`。

---

## Q17 · Service Worker 接口归因（v2 新增）

**问题**：能否用 Service Worker 拦截所有 fetch/XHR，自动归因到 `<Bound>` 区域？

**为什么不做**：

| 风险 | 影响 |
|---|---|
| **SW 注册时序坑** | 首次访问 SW 还没装就拿不到 fetch；要"预热一次"才生效——而骨架最需要的就是首次访问 |
| **iOS Safari < 16.4 限制** | SW 在私密模式 + iOS 老版本不工作 |
| **postMessage 串行化** | 拦截后的请求信息要 postMessage 推回主线程，每个 ~3 ms；高频接口页面累积影响 |
| **业务自有 SW 冲突** | 业务方如果已有 PWA SW，本方案 SW 要么并行（多一个 worker）要么替换（无 PWA） |
| **运行时本不需要** | 接口态骨架运行时只需要"数据层告诉我状态变了"——React Query / SWR / Relay 都自带订阅 API，零开销；SW 的拦截 + 推回反而绕远路 |

**v2 决议**：

- **运行时**：不做 SW，保持当前显式 `<Bound deps>` + 数据层适配器（[14-step5](./14-step5-Bound显式接口态.md)）
- **dev:ske 诊断**：可做"全局 patch fetch/XHR"作为 [Q2 自动 binding graph](#q2--tier-123-自动-binding-graph--编译期-autobound) 的实施方式，但仅在 dev 模式

**触发恢复**：业务方明确要"自动 binding 且接受 SW 的所有风险"。

---

## Q18 · pruneTree aggressive 模式（v2 新增）

**问题**：[02 §5.1](./02-最佳生成算法.md) v2 默认 `safe` 模式（剪 30–40%），还有更激进的 `aggressive` 模式（剪 60%）未启用。

**为什么不默认开**：

- aggressive 剪枝会让骨架结构与真实 DOM 不再 1:1，**Visual Diff 容易超阈值**
- 业务结构经常有"看起来无用、其实有 `data-testid` / `role`"的容器

**触发恢复**：

1. 项目无 e2e 测试（不依赖 `data-testid`）
2. 业务接受 Visual Diff 阈值放宽到 10%+
3. 极端追求 snippet 体积（< 3 KB）

**入口**：改 `smarty.config.json` 的 `generator.pruneTree: 'aggressive'`。

---

## 决议升级流程（回顾）

任何 Q1–Q15 想从"后置"提升为"必做"：

1. 给出触发条件的**实测数据 / 业务变更证明**
2. 提案到 [00 §4](./00-总览与决策锚点.md) 走决策修改
3. 通过后从本文移除，写进对应 step 文档或新增 step
