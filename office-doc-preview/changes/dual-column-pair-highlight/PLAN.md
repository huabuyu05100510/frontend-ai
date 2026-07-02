# 双栏对比 · 段落对齐 + 差异可见性（行业标杆做法）

模型：claude-sonnet-4-6
日期：2026-06-22

## 用户原痛点
> 「高亮根本看不到」

实测定位：智检样例整段被算成 **1 个 416 字符的 change block**，
4 处差异挤在一起，hover 整段时根本没有视觉对比。

## 行业标杆调研

| 工具 | 关键做法 |
|---|---|
| **git diff** | 按 hunk 切分，每个 hunk 带上下文（默认 3 行） |
| **Google Docs Compare** | diff-match-patch + cleanupSemantic，inline 红绿标记 |
| **MS Word Compare** | 字符/段落级 track changes，红色删除线 + 下划线插入 |
| **VS Code Diff Editor** | 每个 hunk 独立显示 + 导航条「第 N/M 处差异」 |

## 最终方案（v4）

### 1. 数据：用 paragraphDiff（granularity='paragraph'）
后端 `paragraphDiff()` 早已实现，返回 `paragraphBlocks`。每 `change` block 内嵌 `charOps`。

### 2. 渲染：单滚动容器 + CSS Grid 双栏
- `.dcv-container-scroll`（一个滚动容器）
- `.dcv-para-grid`（`grid-template-columns: 1fr 1fr`）
- 每个 block 一行（左 cell | 右 cell），**天然对齐，无需 JS 同步滚动**

### 3. 关键修复：拆分 change block 为 hunks（核心可见性保证）
`splitChangeBlocksByHunks(blocks, CONTEXT=30)`：
- 找出每个 change block 的「非 equal 簇」（delete/insert 连续跑）
- 每簇切成独立 hunk，前后各带 30 字符上下文
- 截断处加 `…`
- 4 处差异 = 4 行（不再是一整段）

这是 git diff / VS Code Diff / Google Docs 的标准做法。

### 4. 高亮强化（从「看不到」到「一眼可见」）
| 元素 | 之前 | 现在 |
|---|---|---|
| `.dcv-char-delete` 背景 | 18% 红 | **55% 红 + 白字 + 加粗 + 1px 边框** |
| `.dcv-char-insert` 背景 | 18% 绿 | **55% 绿 + 白字 + 加粗 + 1px 边框** |
| `.dcv-para-pair-hover` 背景 | 18% 琥珀 | **35% 琥珀 + 2px inset 边框** |
| `.dcv-para-pair-sel` 背景 | 18% 靛蓝 | **28% 靛蓝 + 2.5px inset 边框 + 脉冲动画** |

### 5. 自动选中第一个差异（开屏即见）
`useEffect` 在 diff 加载完后自动 `setSelectedPair(firstChangeIdx)`，
用户开屏立刻看到靛蓝边框框住的第 1 处差异。

### 6. 差异导航条（VS Code Diff 风格）
- 粘性顶部条：「第 N / M 处差异」
- 上一处 / 下一处按钮，自动 `scrollIntoView({block:'center'})`
- 边界禁用

## 联动行为
- 共享 `hoveredPair` / `selectedPair` 状态（pairId = block 索引）
- hover 一个 cell → 同行另一 cell 同步进入 `dcv-para-pair-hover`
- 点击 cell → toggle `dcv-para-pair-sel`
- 「上一处 / 下一处」按钮跨行跳转 + 自动滚动

## 文件改动
| 文件 | 改动 |
|---|---|
| `web/src/inspect/InspectCompareModal.tsx` | fetch granularity='paragraph' |
| `web/src/inspect/DualColumnView.tsx` | **重写**：splitChangeBlocksByHunks + ParaGrid + ParaRow + ParaCell + 差异导航条 |
| `web/src/styles.css` | 强化字符级高亮到 55%+ 不透明度；强化段落 hover/selected；新增导航条样式 |
| `web/test/InspectCompareModal.test.tsx` | 删旧 char-level pair 测试，新增 4 个段落网格测试 + 1 个拆分测试 |

## 测试（TDD，21/21 通过）
`InspectCompareModal.test.tsx`：
1. 双栏段落网格：渲染所有 block，左右成对 cell，同行 pairId 一致
2. change block 左侧渲染 delete char，右侧渲染 insert char
3. hover 一个 change block → 同行左右两 cell 同步进入 hover；mouseLeave 清除
4. 点击 cell toggle 选中（适配首次自动选中）
5. **change block 内多处差异 → 拆成多个 hunk 行（每个差异独立可见）**

全量单测：5 个文件 72/72 通过。tsc --noEmit 零错误。

## 可观测
- 服务端日志：`[inspect-diff] granularity=paragraph ... paragraphs=N ms=K`
- 响应头：`X-Diff-Paragraphs`, `X-Diff-Ms`, `X-Diff-Errors`
- 前端日志：`[inspect] dual src=ID errors=N ms=K`

## 已知限制 / 后续
- 段落分割启发式：双换行优先；单段落长文时整段拆 hunks 解决可见性
- 不再保留原始版式（页眉页脚、图文混排）—— 双栏模式以段落对齐为先；
  保留版式走「智检」模式（单文档 + 错误下划线）
- 纯图片 PDF 无文字层，`extractText` 兜底返回空 → 显示「无内容」

## v5 修复：「0/0 已处理」根因 — compare=null 时拿自身跟自身比

### 现象
用户实测：进入双栏对比后左右两栏内容完全一致，状态 `0/0 已处理`，
所有交互（hover / 选中 / 上一处下一处）都看不出效果——因为根本没差异。

### 根因链
1. `TaskCard.tsx` 的「🔍 智检」按钮只传 `task`（单文件）
2. `store.ts openInspect(source, compare=null)`：只选一个文件时 `compare` 是 null
3. **关键 bug** `InspectCompareModal.tsx:103`：
   `const rightText = compare ? await extractText(compare) : leftText`
   compare=null 时 right=left → Myers diff 全 equal → 0 处差异
4. 用户在弹层顶部手动点「双栏对比」tab → 看到「拿自己跟自己比」的空对比

### 修复
**双栏模式必须有 compare** — 不能拿自身跟自身比。
- `InspectCompareModal.tsx`：mode==='dual' && !compare 时渲染文件选择器
  - 列出 `useStore(s => s.tasks)` 里除 source 外的所有任务
  - 点击 → `setInspectCompare(task)` → App.tsx 重渲染 → 新 compare 入参 → loadDiff 重跑
- `styles.css`：新增 `.icm-picker*` 样式（卡片列表 + hover/active）
- 测试：
  - 修：「切换到双栏模式渲染 inspect-left/right」→ 改为 compare=task 时才渲染 DualColumnView
  - 新增：compare=null 时双栏渲染 picker、排除 source、点击触发 setInspectCompare

### 全量测试
5 个测试文件 74/74 通过（InspectCompareModal: 23/23）。tsc --noEmit 零错误。
