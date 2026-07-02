# Phase A.4 — DocPreviewPane + ImagePreviewPane + useTranslateStage

> 模型：claude-sonnet-4-6
> 日期：2026-07-02
> Agent 4 of 5 (parallel) — phase A in multi-agent translation-ux-overhaul
> Plan: `/Users/didi/.claude/plans/smooth-weaving-wilkes.md`

---

## 范围

3 个文件 + 3 个测试文件，零服务端改动、零依赖 store 改造。

| 类型 | 路径 | 行数 |
|------|------|------|
| Hook | `web/src/hooks/useTranslateStage.ts` | ~125 |
| 组件 | `web/src/components/DocPreviewPane.tsx` | ~175 |
| 组件 | `web/src/components/ImagePreviewPane.tsx` | ~165 |
| CSS | `web/src/styles.css` 末尾追加 | ~180 |
| 测试 | `web/test/hooks/useTranslateStage.test.tsx` | 10 |
| 测试 | `web/test/components/DocPreviewPane.test.tsx` | 8 |
| 测试 | `web/test/components/ImagePreviewPane.test.tsx` | 10 |

合计 28 个新单元测试，全绿。

---

## useTranslateStage — 4 阶段状态机

### 设计要点

- **URL 双向同步**：读 + 写都通过 `useSearchParams`，浏览器前进/后退天然可用。
- **不依赖 store.ts**：纯 hook；后续容器组件（DocTranslateStagePanel）可同时订阅 store 与 URL 并保持一致。
- **可参数化 paramKey**：默认 `'stage'`，允许 `'translateStage'` 等自定义。
- **容错**：非法值（`'bogus'`）回退 `'pick'`。
- **日志**：阶段变化打印 `[translate-ui ISO] stage=… task=… annotations=0`（annotations 占位，后续由容器用 useStore 注入）。
- **辅助方法**：`goNext` / `goBack` 在边界自动 no-op；`reset` 显式清 task param，保留其他无关 param（如 mode）。

### 实现选择

- `coerceStage()` 集中做白名单校验，避免散落 `if`。
- `useSearchParams((prev) => …)` 函数式更新，保留其他 param。
- 全部返回字段用 `useMemo` 包裹，保证引用稳定（避免消费组件无限渲染）。
- 警告：`useSearchParams` 第二参数 `{ replace: false }`，允许浏览器历史前进/后退（默认就是 false，显式标注以可读性）。

### 测试覆盖

1. 默认 stage='pick' + 辅助标志位正确
2. URL `?stage=review` 读初始值
3. `setStage` 写 URL + 触发重渲染
4. `goNext` 推进 + 边界 no-op
5. `goBack` 后退 + 边界 no-op
6. `reset` 回 pick + 清 task param
7. isFirst / isLast 各阶段正确
8. stageLabel 4 个中文值
9. 自定义 paramKey 不污染默认 key
10. 非法 stage 值回退 pick

---

## DocPreviewPane — 文档预览

### 设计要点

- **3 mode**：`source` / `target` / `dual`（占位切换器，仅展示，可点但不影响 props；mode 由 props 控制）。
- **占位态**：无 `taskId` 时显示 "请先选择文件" 空态，不渲染任何 page。
- **页范围**：`pageRange: [start, end]` 1-based inclusive；默认 `[1, 2]`。
- **图片加载**：`<img src="/api/files/:taskId/preview?as=page&n={N}" loading="lazy" />`。
- **加载状态**：onLoad/onError 时更新页头 status 文字。
- **下载按钮**：仅在 `target` 或 `dual` mode 且 `onDownload` 提供时显示。
- **dual 布局**：CSS grid `1fr 1fr`（明确不接 ResizableSplit — 留给 Phase A.2 Agent 2）。

### 测试覆盖

1. 无 taskId → 占位态
2. 默认 2 页（source）
3. img src 包含 taskId + as=page + n=1
4. target mode 下载按钮受 `onDownload` 控制
5. dual mode 2 列 + 2 张图
6. `pageRange=[1,3]` 渲染 3 页
7. 所有 img 都有 `loading="lazy"`
8. img src 含正确 taskId + 页号

---

## ImagePreviewPane — 图片预览

### 设计要点

