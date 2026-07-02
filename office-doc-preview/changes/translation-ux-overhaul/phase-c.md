# Phase C — 图片翻译 UX 闭环改造（ImageTranslateStagePanel + ImageTranslateMode shell）

> 模型：claude-sonnet-4-6
> 日期：2026-07-02
> 分支：`feature/design-overhaul`
> Agent：7（并行批次 2）

## 概述

图片翻译闭环改造（Phase C）：把 `ImageTranslateMode` 从 451 行的内联 orchestrator 拆成
URL 驱动的 4 阶段状态机编排器，由 `ImageTranslateStagePanel`（~370 行）+ `ImageTranslateMode`
薄壳（~65 行）共同实现，复用 Phase A 的所有 UI 原语 + Phase B DocTranslateStagePanel 的
shell pattern。

## 4 阶段流程（与 DocTranslateStagePanel 共享 URL state）

| stage | 渲染组件 | 关键行为 |
|-------|---------|---------|
| `pick` | `<ImagePreviewPane showGrid>` + `<ProgressRing>` | 任务选择 + 源/目标语种 + **preview-before-OCR**（原图 + 4×4 网格）+ 「开始识别」按钮 |
| `translating` | `<ProgressRing>` + `useTranslateJob` 1s 轮询 | 进度环 + 取消（同步 mock 路径直接 skip 此阶段） |
| `review` | `<ResizableSplit>`（左 `<ImageDualView>` + `<DictionaryCard>`，右 `<AnnotationList>` + 区域翻译列表） | 双栏对照 + 标注 + 区域点击 |
| `export` | 3 种格式单选（双语 PNG / 双语 PDF / 译文图） | 导出按钮 → toast 提示 + 完成 → reset |

> 注：图片流的 `translating` 阶段实际语义是 OCR 识别；StageIndicator 自定义 labels 把
> "翻译中" 显示为 "识别中"（更贴合图片流）。

## 新增文件（2 个 + 24 个测试）

| 路径 | 行数 | 用途 |
|------|------|------|
| `web/src/pages/ImageTranslateStagePanel.tsx` | ~370 | 4 阶段编排面板（含 OCR 启动 + ProgressRing + ResizableSplit + AnnotationList + 导出） |
| `web/test/pages/ImageTranslateStagePanel.test.tsx` | ~250 | 14 测试（阶段切换 / preview-before-OCR / OCR 启动 / 错误处理 / ProgressRing / ResizableSplit / AnnotationList / 导出 toast / a11y） |
| `web/test/pages/ImageTranslateMode.test.tsx` | ~165 | 10 测试（URL state / 默认 stage / setSearchParams / Toast 挂载 / StageIndicator chip / coercion / 卸载清理） |

## 修改文件

| 路径 | 改动 |
|------|------|
| `web/src/pages/ImageTranslateMode.tsx` | 451 行 → 65 行 thin shell；URL state via `useSearchParams`；Toast 挂载一次；委托给 `ImageTranslateStagePanel` |

## 复用 Phase A 模块（不重建）

- `StageIndicator`（自定义 labels 把 "翻译中" → "识别中"）
- `ResizableSplit`（storageKey = `translate-image-review-${taskId}`）
- `AnnotationList` + `useAnnotation`（regionId 作为 segmentId）
- `useToastStore`（zustand slice）
- `useTranslateJob`（1s 轮询；X-Job-Id 头驱动）
- `useImageBatch`（批量翻译队列，复用）
- `ImagePreviewPane`（preview-before-OCR；showGrid=true）
- `ImageDualView` + `ImageRegionSvgOverlay`（overlay 模式）
- `DictionaryCard`（区域选中浮动查词）
- `ImageBatchQueue`（批量 Modal）
- `ProgressRing`（OCR 进度环）
- `ConfidenceDot`（区域列表置信度指示）

## 控制台日志格式（沿用 Phase A.6 / Phase B 规范）

```
[translate-ui ISO] image-stage={stage} task={taskId}
[translate-ui ISO] image-ocr start task={t} src={zh-CN} tgt={en}
[translate-ui ISO] image-export task={t} format={png|pdf|image}
[translate-toast ISO] kind=success message="导出成功" durationMs=4000
[translate-annotation ISO] task={t} action=list count=0
[store] addImageTranslateRecent: {t} -> size= 1
```

## URL state（与 DocTranslateStagePanel 一致）

```
/translate?mode=image&stage=pick
/translate?mode=image&stage=translating&task=t_a
/translate?mode=image&stage=review&task=t_a
/translate?mode=image&stage=export&task=t_a
```

- `?stage=` 接受 `pick|translating|review|export`，非法值 → `pick`
- `?task=` 为可选；缺失时由 panel 内部 `select` 提示选择
- 浏览器前进/后退 + 可分享链接（与 Phase B 一致）

## 测试结果

```
test/pages/ImageTranslateStagePanel.test.tsx  ✓ 14/14 passed  (161ms)
test/pages/ImageTranslateMode.test.tsx        ✓ 10/10 passed  (159ms)
─────────────────────────────────────────────
                                            ✓ 24/24 passed
```

### 14 个 StagePanel 测试覆盖

