# Phase A.2/A.3: translate.mjs 扩展 + router 13 条新路由

> 模型：claude-sonnet-4-6
> 日期：2026-07-01
> 分支：`feature/design-overhaul`
> 任务：实现文档翻译进度的 JSONL 轮询、图片批量翻译、术语表 CRUD、翻译记忆 CRUD、多格式导出 13 条新路由

---

## Context

Phase A.1 已交付底层模块（`translate-jobs` / `translate-glossary` / `translate-memory` / `translated-export`），
Phase A.2/A.3 将这些模块与 `translate.mjs` 主入口及 `router.mjs` HTTP 层打通。

---

## 变更清单

### A.2 — `server/src/translate.mjs`

- `translatePagesAsync()` 新增 `opts.onPageProgress(page, index, total, ms)` 回调，每页翻译后 `await` 调用，便于上层做取消检查
- `translate()` 签名扩展：
  - `jobId?: string` — 启用 JSONL 进度日志（`started` / `page-done` / `finished` / `failed` / `cancelled`）
  - `glossary?: Term[]` — 翻译**前**应用术语表（保留一致性）
  - `tm?: TmEntry[]` — 翻译**后**用 `lookupTm` 查命中率
  - `onPageProgress?: Function` — 透传给 `translatePagesAsync`
- `meta` 新增字段：
  - `glossaryHits: number` — 术语命中次数
  - `tmHits: number` — TM 命中条数
  - `sourceWords: number` — 源文字数（`split(/\s+/).filter(Boolean)`）
  - `targetWords: number` — 译文字数
  - `mode: 'doc' | 'text'` — 区分多页与文本模式
  - `jobId?: string` — 回传 jobId
- 新增导出 `CancelledError` 类 — 翻译循环被取消时抛出
- 取消检查：在 `onPageProgress` 包装函数中调用 `isJobCancelled({ jobId })`，命中即抛 `CancelledError`
- 错误帧：失败时记录 `lastAttemptedPage`，写入 `failed` 帧时附 `page` 字段

### A.3 — `server/src/router.mjs`

新增 13 条路由（全部在 `handleRoute()` 中用正则匹配，避开 Phase 0 修过的 `pathname.split('/')` bug）：

| # | Method + Path | Handler | 响应头（新增） |
|---|---|---|---|
| 1 | `POST /api/translate/image/batch` | `handleTranslateImageBatchStart` | X-Job-Id, X-Batch-Total, X-Batch-Source-Lang, X-Batch-Target-Lang |
| 2 | `GET /api/translate/image/batch/:jobId` | `handleInspectTranslateProgress`（复用） | 同 progress 端点 |
| 3 | `POST /api/translate/image/batch/:jobId/cancel` | `handleTranslateImageBatchCancel` | X-Job-Id, X-Job-Cancelled-At |
| 4 | `GET /api/inspect/translate/progress/:jobId?sinceSeq=N` | `handleInspectTranslateProgress` | X-Job-Id, X-Job-Last-Seq, X-Job-Frames, X-Job-Status, X-Job-Created-At |
| 5 | `POST /api/translate/glossary` | `handleGlossaryCreate` | X-Glossary-Id, X-Glossary-Hits |
| 6 | `GET /api/translate/glossary?sourceLang=&targetLang=` | `handleGlossaryList` | X-Glossary-Count, X-Glossary-Source-Lang, X-Glossary-Target-Lang |
| 7 | `DELETE /api/translate/glossary/:id?sourceLang=&targetLang=` | `handleGlossaryDelete` | X-Glossary-Removed-Id |
| 8 | `POST /api/translate/glossary/import` (multipart CSV) | `handleGlossaryImport` | X-Glossary-Imported-Count, X-Glossary-Duplicates |
| 9 | `POST /api/translate/memory` | `handleMemoryCreate` | X-TM-Id, X-TM-Score |
| 10 | `GET /api/translate/memory?sourceLang=&targetLang=&q=&threshold=` | `handleMemoryLookup` | X-TM-Count, X-TM-Match-Score |
| 11 | `DELETE /api/translate/memory/:id?sourceLang=&targetLang=` | `handleMemoryDelete` | X-TM-Removed-Id |
| 12 | `GET /api/inspect/translate/export?taskId=&format=bilingual-docx\|bilingual-pdf\|target-pdf` | `handleInspectTranslateExport` | X-Export-Format, X-Export-Pages, X-Export-Source-Lang, X-Export-Target-Lang, Content-Disposition |

