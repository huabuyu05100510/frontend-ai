# 图片翻译 + 文档翻译 模块全量实现

> 模型：claude-sonnet-4-6
> 日期：2026-07-01
> 分支：`feature/design-overhaul`
> 用户决策：完整设计稿 / 全部依赖 / 两层架构

## 概述

完整落地设计稿 `translation.md`（图片翻译 14 项 + 文档翻译 12 项 P1+P2 能力），对标 DeepL Pro / Google Lens / 百度翻译控制台 / Naver Papago。

**核心价值**：
- 图片翻译：从「OCR + 整段翻译」升级为「区域 bbox + 置信度配色 + 词典卡片 + 双视图 + 批量」
- 文档翻译：从「一次性提交 + summary 摘要」升级为「进度环 + 取消/恢复 + 部分导出 + 术语表 + 翻译记忆 + 双语 DOCX/PDF」
- 后端新增 13 条 REST 端点 + 进度 JSONL + 完整观测响应头
- 前端 4 个 hook + 9 个组件 + 5 套视觉回归快照

## 最终测试增量

| 阶段 | 测试 | 累计 |
|---|---|---|
| 基线 (Phase 2) | — | Server 419 / Frontend 394 |
| Phase A 后端 | +92 | Server **511** |
| Phase B 文档前端 | +67 | Frontend **461** |
| Phase C 图片前端 | +80 | Frontend **541** |
| Phase D E2E + Visual | +35 e2e + 6 snapshots | **+41 e2e/visual** |
| **总计** | | **Server 511 / Frontend 541 unit + 35 e2e + 6 visual** |

注：Frontend 实测 541 (Phase B + C 报告 67+80=147，但有少量重叠 + 部分 from existing components)。Server 511 跑 `--no-file-parallelism` 全绿；并行跑有 3 个 multi-pair 隔离测试偶发失败（已记录为已知遗留）。

## 新增 API 列表

| 端点 | 方法 | 响应头 |
|---|---|---|
| `/api/inspect/translate` | POST (extended) | 原 7 + `X-Translate-Mode` `X-Translate-Words` `X-Translate-Glossary-Hits` `X-Translate-TM-Hits` `X-Job-Id` |
| `/api/inspect/translate/progress/:jobId` | GET | `X-Job-Id` `X-Job-Last-Seq` `X-Job-Frames` `X-Job-Status` `X-Job-Created-At` |
| `/api/translate/image/batch` | POST | `X-Job-Id` `X-Batch-Total` `X-Batch-Source-Lang` `X-Batch-Target-Lang` (HTTP 202) |
| `/api/translate/image/batch/:jobId` | GET | 同 progress |
| `/api/translate/image/batch/:jobId/cancel` | POST | `X-Job-Id` `X-Job-Cancelled-At` |
| `/api/translate/glossary` | POST | `X-Glossary-Id` `X-Glossary-Hits` |
| `/api/translate/glossary` | GET | `X-Glossary-Count` `X-Glossary-Source-Lang` `X-Glossary-Target-Lang` |
| `/api/translate/glossary/import` | POST (multipart) | `X-Glossary-Imported-Count` `X-Glossary-Duplicates` |
| `/api/translate/glossary/:id` | DELETE | `X-Glossary-Removed-Id` |
| `/api/translate/memory` | POST | `X-TM-Id` `X-TM-Score` |
| `/api/translate/memory` | GET | `X-TM-Count` `X-TM-Match-Score` |
| `/api/translate/memory/:id` | DELETE | `X-TM-Removed-Id` |
| `/api/inspect/translate/export` | GET | `X-Export-Format` `X-Export-Pages` `X-Export-Source-Lang` `X-Export-Target-Lang` `Content-Disposition` |

## 新增前端组件树

```
web/src/
├── hooks/
│   ├── useTranslateJob.ts          (1s JSONL 轮询 + cancel)
│   ├── useGlossary.ts              (CRUD + localStorage 缓存)
│   ├── useTranslationMemory.ts     (CRUD + 250ms debounce lookup)
│   └── useImageBatch.ts            (包装 batch API + 复用 useTranslateJob)
├── components/
│   ├── ProgressRing.tsx            (SVG 圆环 0.6s ease-out)
│   ├── DocTranslateProgress.tsx    (进度环 + ETA + chips + 取消)
│   ├── DocTranslateTaskPanel.tsx   (文件网格 + 格式勾选)
│   ├── DocTranslateGlossaryPanel.tsx (术语列表 + CSV 导入)
│   ├── DocTranslateMemoryPanel.tsx (TM 列表 + 阈值滑块)
│   ├── DevHeaderBadge.tsx          (?dev=1 观测头显示)
│   ├── ConfidenceDot.tsx           (绿/黄/红 三档)
│   ├── ImageRegionSvgOverlay.tsx   (从 OCRPage 抽出，bbox + hover + 扫光)
│   ├── ImageDualView.tsx           (叠加/并排/原图 三档)
│   ├── DictionaryCard.tsx          (浮动卡片 + Esc/⌘+Enter)
│   └── ImageBatchQueue.tsx         (多选 + 状态 pill)
└── pages/
    └── ImageTranslateMode.tsx      (拆分出来便于测试)
```

