# A2UI 生成式 UI · 最佳实践与架构方案

> 定位：在《A2UI-实现方案.md》的教学级实现之上做一次**架构升维**。目标是对标 2026 年顶级生成式 UI 技术栈，给出一套**可落地、极致性能、极致体验、生成可控**的工程基建方案。
>
> 技术栈基准：**React 19 + TypeScript**（`@a2ui/core` 框架无关，`@a2ui/react` 为首个一等公民适配器）。
>
> 阅读对象：前端基建 / 平台工程团队。读完即可据此排期落地。

---

## 0. 北极星目标与对标

### 0.1 北极星指标（North Star）

一套生成式 UI 基建的好坏，不看"能不能渲染"，而看下面 6 条硬指标。本方案的所有设计决策都服务于它们：

| 维度 | 指标 | 目标值 | 现状典型值 |
|------|------|--------|-----------|
| 首屏 | TTFC（Time To First Component，首个组件可见） | **< 300ms** | 1–3s（等整段 JSON） |
| 流式 | 增量更新帧不丢、不闪烁（CLS） | **CLS < 0.05** | 频繁重排 |
| 生成 | 协议合法率（一次生成可渲染） | **> 99.5%** | 90–97%（裸 JSON） |
| 交互 | 元素级修改往返延迟（点击→可见） | **乐观更新 < 50ms** | 等整轮 LLM 1–5s |
| 一致 | 设计系统 token 命中率（无裸值） | **100%** | 不可控 |
| 可达 | a11y 自动评分（axe 严重项） | **0 critical** | 普遍忽略 |

### 0.2 对标顶级技术（2026 横向对比）

| 能力 | Vercel AI SDK (RSC `streamUI`) | CopilotKit / AG-UI | Google A2UI | Thesys C1 | **本方案** |
|------|-------------------------------|--------------------|-------------|-----------|-----------|
| 协议 | tool→React 组件（服务端） | 事件流协议 | JSONL 组件树 | 私有 DSL | **A2UI JSONL + Schema 约束** |
| 流式粒度 | RSC chunk | token 事件 | 行级 | 行级 | **行级 + 部分 JSON 增量** |
| 生成可控 | Zod tool schema | 工具约束 | 弱 | 强 | **约束解码 + 组件级 Zod 校验** |
| 跨端 | 仅 React/Next | 多框架 | 多端 | Web | **core 框架无关，多端适配器** |
| 安全 | 服务端执行（需信任） | 事件白名单 | 无代码执行 | 无代码执行 | **无代码执行 + 多层 Guardrails** |
| 增量编辑 | 弱 | 状态 delta | Diff/Patch | 支持 | **Diff + 稳定 key + 乐观更新** |
| 可观测/Evals | OTel | 部分 | 无 | 有 | **协议级埋点 + GenUI Evals** |

**结论与取舍**：
- 不走 Vercel 的"服务端直出 React 组件（RSC）"路线——它把渲染绑死在 React/Next 且需要信任服务端代码执行。我们要**框架无关 + 零代码执行**，这是企业级 / 多端的硬约束。
- 协议沿用 A2UI 的 JSONL 组件树（安全、流式、跨端），但在其上叠加**三件顶级技术做的事**：① 约束解码保证合法率；② 部分 JSON 增量解析做到 token 级首屏；③ 设计 token 系统保证一致性与 a11y。

### 0.3 设计原则（贯穿全文）

1. **Streaming-first**：渲染管线为流式而生，不存在"等齐再渲染"的代码路径。
2. **Schema is the contract**：协议、组件、DataModel 全部 Zod 化，类型即文档即校验即 Prompt。
3. **零信任渲染**：LLM 输出一律视为不可信，渲染层做白名单 + 校验 + 净化。
4. **语义优于像素**：LLM 只输出语义意图（`useHint` / token），不输出裸像素值，一致性与主题切换在渲染层收口。
5. **可观测 / 可回归**：每一次生成都可埋点、可重放、可评测。

---