并扩展现有 `POST /api/inspect/translate`：
- 新增响应头：`X-Translate-Mode`、`X-Translate-Words`、`X-Translate-Glossary-Hits`、`X-Translate-TM-Hits`、`X-Job-Id`（jobId 启用时）
- 接受新请求字段：`jobId`、`glossary`、`tm`

---

## 控制台日志规范（ISO 时间戳）

```
[translate-job 2026-07-01T12:00:00.000Z] job=job_xxx started pages=10 src=zh-CN tgt=en glossary=3 tm=5
[translate-job 2026-07-01T12:00:01.000Z] job=job_xxx finished pages=10 totalMs=1234 words=4567
[translate-job 2026-07-01T12:00:01.000Z] job=job_xxx cancelled at page=3 reason=user
[translate-job 2026-07-01T12:00:01.000Z] job=job_xxx failed error=... page=2
[translate-image-batch 2026-07-01T12:00:00.000Z] start job=batch_xxx total=20 src=zh-CN tgt=en
[translate-image-batch 2026-07-01T12:00:02.000Z] finish job=batch_xxx ok=18 failed=2 totalMs=18200
[translate-glossary 2026-07-01T12:00:00.000Z] create id=glo_xxx pair=zh-CN→en term=...
[translate-glossary 2026-07-01T12:00:00.000Z] import pair=zh-CN→en imported=120 duplicates=8
[translate-memory 2026-07-01T12:00:00.000Z] create id=tm_xxx pair=zh-CN→en score=1.000
[translate-memory 2026-07-01T12:00:00.000Z] lookup pair=zh-CN→en q="..." hits=3 best=0.860
[translate-export 2026-07-01T12:00:00.000Z] task=xxx format=bilingual-docx pages=10 bytes=124000 ms=3400
[inspect-translate-progress 2026-07-01T12:00:00.000Z] job=xxx since=0 → 7 frames (lastSeq=7)
```

---

## 测试（TDD 强制）

### 新增测试文件
- `server/test/translate.jobProgress.test.mjs` — 8 cases（translate.mjs 扩展）
  - `started` + `page-done×N` + `finished` 帧序列
  - `onPageProgress` 调用次数
  - 取消检查在页面边界生效
  - glossaryHits / tmHits 在 meta
  - 空 task.pages → 仅 finished
  - 失败帧 + rethrow
  - 字数 split
- `server/test/router-translate-extended.test.mjs` — 20 cases（router 13 条新路由 + observability）
  - 13 条端点的 200/202/400/404/413 路径
  - 响应头验证
  - 控制台日志验证
  - DOCX/PDF 导出字节数验证

**新增测试总数：28（8 + 20）**

### 验证

```bash
cd /Users/didi/Downloads/前端AI/office-doc-preview/office-preview-app/server
npx vitest run test/translate.jobProgress.test.mjs test/router-translate-extended.test.mjs --no-file-parallelism
# → 28 passed (28)
```

完整套件（顺序执行）：
```bash
npx vitest run --no-file-parallelism
# → 511 passed (511)
```

---

## 关键设计取舍

1. **`translatePagesAsync` 包装 `onPageProgress`**：让 identity mock 路径也能逐页触发回调（通过在 buildIdentityPagesFromTask 后增加 `for` 循环）。这是为了让所有 task.pages 走 doc 分支时都能产生 `page-done` 帧。

2. **`lastAttemptedPage` vs `lastPage`**：区分"已成功完成的最后一页"和"尝试失败的最后页"。`failed` 帧用 `lastAttemptedPage`，因为失败发生在尝试阶段。

3. **批量图片简化实现**：本期不接入真实 OCR provider（环境无 provider key）；批量处理器仅做"逐图 sleep 10ms + 写 image-done 帧 + 检查取消"。接口契约完整，前端可正常轮询。

