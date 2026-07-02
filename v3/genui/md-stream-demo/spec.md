# 增量流式 Markdown 内核 — 技术规格 v1.0（imd kernel）

> 对标：Vercel streamdown / StreamMD / Flowdown / Textual(markdown streaming) / LibreChat 块级 memo PR
> 定位：把现有 demo 的「每 token 重切全文（A.5 级）」升级为 **「只解析新 token + 投机内联闭合 + 块虚拟化」（B 级前沿）** 的框架无关内核。
> 范围：本规格只定义**纯逻辑内核** `@/imd`（可单测、框架无关）；React 接入层（虚拟化/记忆化/懒加载）在 §7 给出契约，由内核驱动。

---

## 0. 设计目标与量化指标

| 维度 | 目标 | 量化指标 |
|------|------|----------|
| **解析复杂度** | 与文档长度解耦 | 每 token 解析成本 **O(尾块长度)**，全文 O(n)（非 O(n²)） |
| **重渲染范围** | 完成块永不重算 | 完成块 `status` 一旦 `final` 即冻结，id/hash 稳定 |
| **流式等价** | 流式结果 == 一次性结果 | 任意切片方式 `push` 后 `end()`，`getSegments()` 与原子解析**逐字段相等** |
| **零闪烁** | 未闭合语法不抖动 | 投机闭合：`**bo` 立即渲为粗体并标 `tentative`，`**` 到达后**无重绘** |
| **首屏** | 首块尽快可见 | 首个 `final/active` 段产出 < 1 帧 |
| **恒定 DOM** | 长文不膨胀 | 离屏块虚拟化，DOM 节点数与可见区相关，非与文档长度相关 |
| **安全** | 零信任渲染 | URL 仅 http(s)，禁裸 HTML 执行，代码仅展示 |

> 核心理念：**「已完成的部分是不可变的历史，只有正在写的最后一块是可变的现在」**。把解析与渲染都收敛到「最后一块」，其余冻结。

---

## 1. 与现状对比（为什么要升级）

| 能力 | 现 demo（A.5） | 本规格（B 级） |
|------|---------------|----------------|
| 切块 | 每 token `splitBlocks(全文)` | 记录最后边界 offset，**只扫描尾部新增** |
| 完成块 | memo（仍重切字符串） | `final` 冻结，跳过扫描与渲染 |
| 未闭合处理 | 整块 `autoClose`（可能整块重排） | **投机内联闭合** + `data-tentative`，到达即定 |
| 代码高亮 | 闭合才高亮 | 闭合才高亮（保持）+ 懒加载语言 |
| 长文 | 全量渲染 | **离屏块虚拟化** |
| 可测试性 | 渲染耦合 | **纯内核，property 级可测** |

---

## 2. 数据模型

```ts
export type BlockKind =
  | 'heading' | 'paragraph' | 'list' | 'table'
  | 'blockquote' | 'fence' | 'card' | 'hr';

export interface Segment {
  id: number;            // 单调递增稳定 id；一旦 final 永不变
  kind: BlockKind;       // 块类型
  text: string;          // 原始 markdown 源切片（不含分隔空行）
  hash: string;          // 内容指纹（cyrb53），final 后稳定
  status: 'final' | 'active'; // active = 仍可能增长的尾块
  lang?: string;         // fence/card 的语言标记
}
```

不变式（Invariants）：
- **I1 单调性**：`final` 段的 `id` 与 `hash` 在后续 `push` 中不再改变。
- **I2 唯一 active**：任一时刻最多 1 个 `active` 段（永远是最后一段）。
- **I3 围栏完整**：`fence`/`card` 段必含完整起止围栏后才可 `final`；未闭合时保持 `active`。
- **I4 流式等价**：见 §0。

---

## 3. 内核 API（框架无关）

```ts
export class IncrementalSegmenter {
  /** 喂入一段流式增量（可任意切片，含跨行/跨围栏） */
  push(delta: string): void;
  /** 结束流：把尾块 active → final */
  end(): void;
  /** 返回当前全部段（前缀 final + 末尾可选 active） */
  getSegments(): readonly Segment[];
  /** 仅返回自上次调用以来发生变化的段（增量渲染用） */
  drainDirty(): { changed: Segment[]; removedIds: number[] };
  /** 重置（新会话/重连） */
  reset(): void;
}
```

