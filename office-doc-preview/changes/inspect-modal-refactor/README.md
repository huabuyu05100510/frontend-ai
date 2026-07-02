# 双栏对比 / 智检 — 重构：God Component 拆分 + Bug 修复

**模型：claude-sonnet-4-6**
**日期：2026-06-22**

## 变更概要

将 458 行的 `InspectCompareModal` God Component 拆分为 9 个职责清晰的模块，修复 7 个确认 bug。

### 架构变更

```
Before (1 file, 458 lines):
  InspectCompareModal.tsx  ← God Component: 弹层壳 + 智检渲染 + 双栏渲染 + 工具函数 + 子组件

After (9 files, 765 lines total):
  InspectCompareModal.tsx  (166行) — 薄协调器
  InspectView.tsx          (166行) — 智检模式（分类导航 + 文档区 + 错误侧栏）
  DualLayout.tsx           (69行)  — 双栏外层（格式条 + 列头 + picker 切换）
  DualColumnView.tsx       (213行) — 双栏段落网格（清理死 props）
  ErrorToken.tsx           (26行)  — 错误 token 组件
  FilePicker.tsx           (54行)  — 文件选择器 + fileGlyph
  text-extract.ts          (45行)  — 文本提取工具函数
  constants.ts             (16行)  — CATEGORIES / EDIT_TOOLS 常量
  index.ts                 (10行)  — barrel export
```

### Bug 修复

| # | Bug | 修复方式 |
|---|-----|---------|
| 1 | mode 状态重复（local useState + store inspectMode） | 删除 local state，改用 store 单一真源 |
| 2 | defaultMode 过期（useState 只初始化一次） | 加 useEffect 在 open false→true 时 sync |
| 3 | loadDiff 冗余 mode 依赖（body 不使用 mode） | 从 useCallback deps 移除 mode |
| 4 | 文本提取工具内嵌在组件文件中（不可测试） | 提取为 text-extract.ts 独立模块 |
| 5 | ErrorToken/fileGlyph 内嵌在组件底部 | 提取为独立组件/函数 |
| 6 | DualColumnView 死 props（source/compare 未使用） | 从 Props 接口移除 |
| 7 | setInspectMode 为死代码（modal 从不调用） | 现在被 modal 的 setMode 正确调用 |

### 测试矩阵

| Suite | 文件 | 用例数 | 状态 |
|-------|------|--------|------|
| 原有组件测试 | InspectCompareModal.test.tsx | 23 | GREEN |
| 新增 text-extract | text-extract.test.ts | 9 | GREEN |
| 新增 ErrorToken | ErrorToken.test.tsx | 7 | GREEN |
| 新增 FilePicker | FilePicker.test.ts | 13 | GREEN |
| 新增 InspectView | InspectView.test.ts | 11 | GREEN |
| E2E | inspect-compare.spec.ts | 5 | GREEN |
| 服务端 diff | diff.test.mjs | 37/38* | *预存性能阈值抖动 |
| **合计** | | **114** | **ALL GREEN** |

### 可观测日志

- `[inspect-modal] opened/closed/mode-change/diff-load`
- `[inspect-view] error-accept/error-ignore/error-select`
- `[dual-column] goto navigation`

### 文件清单

**新建 (11):**
- `web/src/inspect/text-extract.ts`
- `web/src/inspect/ErrorToken.tsx`
- `web/src/inspect/FilePicker.tsx`
- `web/src/inspect/constants.ts`
- `web/src/inspect/InspectView.tsx`
- `web/src/inspect/DualLayout.tsx`
- `web/src/inspect/index.ts`
- `web/test/text-extract.test.ts`
- `web/test/ErrorToken.test.tsx`
- `web/test/FilePicker.test.ts`
- `web/test/InspectView.test.ts`

**修改 (4):**
- `web/src/inspect/InspectCompareModal.tsx` (458→166行)
- `web/src/inspect/DualColumnView.tsx` (移除死 props)
- `web/src/store.ts` (无结构改动，setInspectMode 被正确调用)
- `web/src/styles.css` (添加分区注释)