## 1. 分层架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  ⑦ 体验层  Skeleton / 动效 / 乐观更新 / 元素级编辑 / a11y       │
├──────────────────────────────────────────────────────────────┤
│  ⑥ 渲染引擎  StreamingRenderer（Suspense + 并发 + 虚拟化）       │
│             Reconciler（稳定 key Diff）· DataModel 双向绑定      │
├──────────────────────────────────────────────────────────────┤
│  ⑤ 设计系统  Design Tokens · Headless 组件 · useHint→token 求解  │
├──────────────────────────────────────────────────────────────┤
│  ④ SDK 核心  @a2ui/core：StreamParser（部分 JSON）· Store ·      │
│             TreeBuilder（防环）· Validator（Zod）· Diff 引擎     │
├──────────────────────────────────────────────────────────────┤
│  ③ 传输层  SSE（默认）/ WebTransport（双向）· 断点续传 · 背压    │
├──────────────────────────────────────────────────────────────┤
│  ② 生成层  约束解码 · 组件 Schema · 两阶段生成 · 语义缓存        │
├──────────────────────────────────────────────────────────────┤
│  ① 协议层  A2UI JSONL + 能力协商 + 版本化 + Schema 注册表        │
├──────────────────────────────────────────────────────────────┤
│  ⓪ 质量底座  Evals · OTel 埋点 · Guardrails · 安全沙箱           │
└──────────────────────────────────────────────────────────────┘
```

关键升维点（相对教学方案）用 ★ 标注，下文逐层展开：

- 协议层：★ Schema 注册表 + 能力协商
- 生成层：★ 约束解码（消灭非法 JSON）+ ★ 两阶段生成（布局规划→组件填充）+ ★ 语义缓存
- SDK：★ 部分 JSON 增量解析（token 级首屏）+ ★ 稳定 key Diff
- 渲染：★ Suspense/并发渲染 + ★ 长列表虚拟化 + ★ 流式骨架
- 设计系统：★ token 求解器（LLM 不出裸值）
- 底座：★ GenUI Evals + ★ 全链路 OTel

---

## 2. ① 协议层：Schema 即契约

### 2.1 协议骨架（沿用 A2UI，强化类型）

保留 A2UI 的扁平 JSONL 消息（利于流式传输与跨端），但把"松散 JSON"升级为 **Zod Schema 注册表**——它同时承担四个角色：运行时校验、TS 类型、文档、以及喂给 LLM 的 Prompt 片段。

```typescript
// @a2ui/core/protocol/schema.ts
import { z } from 'zod';