### 3.1 内部算法（尾块增量）
```
维护：
  finalized: Segment[]         // 已冻结
  buffer: string               // 尚未归入 finalized 的尾部原文
  baseLine: number             // buffer 对应的起始行（用于围栏状态）
push(delta):
  buffer += delta
  按行扫描 buffer：
    - 命中「块边界」(空行 / 标题行 / hr / 围栏闭合) 且不在围栏内
      → 切出一个完整块 push 到 finalized（status=final, 分配 id）
      → buffer = 剩余尾部
    - 否则保留在 buffer
  buffer 非空 → 末尾产出 1 个 active 段（kind 探测 + 投机闭合渲染）
end():
  buffer 非空 → 末块 final 化
```
关键：**已 final 的块不再参与扫描**，扫描始终只发生在 `buffer`（尾部）上 → O(尾块)。

---

## 4. 块类型识别（与 miniMarkdown 对齐）

| kind | 触发 |
|------|------|
| `fence`/`card` | 行首 ` ``` ` / `~~~`；语言 ∈ 卡片集 → `card`，否则 `fence` |
| `heading` | `^#{1,6}\s` |
| `hr` | `^([-*_])(\s*\1){2,}$` |
| `blockquote` | 连续 `^\s*>` |
| `table` | 含 `|` 且次行为分隔行 |
| `list` | `^\s*([-*+]|\d+\.)\s` 连续行 |
| `paragraph` | 其余连续非空行 |

卡片语言集：`amap | weather | product | stat | card`（复用现有 `CardRenderer`）。

---

## 5. 投机闭合 speculativeClose（治闪烁）

```ts
/** 对 active 尾块做渲染前的临时闭合，返回安全可渲染文本 */
export function speculativeClose(text: string): string;
```

规则（幂等、不改源 `Segment.text`，仅用于渲染输入）：
| 未闭合 | 处理 |
|--------|------|
| 奇数围栏 ` ``` ` | 末尾补 ` ``` ` |
| 奇数行内反引号 `` ` `` | 末尾补 `` ` `` |
| 奇数 `**` | 末尾补 `**` |
| `[text` 无 `]` | 补 `]` |
| `[text](url` 无 `)` | 补 `)` |

> 与 streamdown 的 `remend`、StreamMD 的「投机内联闭合」同类。目标：未闭合 token 先以最终样式渲染，真正的闭合符到达时 DOM 无变化（无重绘/无闪烁）。

---

## 6. 流式等价性（核心正确性保证）

**定义**：对任意原文 `S` 与任意切片序列 `[d1..dk]`（拼接 == S），
`segmenterStream([d1..dk]).end().getSegments()` 必须与 `segmenterAtomic(S).end().getSegments()` 在 `{kind, text, lang, status}` 上**逐段相等**（id 允许不同，但都为 final）。

验证方式：**property-based 测试**——随机原文 + 随机切片（含逐字符），断言与原子解析一致。这是「增量」安全的唯一硬证据（StreamMD 同款 `streaming-equivalence` 测试）。

---

## 7. React 接入层契约（由内核驱动，本期不强制 TDD）

```
StreamingMarkdown
  ├─ 订阅 streamBuffer.delta → segmenter.push(delta)
  ├─ drainDirty() → 仅更新变化段
  ├─ final 段：<MemoBlock key={id} hash> 冻结（永不重渲）
  ├─ active 段：speculativeClose → miniMarkdown 渲染 + caret
  ├─ fence/card：闭合(final)才上 Shiki/卡片；active 时 plaintext 占位
  └─ 虚拟化：IntersectionObserver 标记离屏 final 段 → 占位高度替身
```

- **重渲染器懒加载**：Shiki/KaTeX/Mermaid 仅在对应 `final` 块出现时动态 import，结果按 `hash` 缓存。
- **虚拟化**：离屏 `final` 段用等高占位替换，进入视口再实体化（DOM 节点数恒定）。

---

## 8. 验收标准（DoD）

- [ ] `IncrementalSegmenter` 通过：基础块识别、围栏不被空行切断、唯一 active、final 稳定 id/hash。
- [ ] 流式等价性 property 测试通过（≥ 200 组随机用例 + 逐字符切片）。
- [ ] `speculativeClose` 覆盖围栏/行内码/粗体/链接，且对已闭合输入幂等不变。
- [ ] `drainDirty` 只返回变化段（完成块进入后不再出现在 changed）。
- [ ] 全部测试在 vitest 绿。
- [ ] 内核零三方依赖、框架无关（不 import React）。

---

## 9. 非目标（本期不做）

- 不重写 React 渲染层为虚拟化（§7 仅给契约，后续迭代）。
- 不接真实 SSE/约束解码（仍由 StreamRunner 模拟）。
- 不引入 Shiki/KaTeX/Mermaid 实库（受网络限制；保留懒加载接缝）。
- 不做嵌套列表/脚注等高保真 markdown（沿用 miniMarkdown 覆盖度）。
