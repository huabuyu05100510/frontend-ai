# Translation UX Overhaul — Phase B

> 模型：claude-sonnet-4-6
> 日期：2026-07-02
> 分支：`feature/design-overhaul`
> Agent 范围：Phase B（DocTranslateMode closed-loop wiring）

## Context

承接 Plan `smooth-weaving-wilkes.md` — Phase A 已完成 8 个 UI 原语 + 3 个 hooks + 1 个 store。Phase B 把 `DocTranslateMode` 从"148 行 `<pre>` JSON dump"重构为 4 阶段状态机（`pick → translating → review → export`），URL state 双向同步，复用 `TranslationLayout` 做双语对照（React.lazy）。

## Deliverables

### 新文件

| 路径 | 行数 | 说明 |
|------|------|------|
| `web/src/pages/DocTranslateStagePanel.tsx` | ~380 | 4 阶段编排组件 |
| `web/test/pages/DocTranslateStagePanel.test.tsx` | ~250 | 14 tests |
| `web/test/pages/TranslationPage.docTranslateMode.test.tsx` | ~180 | 8 tests |
| `web/test/pages/TranslationPage.urlState.test.tsx` | ~140 | 6 tests |
| `web/test/inspect/TranslationLayout.download.test.tsx` | ~70 | 4 tests |

### 修改文件

| 路径 | 修改 |
|------|------|
| `web/src/pages/TranslationPage.tsx` | `DocTranslateMode` body 148 行 → 60 行 URL-state orchestrator |
| `web/src/inspect/TranslationLayout.tsx` | 新增 `onDownload?: () => void` prop（向后兼容） |

## DocTranslateStagePanel 4 阶段

| stage | 主要内容 |
|-------|----------|
| `pick` | 空态 CTA + task picker (`<select>`) + 语言选择器 + `<DocPreviewPane mode="source" pageRange={[1,2]}>` + "开始翻译" 按钮 |
| `translating` | `<DocTranslateProgress>` + `<DocPreviewPane mode="target" jobId={jobId}>` + 取消按钮 → 自动跳 `review` 当 job 完成 |
| `review` | `React.lazy(<TranslationLayout>)` + `<ResizableSplit>` + `<AnnotationList taskId>` + goBack/goNext |
| `export` | 4 种格式单选按钮（bilingual-docx/bilingual-pdf/target-pdf/vtt）+ "导出" 按钮（fetch + toast）+ "完成" 按钮（reset → pick） |

## URL state 约定

- 来源：Plan 决策 — 浏览器前进/后退 + 可分享链接
- searchParams keys：`?stage=…&task=…`
- 修复方式：上游 Phase A.4 已实现 `useTranslateStage({ taskIdParamKey: 'task' })`
- 本期 DocTranslateMode 包一层：读 `searchParams`，写 `setSearchParams`，保留其他 param

## 控制台日志（Phase A.6 规范延续）

| 触发 | 格式 |
|------|------|
| 阶段切换 | `[translate-ui ISO] stage={stage} task={taskId} annotations={count}` |
| 开始翻译 | `[translate-ui ISO] doc-translate start task={t} src={src} tgt={tgt}` |
| 导出文件 | `[translate-ui ISO] doc-translate export task={t} format={fmt}` |

## 关键实现细节

1. **`React.lazy` TranslationLayout** — 避免 review 阶段前加载 1350 行代码；Suspense fallback = `<div data-testid="oa-translation-layout-loading">`。
2. **`useTranslateJob`** — 取代旧 `DocTranslateMode` 内联的 `job.cancel()` 逻辑；hit job.status === 'finished' 时自动 `onStageChange('review')`。
3. **`onDownload` prop 注入** — `TranslationLayout` 内部 download button 现在通过 prop 回调冒泡；`DocTranslateStagePanel` 收到时弹出 Toast + 走 `/api/inspect/translate/export` 链接。
4. **AnnotationList 共生** — review 阶段 secondary pane 内挂 `<AnnotationList taskId={selectedTaskId}>`，依赖 Phase A.3 的 `useAnnotation(taskId)` 自动 fetch。
5. **`<Toast />` mount** — 由 `<DocTranslateMode>` 包装层挂一次，复用 `useToastStore`。