export const ServerMessage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('createSurface'),    surfaceId: z.string(), version: z.string() }),
  z.object({ kind: z.literal('surfaceUpdate'),    surfaceId: z.string(), components: z.array(ComponentSchema) }),
  z.object({ kind: z.literal('dataModelUpdate'),  surfaceId: z.string(), patch: z.array(JsonPatchOp) }), // RFC6902
  z.object({ kind: z.literal('beginRendering'),   surfaceId: z.string(), root: z.string() }),
  z.object({ kind: z.literal('componentPatch'),   surfaceId: z.string(), diffs: z.array(A2UIDiff) }), // ★ 增量
  z.object({ kind: z.literal('deleteSurface'),    surfaceId: z.string() }),
  z.object({ kind: z.literal('error'),            surfaceId: z.string().optional(), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
```

> 设计取舍：原 A2UI 用 `{createSurface:{...}}` 的"键名即类型"。我们改为显式 `kind` 判别字段——对**部分 JSON 流式解析**极其友好（只要 `kind` 先到，就能预判后续结构、提前建骨架），也让 discriminatedUnion 的报错精确到字段。

### 2.2 组件 Schema 注册表（★ 单一事实来源）

每个组件用一份 Schema 定义"属性 + 默认 useHint + 是否容器 + a11y 角色"。它是渲染、校验、Prompt 三方的唯一来源。

```typescript
// @a2ui/core/registry.ts
export interface ComponentSpec<P> {
  name: string;
  props: z.ZodType<P>;          // 属性校验
  isContainer: boolean;        // 能否有 children
  a11yRole?: string;           // 默认 ARIA role
  llmDoc: string;              // 喂给 LLM 的一句话说明 + 用法示例
}

export const Registry = new Map<string, ComponentSpec<any>>();

export function defineComponent<P>(spec: ComponentSpec<P>) {
  Registry.set(spec.name, spec);
}

// 由注册表自动派生「允许的组件白名单」与「Prompt 组件清单」
export const allowedComponents = () => [...Registry.keys()];
export const buildComponentCatalogPrompt = () =>
  [...Registry.values()].map(s => `- ${s.name}: ${s.llmDoc}`).join('\n');
```

**收益**：新增一个组件 = 注册一份 Spec。校验规则、Prompt 文档、白名单、a11y 默认值全部自动更新，杜绝"加了组件忘了更新 Prompt / 忘了校验"的漂移。

> 内置组件除 Text/Button/Column/Row/Input/Chart/List/Card/Form/Table 外，还包含一等公民 **`Markdown`**（富文本 / 推理叙事 / 长文流式，详见 §6.6），与结构化组件在同一 Surface 内自由混排。

### 2.3 能力协商与版本化（★ 生产必备）

握手阶段交换能力，服务端按客户端能力降级，避免新协议打挂老客户端。

```typescript
// 客户端 → 服务端（连接建立时）
{ "kind": "capabilities",
  "protocol": ["0.9", "1.0"],
  "components": ["Text","Button","Column","Row","Chart","List","Card","Input","Form","Table"],
  "features": ["partialJson","componentPatch","dataModel","webtransport"] }

// 服务端 → 客户端
{ "kind": "capabilitiesAck", "protocol": "1.0", "downgrade": [] }
```

降级策略：客户端不支持 `componentPatch` → 服务端退回整树 `surfaceUpdate`；不认识某组件 → 服务端用 `Fallback`（见 §6.5）占位而非报错。**协议演进永远向前兼容**。

---

## 3. ② 生成层：让 LLM 几乎不可能出错

教学方案里 LLM 直接吐 JSONL，靠 `try/catch` 跳过坏行——这在 demo 没问题，但合法率上不去（90–97%），是生成式 UI 体验崩塌的头号原因。顶级方案用三招把合法率拉到 99.5%+。

### 3.1 招式一：约束解码 / 结构化输出（★ 根治非法 JSON）

优先使用模型原生的"结构化输出"能力，把 A2UI 的 JSON Schema 直接作为解码约束，**从源头保证输出一定是合法 JSON 且符合 schema**。

```typescript
// 服务端：以 Zod schema 作为约束（OpenAI/Qwen 结构化输出 / 或本地 grammar 约束）
import { zodToJsonSchema } from 'zod-to-json-schema';

const stream = await llm.stream({
  model: 'qwen-max',
  response_format: {
    type: 'json_schema',
    json_schema: { name: 'a2ui_surface', strict: true,
                   schema: zodToJsonSchema(SurfaceUpdate) },
  },
  messages,
});
```

- 支持原生结构化输出的模型（GPT-4o+/Qwen2.5+/Gemini）：直接用，合法率≈100%。
- 自托管模型：用 **grammar-constrained decoding**（llama.cpp GBNF / Outlines / XGrammar）把 JSON 语法编译成 grammar，解码时强制走合法路径。
- 兜底：仍保留 `try/catch + 自动修复`（见 3.3）。

> 关键洞察：约束解码不是"事后校验"，而是"事中约束"。它让"括号没闭合 / 字段拼错 / 枚举越界"在生成阶段就不可能发生。这是教学方案与生产方案最大的代差。

### 3.2 招式二：两阶段生成（★ 布局规划 → 组件填充）

一次性让 LLM 既想布局又填内容，容易顾此失彼（布局乱 / token 浪费在重复结构）。拆成两阶段，质量与速度双赢：

```
阶段 A · Layout Planner（小 token、快）
  输入：用户意图 + 设计系统约束
  输出：布局骨架（仅 id / type / children / useHint），不含具体文案数据
  ↓ 立刻 surfaceUpdate 推给前端 → 前端先出「带骨架的真实布局」（TTFC < 300ms）

阶段 B · Content Filler（可并行、可流式）
  对骨架里的叶子节点并行填充 text/data/value
  ↓ 通过 dataModelUpdate / componentPatch 逐个回填
```

收益：
- **首屏极快**：骨架先到，用户立刻看到"页面长什么样"。
- **可并行**：多个叶子节点的内容可并发生成/回填。
- **省 token、可缓存**：骨架结构高度可复用（见 3.4 语义缓存）。

### 3.3 招式三：校验—修复闭环（兜底）

即便有约束解码，也要在 SDK 入口做组件级校验，非法节点不进树：

```typescript
// @a2ui/core/validator.ts
export function validateComponent(raw: unknown): Result<ComponentDef> {
  const base = ComponentSchema.safeParse(raw);
  if (!base.success) return repairOrDrop(raw, base.error); // ① 自动修复
  const spec = Registry.get(base.data.type);
  if (!spec) return ok(toFallback(base.data));             // ② 未知组件→Fallback
  const props = spec.props.safeParse(base.data.props);
  if (!props.success) return ok(withDefaults(base.data, spec, props.error)); // ③ 属性补默认
  return ok(base.data);
}
```

修复策略优先级：**补默认值 > 降级为 Fallback > 丢弃单节点（绝不整棵树报错）**。任何单点错误都不能让整个 Surface 白屏。

### 3.4 语义缓存（★ 性能 + 成本）

生成式 UI 的请求高度同质（"创建登录页""做个数据表格"）。用**语义缓存**命中相似请求，直接复用骨架甚至整棵树：

```typescript
// 二级缓存：精确缓存(请求指纹) + 语义缓存(embedding 相似度)
const key = hash(normalize(userMessage) + designSystemVersion);
let plan = await exactCache.get(key);
if (!plan) {
  const hit = await semanticCache.search(embed(userMessage), { threshold: 0.93 });
  plan = hit?.skeleton;                       // 命中→复用布局骨架，只重填内容
}
if (!plan) plan = await layoutPlanner(userMessage); // 未命中→真正生成
```

- 骨架层缓存命中率通常很高（结构同质），内容层按需重填 → **TTFC 进一步压到 ~100ms，token 成本下降 60%+**。
- 缓存键纳入 `designSystemVersion`，设计系统升级自动失效。

### 3.5 Prompt 工程要点

- **组件清单自动注入**：`buildComponentCatalogPrompt()`（§2.2）保证 Prompt 与代码永不漂移。
- **少样本 + 反例**：给 1–2 个正确 JSONL 示例 + 1 个常见错误的纠正示例。
- **强制语义化**：明令"颜色/间距只能用 token 名（如 `color.primary`、`space.4`），禁止裸十六进制/px"——把一致性约束前置到生成阶段。
- **增量优先**：多轮修改时在系统提示注入"只输出 `componentPatch` 差异，不要重发整树"。

---

## 4. ③ 传输层：流式、可恢复、有背压

### 4.1 默认 SSE，按需 WebTransport

| 场景 | 选型 | 理由 |
|------|------|------|
| 默认（服务端推 UI） | **SSE** | HTTP 原生、CDN/代理友好、浏览器自动重连、调试简单 |
| 高频双向（协同编辑/实时 DataModel 回传） | **WebTransport / WebSocket** | 双向、低延迟、多路复用 |
| 弱网/移动端 | SSE + 应用层心跳 | 兼容性最好 |

SSE 服务端关键头（沿用并强化）：

```typescript
ctx.set('Content-Type', 'text/event-stream');
ctx.set('Cache-Control', 'no-cache, no-transform');   // no-transform 防代理改写
ctx.set('Connection', 'keep-alive');
ctx.set('X-Accel-Buffering', 'no');                    // 关 Nginx 缓冲
// 每条消息带 id，用于断点续传
send(msg, { id: ++seq });
```

### 4.2 断点续传（★ 弱网体验）

利用 SSE 的 `Last-Event-ID`：每条消息带递增 `id`，断线重连时浏览器自动带上 `Last-Event-ID`，服务端从该序号之后续推。客户端 Parser 用 `id` 幂等去重，避免重复渲染。

### 4.3 背压（★ 防止前端被流淹没）

LLM 高速吐流时，前端渲染可能跟不上（尤其低端设备）。在 SDK 入口做帧合并：用 `requestAnimationFrame` 批处理，一帧内到达的多条 `surfaceUpdate`/`patch` 合并成一次渲染提交。

```typescript
// 帧级批处理：高频消息 → 16ms 一次提交
let pending: ServerMessage[] = [];
function onMessage(msg: ServerMessage) {
  pending.push(msg);
  scheduleFlush(); // rAF 节流
}
function flush() {
  const batch = pending; pending = [];
  store.applyBatch(batch);   // 一次性 set，触发一次 React 提交
}
```

---

## 5. ④⑥ SDK 核心 + 渲染引擎：极致性能

这是性能的主战场。教学方案的"三阶段 render→treeBuild→React.render"思路正确，但要做四处关键升级。

### 5.1 ★ 部分 JSON 增量解析（token 级首屏）

教学方案 Parser 是**行级**的——必须等一整行 JSON 收齐才能解析。但 LLM 是 token 级流式，一个大组件可能要等几百 ms 才凑齐一行。顶级方案做**部分 JSON 解析**：JSON 还没写完也能解析出"目前已确定的部分"，先渲染、后补全。

```typescript
// @a2ui/core/stream-parser.ts —— 容忍未闭合的 JSON
import { parsePartialJson } from './partial-json'; // 参考 Vercel parsePartialJson

class StreamParser {
  private buf = '';
  feed(chunk: string): PartialResult {
    this.buf += chunk;
    // 即使 buf = '{"kind":"surfaceUpdate","components":[{"id":"title","type":"Te'
    // 也能解析出 kind 已确定、components[0].id 已确定 → 立刻建 title 骨架
    const { value, state } = parsePartialJson(this.buf);
    return { value, complete: state === 'complete' };
  }
}
```

效果：用户在 LLM 写到第 3 个字符时就能看到第一个组件的骨架出现。**TTFC 从"等整行"压到"等几个 token"**。这是 SSE 之外，体感最大的性能跃升。

### 5.2 ★ 稳定 key 的增量 Reconciliation

组件 `id` 即 React `key`。增量更新时：

- **同 id**：复用 vnode 与 DOM，仅 patch 变化的 props（保留输入框内容、滚动位置、焦点）。
- **新 id**：标记 `isNew` 走淡入动画。
- **消失 id**：走淡出再卸载。

```typescript
// 渲染器：永远用 component.id 作为 key
function renderNode(node: VNode) {
  return <ComponentFor key={node.id} node={node} />; // key 稳定 → React 精准复用
}
```

配合 §3.2 的两阶段生成：骨架阶段建立 id，内容阶段回填——id 不变，React 走"更新"而非"重建"，**零闪烁、零状态丢失**（CLS<0.05）。

### 5.3 ★ 并发渲染 + Suspense（React 19）

- 流式更新用 `startTransition` 包裹：把"持续到达的 UI 更新"标记为非紧急，保证用户的点击/输入（紧急更新）永远不卡。
- 未到达内容用 `<Suspense fallback={<Skeleton/>}>`：组件骨架已在，内容用 Suspense 占位，到了再无缝替换。

```tsx
function Surface({ rootId }: { rootId: string }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot); // 并发安全
  return (
    <Suspense fallback={<SurfaceSkeleton />}>
      {renderTree(snapshot, rootId)}
    </Suspense>
  );
}

// 应用流式更新时降级为非紧急，避免打断用户交互
store.onBatch((batch) => startTransition(() => store.applyBatch(batch)));
```

> 用 `useSyncExternalStore` 对接外部 Store，是 React 18/19 下并发安全订阅的标准做法，避免撕裂（tearing）。

### 5.4 ★ 长列表 / 大表格虚拟化

LLM 经常生成大数据量（表格 1000 行、长 List）。`List`/`Table` 组件内置虚拟化（`@tanstack/virtual`），只渲染视口内节点。配合 §5.5 的懒求值，离屏内容延迟构建 vnode。

### 5.5 渲染管线优化清单

| 优化点 | 手段 |
|--------|------|
| 首屏 | 部分 JSON 解析 + 两阶段骨架 + Suspense |
| 增量 | 稳定 key + props diff，只重渲变化节点 |
| 不阻塞交互 | `startTransition` 降级流式更新 |
| 大数据 | List/Table 虚拟化 + 离屏懒构建 |
| useHint 转换 | token 求解结果 `WeakMap` 缓存（同 hint 不重算） |
| 重渲染 | 叶子组件 `React.memo` + 稳定 props 引用 |
| 包体 | 组件按需 `React.lazy` 注册，首屏只加载用到的组件 |
| 防环/防爆栈 | TreeBuilder 访问路径检测 + 最大深度限制 |
| 边缘部署 | SSE 网关跑 Edge Runtime，就近推流降 TTFB |

---

## 6. ⑤⑦ 设计系统 + 极致体验

### 6.1 ★ Design Tokens：一致性的收口点

LLM 永远不输出裸值，只输出**语义 token 名**与 `useHint`。渲染层用 token 求解器映射到当前主题。这一步同时解决：一致性、暗黑模式、品牌换肤、a11y 对比度。

```typescript
// 三层 token：原始值 → 语义 → 组件
const tokens = {
  color: { 'primary': 'var(--color-primary)', 'fg': 'var(--color-fg)', /* ... */ },
  space: { '1':'4px','2':'8px','4':'16px','6':'24px' },
  radius:{ 'sm':'4px','md':'8px','lg':'12px' },
  shadow:{ 'card':'0 2px 8px rgba(0,0,0,.08)', 'elevated':'0 4px 16px rgba(0,0,0,.12)' },
};

// useHint（语义）→ token → CSS 变量（支持主题热切换、无需重生成 UI）
function resolveHint(hint: UseHint): CSSProperties { /* 查表 + WeakMap 缓存 */ }
```

切换主题 = 切换 CSS 变量，**已生成的 UI 无需重新生成**即可换肤/切暗黑——这是"语义优于像素"的最大红利。

### 6.2 Headless 组件 + 内建 a11y（★ 0 critical）

`@a2ui/react` 的组件基于 Headless 基座（Radix / Ark UI）实现，自带键盘导航、焦点管理、ARIA。渲染层从 Registry 的 `a11yRole` 自动补 role/aria，并在 dev 模式跑 `axe-core` 断言。

| 组件 | a11y 保障 |
|------|----------|
| Button | role=button、键盘可达、焦点环 |
| Input/Form | label 关联、错误 `aria-describedby`、必填 `aria-required` |
| Chart | 自动生成数据表 fallback + `aria-label` 摘要 |
| Image | 强制 alt（缺失时由 Vision 生成描述） |

### 6.3 流式骨架 + 动效（★ 体感）

- **骨架**：两阶段生成的骨架阶段即渲染真实布局的占位（非通用 spinner），内容到达原地替换 → 无布局跳动。
- **淡入/淡出**：新组件 `opacity 0→1`（300ms），删除组件淡出后卸载；用"标记清除法"（教学方案已有）+ `prefers-reduced-motion` 尊重无障碍偏好。
- **流式打字感**：`Text` 组件支持内容流式追加渲染，营造"边想边写"的 ChatGPT 式体感。

### 6.4 交互与状态：DataModel 双向绑定 + 元素级编辑

**DataModel 双向绑定**：`Input` 的 `value` 绑 `dataModelRef`，本地输入即时更新 DataModel（乐观），同时事件回传 Agent。用 RFC6902 JSON Patch 做 delta 同步（对标 AG-UI 的 `STATE_DELTA`）。

**元素级编辑（点击→引用→修改）+ 乐观更新**（关键体验升级）：

```
1. 点击元素 → 高亮 + 输入框插入 @Button[btn_2]   （教学方案已有）
2. ★ 简单样式类修改（改色/间距/文案）→ 前端先本地乐观应用 → <50ms 可见
3. 同时把「选中元素 + 当前 Surface + 指令」发给 Agent
4. Agent 返回 componentPatch → 与乐观结果对账，不一致则平滑校正
5. Diff 增量更新，仅动 1 个节点，其余零重渲
```

乐观更新让"改个颜色"从"等一轮 LLM（1–5s）"变成"瞬时"，这是与教学方案体验上的代差。

### 6.5 Fallback 与降级（★ 永不白屏）

未知组件 / 校验失败 / 渲染异常，一律降级到 `Fallback` 组件（展示占位 + 原始意图摘要），并被 `ErrorBoundary` 兜住。**单点失败永不扩散为整页白屏**。

### 6.6 ★ Markdown 流式渲染（富文本 / 推理叙事 / 迭代过程）

> 这是生成式 UI 的**一等公民能力**。架构、方案、分析本质是"边想边写"的迭代过程：Agent 需要一边流式吐出 Markdown 叙事（标题、列表、代码块、表格、公式、Mermaid 图），一边在中间穿插结构化 A2UI 组件（图表、表单、按钮）。纯结构化组件树扛不住这种"长文 + 富格式 + 渐进细化"的表达，必须把 Markdown 作为协议与渲染的原生能力。

#### 6.6.1 为什么 Markdown 必须是一等公民

| 场景 | 纯组件树的问题 | Markdown 流的价值 |
|------|---------------|------------------|
| Agent 解释/推理 | 把段落拆成 N 个 Text 组件，token 浪费、结构僵 | 一段 Markdown 自然流式，体感如 ChatGPT |
| 架构/方案文档 | 标题/列表/代码/表格难以用组件枚举 | 原生 GFM 全覆盖 |
| 迭代细化 | 改一句话要重发组件 | 追加/替换 delta，渐进生长 |
| 代码/公式/图 | 无法表达 | code highlight / KaTeX / Mermaid |

定位：**Markdown 负责"叙事与长文"，结构化组件负责"交互与数据"**，两者在同一 Surface 内自由混排。

#### 6.6.2 协议：Markdown 组件 + 流式追加消息

新增 `Markdown` 组件，并新增**流式追加消息** `streamAppend`——把"内容增长"与"组件结构"解耦，让长文可以 token 级生长而不必重发整棵树。

```typescript
// 注册 Markdown 组件（进入 §2.2 Registry）
defineComponent({
  name: 'Markdown',
  props: z.object({
    content: z.string().default(''),
    streamId: z.string().optional(),  // 关联 streamAppend 的目标
    gfm: z.boolean().default(true),
    features: z.array(z.enum(['code','math','mermaid','table','footnote'])).default(['code','table']),
  }),
  isContainer: false,
  a11yRole: 'article',
  llmDoc: 'Markdown: 用于解释/长文/推理叙事，支持 GFM/代码/公式/Mermaid。叙事用它，交互用结构化组件。',
});

// ★ 新增协议消息：流式追加（对标 AG-UI 的 TEXT_MESSAGE_CONTENT delta）
z.object({ kind: z.literal('streamAppend'),
           surfaceId: z.string(), componentId: z.string(),
           delta: z.string(), done: z.boolean().default(false) });
```

消息流示例（叙事 → 图表 → 继续叙事，全程流式）：

```jsonl
{"kind":"surfaceUpdate","surfaceId":"s1","components":[{"id":"md1","type":"Markdown","props":{"streamId":"md1"}}]}
{"kind":"beginRendering","surfaceId":"s1","root":"md1"}
{"kind":"streamAppend","surfaceId":"s1","componentId":"md1","delta":"## 架构演进\n我们分三步迭代：\n1. "}
{"kind":"streamAppend","surfaceId":"s1","componentId":"md1","delta":"协议 Schema 化\n2. 约束解码\n"}
{"kind":"surfaceUpdate","surfaceId":"s1","components":[{"id":"chart1","type":"Chart","props":{...}}]}
{"kind":"streamAppend","surfaceId":"s1","componentId":"md1","delta":"如上图所示…","done":true}
```

> 与约束解码（§3.1）的协同：Markdown 正文是某个组件 `content` 字段里的**字符串值**。约束解码保证外层 JSON 结构永远合法，Markdown 文本作为字符串内容流入——两者不冲突。对接 `streamAppend` 时甚至无需把 Markdown 塞进 JSON，直接走纯文本 delta 通道，token 利用率最高。

#### 6.6.3 渲染：块级增量解析（治理流式 Markdown 的核心）

流式 Markdown 的最大坑是**语法未闭合**（代码块只写了 ```` ``` ````、表格只写了一半、链接只有 `[文字`）。错误做法是每来一个 token 就整篇重新 parse——既闪烁又 O(n²) 卡顿。正确做法是 **block-level memoized 增量解析**（业界标杆：Vercel `streamdown`、ChatGPT 渲染）：

```tsx
// @a2ui/react/components/Markdown.tsx
// 核心三招：① 切块 ② 已完成块按内容 hash 记忆化（不重渲）③ 只重渲最后未完成块
const Markdown = memo(function Markdown({ streamId }: { streamId: string }) {
  const content = useStreamBuffer(streamId);          // 订阅 streamAppend 累积的文本
  const blocks = useMemo(() => splitBlocks(content), [content]); // 按空行/围栏切块

  return (
    <article aria-label="生成内容">
      {blocks.map((blk, i) => {
        const last = i === blocks.length - 1;
        // 仅最后一块可能未闭合：渲染前做「虚拟补全」(自动闭合未结束的 ``` / 表格)
        const safe = last ? autoClose(blk) : blk;
        return <MemoBlock key={blk.hash} markdown={safe} streaming={last && !blk.closed} />;
      })}
    </article>
  );
});