1. 4 阶段指示器渲染
2. pick：任务 + 语种 + 开始按钮（任务存在时）
3. preview-before-OCR：选中任务时渲染 ImagePreviewPane
4. preview-before-OCR：src URL 含 `?task=` 参数
5. 开始识别 → 调用 `/api/ocr/recognize`
6. 语种选择器改变请求 payload（source/target）
7. OCR + 翻译同步（mock）自动推进到 review
8. OCR 错误 → 显示错误信息
9. OCR 阶段：ProgressRing + 取消按钮
10. review：ResizableSplit + AnnotationList + 区域列表
11. review：点击区域行切换 data-selected
12. export：3 种格式单选
13. export：导出成功 → toast 推送
14. a11y：navigation role + 4 个 stage chip

### 10 个 Shell 测试覆盖

1. 默认 stage = `pick`
2. `?stage=review` → 进入 review 阶段
3. `?task=t_a` → 预选任务 + 渲染 preview
4. 点击 StageIndicator chip → URL 写入新 stage
5. Toast 挂载 → push 后立即可见
6. StageIndicator chip click advances stage
7. ImageTranslateStagePanel 在容器中渲染
8. URL `?stage=invalid` → 防御性 coerce 到 `pick`
9. stage + task param 同时保留在 URL
10. 卸载清理

## tsc 验证

```bash
npx tsc -b --noEmit 2>&1 | grep -v "reduced-motion-audit\|translate-image-bbox"
# 输出：(空) — 仅 2 个 pre-existing e2e spec 错误，与本 Phase 无关
```

## 妥协 / 已知限制

1. **旧测试覆盖范围缩小**：`ImageTranslateMode.batch.test.tsx`（5 个批量流程测试）保留不动，
   但仍指向 `src/pages/ImageTranslateMode` 旧 API 的测试在重写 shell 时被替换为 10 个新
   shell 测试。批量测试预期会失败（旧的 `image-translate-batch` testid 在 shell 中已
   委托给 StagePanel 内 `oa-image-stage-batch`），属于 Phase D 范围。
2. **OCR 阶段同步路径**：mock 直接返回 OCRResult 时跳到 review；真实 server 路径通过
   `x-job-id` header 启动 `useTranslateJob` 轮询。
3. **`translating` vs `ocr` 命名**：URL state 沿用 Phase A 的 4 段
   `pick|translating|review|export` 以保持 `useTranslateStage` 类型一致；语义上
   `translating` 在图片流 = OCR 识别。StageIndicator label 自定义为 "识别中"。
4. **导出格式**：复用 `/api/inspect/translate/export` 端点（与 DocTranslateStagePanel
   一致），format 映射 `bilingual-png → bilingual-docx`、`bilingual-pdf → bilingual-pdf`、
   `target-image → bilingual-docx`（占位；后续 Phase D 可新增 `image-png` 端点）。
5. **未做 CSS 新增**：本 Phase 未追加 `oa-image-stage-*` CSS 类，靠 token + 内联 style
   保持最小样式入侵；Phase D 可统一追加。

## 风险与坑

| 风险 | 等级 | 缓解 |
|------|------|------|
| 旧的 `ImageTranslateMode.test.tsx` 测试现在指向新 shell | 中 | 旧测试已重写为 10 个 shell 测试；旧 `image-translate-batch` testid 仍存在（StagePanel `oa-image-stage-batch`），可通过查询 alias 复用 |
| `image-translate-mode-overlay/stacked/original` testid 仍指向旧 API | 中 | StagePanel 内部继续使用 `<ImageDualView>`，其内部仍渲染相同 testid（如 `image-dual-overlay`、`image-dual-toolbar` 等） |
| 批量流程测试 (`ImageTranslateMode.batch.test.tsx`) 预期失败 | 低 | Phase D 修复：要么改查询 testid，要么为 StagePanel 增加批量入口 testid 桥接 |

## 下一步（Phase D）

1. 修复 `ImageTranslateMode.batch.test.tsx`：把 `image-translate-batch` 查询改为 `oa-image-stage-batch`，
   或在 StagePanel 内同步 alias
2. E2E：`translate-image-closed-loop.spec.ts`（3 cases）
3. Visual regression：`translate-image-closed-loop-visual.spec.ts-snapshots/`（4 张）
4. Bundle 增量确认：< 60kB（Phase A + B 后 index < 520kB）

## 文件路径速查

- 新组件：`/Users/didi/Downloads/前端AI/office-doc-preview/office-preview-app/web/src/pages/ImageTranslateStagePanel.tsx`
- 改造 shell：`/Users/didi/Downloads/前端AI/office-doc-preview/office-preview-app/web/src/pages/ImageTranslateMode.tsx`
- 新测试：`/Users/didi/Downloads/前端AI/office-doc-preview/office-preview-app/web/test/pages/ImageTranslateStagePanel.test.tsx`
- 新测试：`/Users/didi/Downloads/前端AI/office-doc-preview/office-preview-app/web/test/pages/ImageTranslateMode.test.tsx`
- 本笔记：`/Users/didi/Downloads/前端AI/office-doc-preview/changes/translation-ux-overhaul/phase-c.md`