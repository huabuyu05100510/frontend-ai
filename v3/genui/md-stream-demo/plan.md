# 实施计划 — 增量流式 Markdown 内核（TDD）

> 配套 `spec.md`。原则：**Red → Green → Refactor**，纯内核先行，React 接入随后。
> 内核目录：`src/imd/`，测试：`src/imd/__tests__/`。

---

## 1. 模块拆解

| 模块 | 文件 | 职责 | 依赖 |
|------|------|------|------|
| 指纹 | `src/imd/hash.ts` | `cyrb53` 稳定哈希 | 无 |
| 类型 | `src/imd/types.ts` | `Segment` / `BlockKind` | 无 |
| 块识别 | `src/imd/classify.ts` | 单块原文 → `BlockKind` + `lang` | 无 |
| 投机闭合 | `src/imd/speculative.ts` | 尾块渲染前临时闭合 | 无 |
| 切块内核 | `src/imd/segmenter.ts` | 增量 push/end/getSegments/drainDirty | hash, types, classify |
| 接入层 | `src/markdown/StreamingMarkdown.tsx` | 内核驱动 React 渲染 | 内核 + miniMarkdown |

---

## 2. TDD 执行顺序（todos）

- [ ] **T0 测试环境**：vite.config.ts 加 `test`（environment: node，globals），加 `test` npm script。先跑空 `vitest run` 验证管线。
- [ ] **T1 hash**（red→green）
  - 测：相同输入同 hash；不同输入不同 hash；空串稳定；返回非空字符串。
  - 实现：移植现有 `cyrb53`。
- [ ] **T2 classify**（red→green）
  - 测：heading / hr / fence / card(amap) / blockquote / table / list / paragraph。
  - 实现：行首正则 + 卡片语言集。
- [ ] **T3 speculative**（red→green）
  - 测：奇数围栏补 ` ``` `；奇数行内码补 `` ` ``；奇数 `**` 补 `**`；`[a` 补 `]`；`[a](u` 补 `)`；已闭合输入幂等不变；多重未闭合组合。
  - 实现：按 spec §5 规则顺序处理。
- [ ] **T4 segmenter 基础**（red→green）
  - 测：单段落 1 段；空行分隔 → 2 段；标题独立成段；hr 独立；表格聚合；列表聚合；围栏内空行**不**切断；卡片围栏识别 kind=card。
  - 实现：按 spec §3.1 尾块扫描。
- [ ] **T5 segmenter 不变式**（red→green）
  - 测：I1 final 段 id/hash 跨 push 稳定；I2 至多 1 个 active；I3 未闭合围栏保持 active；`end()` 后全 final。
- [ ] **T6 流式等价性 property**（red→green）
  - 测：固定语料集 + 随机切片（含逐字符）≥200 组；断言流式与原子 `{kind,text,lang,status}` 逐段相等。
  - 实现：自带轻量随机切片器（无需 fast-check 依赖）。
- [ ] **T7 drainDirty**（red→green）
  - 测：首次返回全部；无变化时 changed 为空；新增字符只让 active 段进 changed；块完成后不再出现在 changed。
- [ ] **T8 全绿**：`vitest run` 全部通过；内核不 import React（grep 校验）。

---

## 3. React 接入（T8 之后，非本期硬性 TDD）

- [x] T9 `IncrementalMarkdown.tsx`：订阅 buffer → 仅喂 delta → segmenter；final memo 冻结，active 投机闭合渲染。`StreamingMarkdown` 按 mode 分发。
- [x] T10 三模式开关「增量 / 记忆化 / 朴素」+ 性能面板三列对比（累计渲染/最大单帧/FPS/掉帧），`App` 默认增量，`handleCompare` 串跑三模式。
- [ ] T11 离屏块虚拟化（IntersectionObserver 占位替身）——可选后续；当前对话内容短，收益有限，且需谨慎不破坏自动跟随滚动。

> T9–T11 在内核稳定且测试转绿后再做，避免渲染层污染内核正确性。
> 进度：T9/T10 已完成（`vitest` 34 绿 + `vite build` 通过）；T11 待定。

---

## 4. 风险与对策

| 风险 | 对策 |
|------|------|
| 网络无法装 fast-check | 自写确定性随机切片器（seeded），无外部依赖 |
| miniMarkdown 与 classify 行为分叉 | classify 规则直接对齐 miniMarkdown 的行首判定 |
| 围栏跨 chunk 边界 | buffer 维护围栏开合状态，按行而非按 chunk 判定 |
| final 块被误重切 | finalized 不再进入扫描窗口（仅 buffer 扫描） |

---

## 5. 完成定义（DoD）

对齐 `spec.md §8`：T1–T8 全绿，内核零依赖、框架无关，流式等价 property 通过。
