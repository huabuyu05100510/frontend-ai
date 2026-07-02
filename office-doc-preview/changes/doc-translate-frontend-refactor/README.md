# 文档翻译前端重构 (Phase B)

> 模型：claude-sonnet-4-6
> 日期：2026-07-01
> 分支：feature/design-overhaul

## 范围

替换 `TranslationPage.tsx` 的 `DocTranslateMode`（旧 lines 838-961）为 orchestrator：文件选择 + 任务面板 + 进度环 + 术语表 + 翻译记忆 + 取消 + 部分导出。

## 交付物

### 新增 Hooks（`web/src/hooks/`）

| 文件 | 行数 | 说明 |
|---|---|---|
| `useTranslateJob.ts` | 142 | 1s JSONL polling；in-flight dedup per jobId；`sinceSeq` 增量；terminal status 自动停；`cancel()` 调用 `/api/translate/image/batch/:id/cancel` |
| `useGlossary.ts` | 99 | CRUD + CSV import + `applyTo()` 最长优先替换 |
| `useTranslationMemory.ts` | 80 | CRUD + 250ms debounced `lookup(threshold)` |

### 新增 Components（`web/src/components/`）

| 文件 | 行数 | 说明 |
|---|---|---|
| `ProgressRing.tsx` | 60 | SVG `stroke-dashoffset` 圆环；0.6s ease-out；尊重 `<html data-motion="off">` |
| `DocTranslateProgress.tsx` | 95 | 进度环 + ETA + glossaryHits/tmHits chip + 取消 + 部分导出 |
| `DocTranslateTaskPanel.tsx` | 110 | 文件卡片网格 + 源/目标语种 + 4 种输出格式勾选 + 开始按钮 |
| `DocTranslateGlossaryPanel.tsx` | 75 | 术语列表 + CSV 导入 + 应用按钮 |
| `DocTranslateMemoryPanel.tsx` | 60 | TM 列表 + 阈值滑块 |
| `DevHeaderBadge.tsx` | 130 | dev-only (?dev=1) 浮窗；5min 滚动的 `X-*` 响应头快照；持久化关闭状态 |

### 修改文件

| 文件 | 变更 |
|---|---|
| `src/types.ts` | 新增 `TranslateJobFrame` / `GlossaryTerm` / `TmEntry` / `DocTranslateFormat` |
| `src/pages/TranslationPage.tsx` | `DocTranslateMode` 重写为 orchestrator；`export` 出来便于测试 |
| `src/styles.css` | 追加 `.xf-doc-translate-*`、`.xf-progress-ring-*`、`.dev-header-badge-*`（全部使用 `var(--color-*)` / `var(--xf-*)` token） |

## 测试统计

| 文件 | 用例数 |
|---|---|
| `test/hooks/useTranslateJob.test.ts` | 10 |
| `test/hooks/useGlossary.test.ts` | 8 |
| `test/hooks/useTranslationMemory.test.ts` | 6 |
| `test/components/ProgressRing.test.tsx` | 8 |
| `test/components/DocTranslateProgress.test.tsx` | 8 |
| `test/components/DocTranslateTaskPanel.test.tsx` | 7 |
| `test/components/DocTranslateGlossaryPanel.test.tsx` | 5 |
| `test/components/DocTranslateMemoryPanel.test.tsx` | 4 |
| `test/components/DevHeaderBadge.test.tsx` | 4 |
| `test/pages/DocTranslateMode.test.tsx` | 7 |
| **新增小计** | **67** |

**TDD 严格遵守**：
- 所有测试均先于实现代码编写
- Red 阶段：8 个新 test 文件 0 通过
- Green 阶段：实现后 67/67 通过
- Refactor 阶段：types/store 解耦

**总测试统计**（重构后）：
- Test Files: 85
- Tests: 560 passed + 1 skipped (bundleSize)
- 0 失败 / 0 错误

**构建状态**：
- `tsc -b`：仅 1 个 pre-existing 错误在 `src/App.tsx:91`（`selectedTaskId`）— 非本 PR 引入
- `vite build`：成功，4.19s
- bundle: index 499 kB / 150 kB gz

## 观测响应头约定

`DocTranslateMode.doTranslate` 主动读取并存储：
- `X-Job-Id` → 写入 `useTranslateJob` 启动 polling
- `X-Translate-Glossary-Hits` → 进度面板 chip
- `X-Translate-TM-Hits` → 进度面板 chip

`handleExportPartial` 触发 `/api/inspect/translate/export` 下载（headers 透传：`X-Export-Format` / `X-Export-Pages` / `X-Export-Source-Lang` / `X-Export-Target-Lang` / `Content-Disposition`）。

## DevHeaderBadge 行为

- 仅 `?dev=1` 渲染（其他 URL 不渲染）
- 通过 `recordDevHeaders(url, headers)` 接收外部快照（约定 5min 滑动窗口）
- 自动 5s 轮询刷新
- 关闭状态写 `localStorage.dev-header-badge-dismissed`
- 仍属于可观测 Phase B 目标的最小实现

**已知限制**：
- 自动 `recordDevHeaders` 还没接入全局 `fetch` 拦截器（后续 Phase D 可加：装饰 `globalThis.fetch` 把所有 `Response` 头都喂给 `recordDevHeaders`）
- 当前只是 UI 壳子 + API — 真正的「所有 X-* 头自动捕获」需要全局 fetch 拦截器（**不**在本 Phase 范围内）

## Hook 设计要点（避免 Phase 1.C 教训）

`useTranslateJob` 严格遵守：**所有 useCallback/useEffect 在任何条件 return 之前**。
- `inFlight` / `mounted` / `lastSeqRef` / `onCompleteRef` / `onErrorRef` / `jobIdRef` / `framesRef` / `statusRef` 全部在 hooks 顶部
- `cancel` 函数不依赖 `useTranslateJob` 返回的 status（用 ref 读取最新值）
- `poll` 用 `framesRef.current` 避免 stale closure

## 后续可观测增强（未实现）

1. **全局 fetch 拦截器**：用 `globalThis.fetch = wrapped` 自动调用 `recordDevHeaders`
2. **DevHeaderBadge 显示频率直方图**（按 endpoint 聚合）
3. **Export DOCX 进度**：翻译导出可能比 jobId 长，需要独立进度流