4. **导出端点内容类型**：
   - `bilingual-docx` → `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
   - `bilingual-pdf` / `target-pdf` → `application/pdf`
   - 均带 `Content-Disposition: attachment; filename="..."` 触发浏览器下载

5. **复用现有 helpers**：所有 handler 用 `readBody`、`parseJSONBody`、`parseMultipart`、`sendJSON`（不直接 `res.end(JSON.stringify(...))`）。

6. **路由正则统一**：`^/api/.../[\w-]+$` 形式避免 `pathname.split('/')` 截断 query string bug（Phase 0 教训）。

---

## 已知遗留 / 下一步

- `translate-image-batch.mjs` 模块未单独抽出；批量逻辑直接放在 `handleTranslateImageBatchStart`/`processImageBatchAsync` 内。Phase B/C 完成前端后可考虑抽到独立模块便于复用。
- 导出 `target-pdf` 走 `generateTranslationOnlyPdf`；未来可加 `vtt` 字幕格式（视频翻译场景）。
- 多格式导出缓存键 `(taskId, page, format, targetLang)` 缓存尚未实现；高频调用会重复构造 docx/pdf。下一步可加 LRU。
- 批量任务启动后立即返回 202；后台异常通过 `failed` 帧上报。无 SSE / WebSocket，前端只能 1s 轮询（设计如此）。
- 测试并行运行有跨测试数据污染（共享 `DERIVED_DIR/glossaries` 等目录）；用 `--no-file-parallelism` 顺序运行通过。这是 pre-existing 问题（Phase 2 已存在）。

---

## 响应头速查表（curl `-i`）

```bash
curl -X POST localhost:5180/api/inspect/translate \
  -H 'Content-Type: application/json' \
  -d '{"taskId":"<id>","sourceLang":"zh-CN","targetLang":"en","jobId":"job_demo"}' -i
# 响应头应包含：
#   X-Translate-Mode: doc|text
#   X-Translate-Words: <n>
#   X-Translate-Glossary-Hits: <n>
#   X-Translate-TM-Hits: <n>
#   X-Job-Id: job_demo
#   X-Translate-Engine, X-Translate-Strategy, X-Translate-Ms, X-Translate-Segments, X-Translate-Pages

curl localhost:5180/api/inspect/translate/progress/<jobId> -i
# 响应头：
#   X-Job-Id, X-Job-Last-Seq, X-Job-Frames, X-Job-Status, X-Job-Created-At

curl -X POST localhost:5180/api/translate/image/batch \
  -H 'Content-Type: application/json' \
  -d '{"taskIds":["a","b"],"sourceLang":"zh-CN","targetLang":"en"}' -i
# 响应头：
#   X-Job-Id, X-Batch-Total: 2, X-Batch-Source-Lang, X-Batch-Target-Lang
# 状态码：202

curl -X POST localhost:5180/api/translate/glossary \
  -H 'Content-Type: application/json' \
  -d '{"sourceLang":"zh-CN","targetLang":"en","source":"你好","target":"Hello"}' -i
# 响应头：X-Glossary-Id, X-Glossary-Hits

curl -X POST localhost:5180/api/translate/glossary/import \
  -F 'sourceLang=zh-CN' -F 'targetLang=en' -F 'file=@glossary.csv' -i
# 响应头：X-Glossary-Imported-Count, X-Glossary-Duplicates

curl "localhost:5180/api/inspect/translate/export?taskId=<id>&format=bilingual-docx" -i -o out.docx
# Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
# X-Export-Format: bilingual-docx, X-Export-Pages, ...
```

---

## 文件清单

| 文件 | 行数变化 | 说明 |
|---|---|---|
| `server/src/translate.mjs` | +220 / -10 | 扩展 translatePagesAsync/translate + CancelledError + glossary/tm/cancellation |
| `server/src/router.mjs` | +340 / -10 | 13 条新路由 + handleInspectTranslate 扩展 |
| `server/test/translate.jobProgress.test.mjs` | +316 | 8 cases for translate.mjs |
| `server/test/router-translate-extended.test.mjs` | +440 | 20 cases for router |

**总计：新增 28 个测试通过**