- **图片源**：`/api/inspect/translate/render-image?task=…&page=…`。
- **zoom**：受控/非受控双模式；CSS `transform: scale()` 在 `.oa-image-preview-stage` 上。
- **网格**：4×4 绝对定位 overlay，`background-image` linear-gradient；按钮 toggle 控制。
- **状态栏**：底部 `缩放 120% · 网格 开 · 第 2 页`（`role="status"`）。
- **region overlay**：可选 `OCRRegion[]`，渲染 SVG `<rect>` + 置信度配色 + hover 回调；坐标归一化到 viewBox 0..1000（保守占位 1000×1000 视口）。
- **受控/非受控**：zoom 与 showGrid 任一传 prop 即受控，组件内部状态失效。

### 实现细节

- 父容器 `transform: scale(zoom)`，子元素 img + grid + SVG 同步缩放。
- SVG overlay `pointer-events: none`，仅 rect 接收 hover。
- confidence → stroke color 复用 `--color-success` / `--color-warning` / `--color-danger`（与 ImageRegionSvgOverlay 一致）。
- viewBox 归一化：实际坐标 → 1000×1000 viewBox；显示侧用 `preserveAspectRatio="none"` 拉伸到与 img 一致。
- 注释中明确说明 viewBox 是占位 — 后续 Phase C 接入真实图像尺寸时可替换为 image naturalWidth/Height。

### 测试覆盖

1. img src 含 taskId + page
2. zoom=1.5 → CSS transform 含 scale(1.5)
3. showGrid=true → overlay 出现
4. 默认无 overlay
5. toggle 按钮切换 overlay
6. status bar 含 缩放 / 网格 / 第 N 页
7. page prop 改 URL query
8. regions.length=N → N 个 rect
9. hover 回调传 String(idx) / null
10. img `loading="lazy"`

---

## CSS 追加

`web/src/styles.css` 末尾追加 ~180 行，全部走 `var(--color-*)` semantic tokens，dark mode 通过 `[data-theme="dark"]` 选择器覆盖。

要点：
- `.oa-doc-preview` flex column + 12px padding
- `.oa-doc-preview-mode-switcher` 三按钮 tab 样式
- `.oa-doc-preview-grid--dual` `grid-template-columns: 1fr 1fr`
- `.oa-image-preview-canvas` 60vh overflow auto
- `.oa-image-preview-grid` `linear-gradient` 4×4
- `.oa-image-preview-stage` `transform: scale(zoom)` + 0.15s transition
- `.oa-image-preview-region-overlay` 绝对定位覆盖 img
- 全部使用 `var(--color-bg/subtle/border/border-light/border-strong/text-*/primary*)` — 无 inline `#RRGGBB`

---

## 风险与已知坑

1. **viewBox 归一化**：OCRRegion 坐标通常基于原图像素（如 1920×1080），本组件假设归一化到 0..1000。若实际坐标绝对像素，渲染将拉伸。Phase C 接入 `imageSize` prop 后可去掉归一化。
2. **dual mode 未用 ResizableSplit**：等 Phase A.2 Agent 2 完成 ResizableSplit 后，本组件可能需要新增 `resizable?: boolean` prop 包装。本轮不引依赖以避免破坏并行 agent 边界。
3. **console.info 量级**：每次 mount + props 变更都打印日志；高频场景（如翻译过程）可能刷屏。生产可通过 `[translate-ui ISO]` 前缀 grep 过滤。
4. **mode 切换器为视觉占位**：当前 mode 由 props 控制，切换器 onClick 不触发状态变更。后续由 DocTranslateStagePanel / ImageTranslateStagePanel 把 onChange 接到 `useTranslateStage.setStage`（间接通过 `mode` param 或单独 prop）。

---

## 测试统计

| 文件 | 用例 | 状态 |
|------|------|------|
| `useTranslateStage.test.tsx` | 10 | PASS |
| `DocPreviewPane.test.tsx` | 8 | PASS |
| `ImagePreviewPane.test.tsx` | 10 | PASS |
| **合计** | **28** | **ALL GREEN** |

tsc -b --noEmit：本批新增 3 文件零 type error。其它 TS 错误来自并行 agent（AnnotationChip/List/Popup 未实现、ResizableSplit 接口未对齐、e2e seedAppState 未导出）— 与本任务无关。

---

## 验证

```bash
cd /Users/didi/Downloads/前端AI/office-doc-preview/office-preview-app/web

# TDD 验证
npx vitest run test/hooks/useTranslateStage.test.tsx \
                test/components/DocPreviewPane.test.tsx \
                test/components/ImagePreviewPane.test.tsx
# → 3 files passed (3) / 28 tests passed (28)

# Type check (本 agent 文件 0 错误)
npx tsc -b --noEmit 2>&1 | grep -E "(useTranslateStage|DocPreviewPane|ImagePreviewPane)"
# → (empty)
```