// 已完成的块用内容 hash 做 key + memo：流式追加时只有最后一块重渲，前文零开销
const MemoBlock = memo(({ markdown }: { markdown: string }) =>
  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]}
                 rehypePlugins={[rehypeSanitize, rehypeKatex, rehypeShiki]}>
    {markdown}
  </ReactMarkdown>,
  (a, b) => a.markdown === b.markdown,
);
```

要点：
- **块级记忆化**：把文档切成块，已完成块以内容 hash 为 key + `React.memo`，流式期间**只有最后一块重新解析渲染**，前文完全不动 → 长文流式不卡、不闪。
- **虚拟补全（autoClose）**：渲染前对未闭合的代码围栏/表格/列表做临时闭合，保证半截语法也能优雅显示（光标处可加流式打字光标 `▍`）。
- **代码高亮流式**：用 Shiki 增量高亮；代码块未闭合时按 plaintext 渐进显示，闭合后再上色，避免高亮抖动。

#### 6.6.4 性能与体验细节

| 维度 | 手段 |
|------|------|
| 流式不卡 | 块级 memo（只重渲尾块）+ §4.3 rAF 帧合并 delta |
| 不闪烁 | 完成块内容 hash 稳定 → key 稳定 → 零重排（CLS<0.05） |
| 长文 | 超长 Markdown 块级虚拟化（视口外块只留高度占位） |
| 打字感 | 尾块末尾流式光标；尊重 `prefers-reduced-motion` |
| 代码/公式/图 | Shiki 高亮、KaTeX 公式、Mermaid 图（流式时降级为代码，闭合后渲染为图） |
| 包体 | Mermaid/KaTeX/Shiki 按需 `React.lazy`，用到才加载 |

#### 6.6.5 安全（Markdown 是 XSS 重灾区，零信任）

LLM 生成的 Markdown 一律不可信，渲染必须净化：

- **强制 `rehype-sanitize`**：白名单标签/属性，**禁止裸 HTML 执行**（`dangerouslySetInnerHTML` 绝不直通）。
- **链接/图片白名单**：`href`/`src` 仅允许 `https`，域名白名单 + `rel="noopener noreferrer"`；可疑链接降级为纯文本。
- **代码块只展示不执行**；Mermaid 走沙箱渲染并限制指令。
- **CSP** 兜底：禁内联脚本。

#### 6.6.6 迭代式细化（呼应"架构是迭代过程"）

Markdown 流不仅能"追加"，还要能"被修订"——支持文档式迭代：

- **追加**：`streamAppend`（done=false 持续生长）。
- **段落替换**：`componentPatch` 针对 Markdown 的某个 `blockId` 做替换（Agent 重写第 3 节，不动其余）。
- **元素级编辑**：复用 §6.4，点击某个 Markdown 块 → `@Markdown[md1#block3]` → 局部改写 → 乐观更新。

这样 Agent 产出方案/架构时，可以"先出大纲 → 逐节填充 → 局部精修"，与人类架构师的迭代节奏一致。

---

## 7. ⓪ 质量底座：Evals、可观测、安全

生成式 UI 的"不确定性"决定了：没有质量底座的方案不可上生产。

### 7.1 GenUI Evals（★ 把"好不好看/对不对"变成可回归指标）

建立离线评测集（用户意图 → 期望 UI 特征），CI 中每次 Prompt/模型变更自动跑：

| 评测维度 | 方法 |
|----------|------|
| 协议合法率 | Zod 校验通过率（目标 >99.5%） |
| 结构正确性 | 期望组件是否出现（如"表单"含 Input+Button） |
| 视觉回归 | 渲染→截图→与基线 diff（Playwright） |
| a11y | axe-core critical = 0 |
| 一致性 | 裸值检出率 = 0（只允许 token） |
| 性能 | TTFC / CLS 在阈值内 |
| 主观质量 | LLM-as-judge 打分（布局合理性、信息密度） |

### 7.2 全链路可观测（OTel）

每次生成打一条 trace，串起：意图 → 缓存命中 → LLM 延迟/token → 流式首字节 → TTFC → 合法率 → 修复次数 → 渲染耗时 → 用户是否再次修改（满意度代理指标）。线上 dashboard 监控合法率、TTFC、Fallback 率，异常告警。

### 7.3 安全与 Guardrails（零信任）

| 风险 | 防护 |
|------|------|
| 代码注入 | A2UI 无代码执行（架构级免疫，相对 HTML/v0 路线的根本优势） |
| 文本 XSS | 文本节点统一转义；富文本走白名单 sanitizer |
| Markdown 注入 | 强制 `rehype-sanitize` 白名单、禁裸 HTML 执行、链接/图片 https + 域名白名单、代码只展示不执行（详见 §6.6.5） |
| 图片/链接 | URL 协议白名单（https）+ 域名白名单 + CSP |
| 事件伪造 | 客户端事件服务端二次校验（surfaceId/componentId 必须存在） |
| 资源耗尽 | 组件数 / 树深 / DataModel 体积上限；循环引用检测 |
| Prompt 注入 | 用户内容与系统指令隔离；输出 schema 约束限制可生成范围 |
| 敏感数据 | DataModel 字段级脱敏；日志不落 PII |

### 7.4 工程化

```
packages/
├── @a2ui/core        # 纯 TS：schema/registry/stream-parser/store/treebuilder/validator/diff
├── @a2ui/react       # React 19 适配器：renderer/components/hooks
├── @a2ui/tokens      # 设计 token + 主题
├── @a2ui/server      # SSE/WebTransport 网关 + 约束解码 + 缓存
├── @a2ui/agent       # 两阶段生成 + Prompt + LLM 适配
├── @a2ui/evals       # 评测集 + 跑分
└── playground        # 端到端 Demo
```

- **契约测试**：`core` 与 `server` 共用同一份 Zod schema，CI 跑契约一致性，杜绝前后端协议漂移。
- **Spec 驱动**：先写 schema（即类型即文档），再写实现再写测试（沿用教学方案的 TDD 金字塔 70/20/10）。

---

## 8. 落地路线图（在现有 Phase 上演进）

> 现有《A2UI-实现方案.md》的 Phase 1–4 是很好的"能跑起来"基线。下面是在其之上达到"顶级 / 生产级"的增量路线，按 ROI 排序。

### M1 · 合法率与首屏（最高 ROI，2–3 周）
- [ ] 协议 Zod 化 + 组件 Registry（§2.1/2.2）
- [ ] 服务端约束解码 / 结构化输出（§3.1）→ 合法率冲 99%+
- [ ] 部分 JSON 增量解析（§5.1）→ TTFC < 300ms
- [ ] Validator 校验—修复闭环 + Fallback（§3.3/6.5）→ 永不白屏

### M2 · 增量与体验（2–3 周）
- [ ] 稳定 key Diff + componentPatch 增量协议（§5.2/2.1）
- [ ] 两阶段生成（布局骨架→内容回填）（§3.2）
- [ ] 流式骨架 + Suspense + startTransition（§5.3/6.3）
- [ ] 元素级编辑乐观更新（§6.4）
- [ ] **Markdown 流式渲染**：`Markdown` 组件 + `streamAppend` 协议 + 块级记忆化解析 + 净化（§6.6）→ 支持"边想边写"的迭代叙事

### M3 · 一致性与性能（2 周）
- [ ] Design Tokens + token 求解器，禁裸值（§6.1）
- [ ] Headless 组件 + a11y 内建 + axe 断言（§6.2）
- [ ] 列表/表格虚拟化 + 组件懒加载（§5.4/5.5）
- [ ] 语义缓存（骨架级）（§3.4）

### M4 · 生产化（持续）
- [ ] GenUI Evals 接入 CI（§7.1）
- [ ] 全链路 OTel + 线上看板告警（§7.2）
- [ ] 能力协商/版本化 + 断点续传 + 背压（§2.3/4.2/4.3）
- [ ] 安全 Guardrails 全量（§7.3）
- [ ] WebTransport 双向通道（协同/实时 DataModel）（§4.1）

---

## 9. 一页纸总结（决策者视角）

| 你要的 | 本方案怎么给 |
|--------|-------------|
| **对标顶级技术** | 取 A2UI 的安全+跨端，叠加 Vercel 的流式首屏、结构化输出，超出在"约束解码+设计token+Evals" |
| **极致性能** | 部分 JSON 解析（TTFC<300ms）+ 两阶段骨架 + 稳定 key 增量 + 虚拟化 + 语义缓存 + 边缘推流 |
| **极致体验** | 流式骨架零跳动 + 乐观元素级编辑(<50ms) + 主题热切换 + a11y 0 critical + 永不白屏 |
| **Markdown 流式 / 迭代** | `Markdown` 一等公民 + `streamAppend` delta + 块级记忆化解析（只重渲尾块、零闪烁）+ 与结构化组件混排，支撑"大纲→填充→精修"的迭代过程 |
| **生成可控** | Schema 即契约 + 约束解码 + 校验修复闭环 → 合法率 99.5%+ |
| **可上生产** | Evals 回归 + OTel 可观测 + 零信任 Guardrails + 协议版本化 |

**一句话**：用 A2UI 的"安全可控、跨端、流式"做地基，把"约束解码（治生成）+ 部分 JSON 流式渲染（治首屏）+ 设计 token（治一致性）+ Evals/可观测（治生产）"作为四根支柱，即可达到 2026 年生成式 UI 的第一梯队水准。

---

> 配套文档：教学级实现见同目录《A2UI-实现方案.md》；本文件聚焦"如何做到顶级"。两者配合：先按教学方案跑通 Phase 1–4，再按本文 M1–M4 升维。
```
