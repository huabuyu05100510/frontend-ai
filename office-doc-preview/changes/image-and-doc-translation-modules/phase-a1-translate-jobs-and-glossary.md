# Phase A.1: translate-jobs + translate-glossary server modules

> Branch: feature/image-and-doc-translation
> Date: 2026-07-01
> Author: Claude (claude-sonnet-4-6)
> TDD: tests-first, 26 tests red → green → refactor

## 目的

为图片翻译 + 文档翻译两条新流水线打下两个基础模块：

1. **`server/src/translate-jobs.mjs`** — 每 job 的 JSONL 帧日志（进度 / 取消 / 暂停回放）
2. **`server/src/translate-glossary.mjs`** — CSV 导入的术语表（翻译一致性的受控注入）

两个模块都参考现有 `workspace-timeline.mjs` 的同款模式（200 上限 / 10k 行归档 / 原子写入 / ISO 日志），保证全栈可观测性一致。

## 公开 API（与路由层契约对齐）

### translate-jobs
```js
appendFrame({ jobId, kind, payload }) → { seq, ts, tsIso, jobId, kind, payload }
tailFrames({ jobId, sinceSeq = 0 })    → Frame[]   // 升序，seq > sinceSeq
getJob({ jobId })                      → { jobId, createdAt, lastSeq, frameCount, status } | null
isJobCancelled({ jobId })              → boolean
clearJob({ jobId })                    → boolean    // 测试隔离
```

帧类型（`kind`）：`started | page-done | ocr-done | image-done | finished | failed | cancelled | paused | resumed`

### translate-glossary
```js
parseCsv(buffer | string) → Array<{ source, target, pos?, note? }>  // UTF-8 BOM 安全
appendTerm({ sourceLang, targetLang, source, target, pos?, note? }) → { id, ... }
listTerms({ sourceLang, targetLang }) → Term[]  // 按 source 长度降序
deleteTerm({ id, sourceLang, targetLang }) → boolean
matchTerm(text, terms)  → Array<{ term, translation, start, end }>   // 长词优先 + 大小写不敏感
applyGlossary(text, terms) → string   // 右到左替换，保留其它字符
countTerms({ sourceLang, targetLang }) → number
clearGlossary({ sourceLang, targetLang }) → boolean
```

## 持久化布局

```
.data/derived/
  translate-jobs/<safeJobId>.jsonl           # 每 job 一份；超过 200 帧截顶；10k 行归档
  glossaries/<safeSrcLang>_<safeTgtLang>.jsonl   # 每语言对一份；同上截顶/归档
```

- 文件名安全化：`replace(/[^\w-]/g, '_')`（防路径穿越 / 兼容中文）
- 写入：先读全部 → JSON.stringify → tmp + rename（原子）
- 截顶：保留最新 N 条（按 `ts` / `seq` 排序）
- 归档：超过 10_000 行时整文件 rename 为 `<file>.<ts>.jsonl`，新建空文件继续

## 可观测性

每次 `appendX` / `deleteX` / `clearX` 都打印一行 ISO 时间戳日志，便于服务端 grep：

```
[translate-jobs 2026-07-01T19:54:05.012Z] append jobId=job_concurrent_<ts> seq=49 kind=image-done
[translate-glossary 2026-07-01T19:55:22.547Z] append zh-CN->en id=glo_<hash> "公司"→"company"
[translate-jobs 2026-07-01T19:53:50.561Z] rotated jobId=job_rotate_<ts> → job_rotate_<ts>.<rotTs>.jsonl (lines=10000)
```

下游路由层将通过响应头暴露：
- `X-Job-Sequence`、`X-Job-Status`、`X-Job-Cancelled`
- `X-Glossary-Terms`、`X-Glossary-Hits`

## TDD 时间线

1. 写测试（red）：`test/translate-jobs.test.mjs` (11 cases) + `test/translate-glossary.test.mjs` (15 cases) — 26 全部 FAIL（模块不存在）
2. 实现模块（green）：复用 `workspace-timeline.mjs` 的 storage primitives，加上业务字段（`seq`, `kind`, `payload` / `source`, `target`, `pos`, `note`）
3. refactor：抽出 `safeJobId` / `safeLang` / `appendRaw` 等公共概念；命名与现有约定对齐

## 测试覆盖亮点

- **原子性**：50 次同步 `appendFrame`，seq 必严格 1..50 且无重复帧
- **cap 行为**：201 帧写入后只剩 200，且 seq=2..201（最早被丢）
- **rotation 行为**：seed 10_000 行后下一次 appendRaw 触发归档
- **bad jobId 防护**：`../etc/passwd` → 沙箱内 `__etc_passwd.jsonl`，无 `..` 段
- **CSV 解析**：BOM / embedded commas / multi-line cells / missing columns
- **matchTerm 重叠**：3 个不同长度 candidate 同起点时，长词胜出
- **applyGlossary 多处命中**：右到左替换，避免索引错位
- **多语言对隔离**：zh-CN→en 和 zh-CN→ja 互不影响（独立 JSONL 文件）

## 不在本次范围（待 Phase A.2/A.3 路由层接入）

- `router.mjs` 注册 `/api/translate/jobs/...` + `/api/translate/glossary/...` 路由
- 前端 `pages/TranslationPage` / `OCRPage` / 文档翻译面板 消费 API + 高亮术语

## 验证

```bash
cd office-preview-app/server
npx vitest run test/translate-jobs.test.mjs test/translate-glossary.test.mjs
# 26 passed

npx vitest run
# 469 passed (全套)
```