## TDD 顺序 + 测试矩阵

| 阶段 | 测试文件 | 用例 |
|---|---|---|
| A.1 jobs+glossary | `translate-jobs.test.mjs` `translate-glossary.test.mjs` | 11 + 15 |
| A.1 memory+export | `translate-memory.test.mjs` `translated-export.test.mjs` | 12 + 12 |
| A.2/A.3 路由 | `translate.jobProgress.test.mjs` `router-translate-extended.test.mjs` | 8 + 20 |
| A.5 batch | `translate-image-batch.test.mjs` | 14 |
| B doc frontend | `useTranslateJob` `useGlossary` `useTranslationMemory` `ProgressRing` `DocTranslateProgress` `DocTranslateTaskPanel` `DocTranslateGlossaryPanel` `DocTranslateMemoryPanel` `DevHeaderBadge` `DocTranslateMode` | 10+8+6+8+8+7+5+4+4+7 = 67 |
| C image frontend | `ConfidenceDot` `ImageRegionSvgOverlay` `DictionaryCard` `ImageDualView` `ImageBatchQueue` `useImageBatch` `ImageTranslateMode` (×2) | 8+14+13+11+10+7+12+5 = 80 |
| D E2E | `translate-docx-progress` `translate-docx-cancel` `translate-docx-glossary` `translate-docx-tm` `translate-image-bbox` `translate-image-batch` `translate-image-viewmode` `translate-image-dictionary-card` `translate-headers-observability` + extended `design-regression` `reduced-motion-audit` | 3+3+4+3+4+3+3+2+10 + 2+2 = 37 |
| **总计** | | **Server 92 / Frontend 147 unit + 37 e2e** |

## 验收截图（自动生成）

Phase D 生成的 6 个基线快照 + Playwright `__snapshots__/` 目录共 16 张 PNG。

## 已知遗留

| 项目 | 详情 |
|---|---|
| OCRPage 死代码 `doOCR` | 未清理（Phase 4+ 工作，与本功能解耦） |
| `tokens.ts` COLORS/STATUS_COLORS 迁移 | 未做（沿用 `var(--color-*)` 新 token） |
| Server 并行测试 isolation | 3 个 multi-pair glossary 测试在 `--no-file-parallelism` 下全绿；并行偶发（已记录） |
| DevHeaderBadge 全局 fetch 拦截 | 仅暴露 `recordDevHeaders` API，未自动 hook `window.fetch`（避免破坏测试 mock） |
| Image translate UI E2E skip | 部分 image 测试在 store 为空时 skip，需先 navigate `/files` 触发 `fetchTasks` |
| TranslationLayout 嵌入 | DocTranslateMode 当前以 `<pre>` 渲染结果（Phase B agent 决策）；按需可切回 `<TranslationLayout externalJobId>` |
| 双语 PDF | 通过扩 `ocr-pdf.mjs` 实现；50+ 页大文档未做 LRU 缓存（按 `(taskId, page, format)` key） |

## 子阶段详细文档

每个子阶段（Phase A.1 / A.2-A.3 / A.5 / B / C / D）都有独立的 `phase-*.md` 详细报告：
- `phase-a1-translate-jobs-and-glossary.md`
- `phase-a1-translate-memory-export.md`
- `phase-a2-a3-translate-routes.md`
- `phase-a5-translate-image-batch.md`
- `phase-c-image-translate-frontend.md`
- `phase-d-e2e-visual-smoke.md`

## 端到端 smoke

```bash
node office-preview-app/web/scripts/smoke-translation-modules.mjs
# 11/11 steps passed in ~65s
```

## 验收命令

```bash
# Server
cd office-preview-app/server && npx vitest run --no-file-parallelism

# Frontend
cd office-preview-app/web && npm test -- --run && npm run build

# E2E
cd office-preview-app/web && npm run e2e

# Smoke
node office-preview-app/web/scripts/smoke-translation-modules.mjs
```