## 验收（Verification）

- [x] `tsc -b --noEmit` 无新增错误（仅 2 个 pre-existing e2e 错误与本 PR 无关）
- [x] 4 个新测试文件全 PASS
- [x] 不破坏 RealtimeTranslateMode / TextTranslateMode / 其他模式
- [x] TranslationLayout 对 InspectCompareModal 保持向后兼容（onDownload = undefined 时按钮仍能渲染，点击 no-op）
- [x] URL `?stage=review&task=t_xxx` 直链进入 review 阶段

## 已知限制 / 妥协

- **`computeEta` helper 仍在原 TranslationPage 中** — 本期未删除（保持现有 DocTranslateTaskPanel 旁路测试完整）；下轮清理
- **`DocTranslateTaskPanel` 仍由 TranslationPage.tsx 中 ImageTranslateMode 路径引用** — 影响零
- **Vite `manualChunks` 未针对 `inspection/TranslationLayout` 拆 chunk** — 等下轮 + bundle 验证一起处理

## 不破坏的现有测试

- `web/test/TranslationLayout.test.tsx` — 不变（onDownload 是 optional）
- `web/test/pages/DocTranslateMode.test.tsx` — 见下方 "DOE"
- `web/test/components/{StageIndicator,ResizableSplit,AnnotationList,DocPreviewPane,DocTranslateProgress}.test.tsx` — 全部 Phase A 自测 PASS

## DOE（Domain of Effect）

| DOE 维度 | 改动 |
|---------|------|
| 命名空间 (CSS `.oa-*`) | 无新增；复用 Phase A |
| 后端契约 | 无（响应头约定 Phase A.5 已就位） |
| 公共 store | 无（Phase A 决策：用 URL state 而非 store） |
| 路由 | 无新增 route；继续走 `/translate?mode=doc` |
| Bundle 增量 | ~10 KB（DocTranslateStagePanel + Toast mount） |
| WCAG | StageIndicator `role=tab` + AnnotationList `role=list` 满足 AA |

## 测试覆盖

- DocTranslateStagePanel.test.tsx (14)
  1. renders 4-stage indicator
  2. stage chip advances via useTranslateStage
  3. URL param integration (stage + task)
  4. ResizableSplit ratio persistence
  5. TranslationLayout lazy-loaded on review
  6. AnnotationList wired with taskId
  7. language selector updates target lang
  8. cancel during translating reverts to pick
  9. job finished auto-advances to review
  10. export flow pushes success toast
  11. 完成 button resets to pick
  12. preview pane shows in `pick` stage
  13. accessibility role on stage indicator
  14. data-motion=off renders without transition
- TranslationPage.docTranslateMode.test.tsx (8)
  1. renders DocTranslateStagePanel inside
  2. Toast mounted once
  3. reads stage from URL param
  4. updates URL on stage change
  5. preserves task param across stages
  6. default stage = 'pick'
  7. reset() clears task param
  8. external imports of DocTranslateMode still work
- TranslationPage.urlState.test.tsx (6)
  1. parses `?stage=review&task=t_xxx` correctly
  2. invalid stage falls back to 'pick'
  3. missing task handled (no err)
  4. encoding preserved (Chinese chars)
  5. shareable URL across render (new render with same params)
  6. browser back navigates between stages
- TranslationLayout.download.test.tsx (4)
  1. button rendered with title="下载"
  2. click calls onDownload prop
  3. click is no-op when onDownload undefined (backward compat)
  4. signature `onDownload?: () => void` matches interface

## 关键风险

- **`TranslationLayout` lazy load + Suspense in test** — jsdom 不支持真正的 lazy chunk；用 `vi.mock` 解决
- **Toast 自动消失 timer** — 默认 4s；测试用 `useToastStore.getState().clear()` 不依赖 setTimeout
- **本地 store 与 URL state 同步** — 仅在 DocTranslateMode 顶层包一层；不污染其他 mode
