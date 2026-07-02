# Phase A.1 — translate-memory + translated-export 实现

> 模型：claude-sonnet-4-6
> 日期：2026-07-01
> 分支：`feature/design-overhaul`
> 任务范围：图片翻译 + 文档翻译 后端模块（Phase A.1 / Agent 2）

---

## Context

依据 `plans/smooth-weaving-wilkes.md`，Phase A.1 拆分 5 个后端模块给多 agent 并行实现。本 agent 负责其中 2 个：

1. **`translate-memory.mjs`** — 翻译记忆库（TM）CRUD + bigram Jaccard 模糊匹配
2. **`translated-export.mjs`** — 双语 / 译文 DOCX + PDF 输出

依赖已通过 `npm install docx@^9.5.0 csv-parse@^5.6.0 jszip@^3.10.1` 装齐，本 agent 仅使用 `docx` 与 `jszip`（pdf 生成复用 `ocr-pdf.mjs`）。

---

## 交付物

### 文件清单

| 文件 | 行数 | 内容 |
|---|---|---|
| `office-preview-app/server/src/translate-memory.mjs` | ~230 | TM CRUD + bigram Jaccard |
| `office-preview-app/server/src/translated-export.mjs` | ~390 | DOCX (docx 库) + PDF (ocr-pdf 模式) |
| `office-preview-app/server/test/translate-memory.test.mjs` | 12 cases | scoreSimilarity + CRUD + 排序 + 阈值 |
| `office-preview-app/server/test/translated-export.test.mjs` | 12 cases | DOCX/PDF 魔数 + 内容 + 性能 |

### 1. translate-memory.mjs

**公开 API**（7 个函数）：
- `scoreSimilarity(a, b)` — bigram Jaccard（镜像 `template-matcher.mjs` 的 `textSimilarity`）
- `addTmEntry({sourceLang, targetLang, source, target, context?})` — 返回带 id/ts 的新条目
- `lookupTm({sourceLang, targetLang, query, threshold=0.7, limit=5})` — 按 score DESC
- `deleteTmEntry({id, sourceLang, targetLang})` — 按 id 删除
- `listTm({sourceLang, targetLang, limit=200})` — 倒序最新优先
- `countTm({sourceLang, targetLang})` — 条目数
- `clearTm({sourceLang, targetLang})` — 测试隔离 / 管理面板

**持久化**（复刻 `workspace-timeline.mjs` 模式）：
- `DERIVED_DIR/translation-memory/<src>_<tgt>.jsonl`
- 200 条上限（append 时移除最旧）
- 单文件 10k 行轮转：归档为 `<src>_<tgt>.<ts>.jsonl`，新建空文件继续
- 原子写入：`tmp` + `rename`
- malformed 行跳过 + warn，不抛错
- `safeLang(lang)` 防路径穿越：`/[^\w.-]/g → _`
- 所有公开函数带 ISO 时间戳日志

### 2. translated-export.mjs

**公开 API**（3 个 Promise<Buffer> 函数）：
- `generateBilingualDocx({pages, sourceLang, targetLang, taskName?})`
- `generateBilingualPdf({pages, sourceLang, targetLang, taskName?})`
- `generateTranslationOnlyPdf({pages, targetLang, taskName?})`

**DOCX 设计**（使用 `docx` 库）：
- 每页一个 Table（2 列：Source / Target + 表头灰底）
- 原文黄底（`FCE08B`）、译文蓝底（`D7E8FF`）
- 标题：`Translation: <taskName>`（heading 1 + 居中）
- 每页小标题：`Page N`（heading 2）
- 特殊字符 `< > & " '` 由 `docx` 自动转义为 XML 实体（测试验证 `<script>` → `&lt;script&gt;`）
- 完整 OOXML zip：`word/document.xml`、`docProps/core.xml` 等

**PDF 设计**（复刻 `ocr-pdf.mjs` 模式）：
- 多页支持：每页一对 (Page obj + Content stream obj)，共享 Catalog/Pages/Font
- 双语 PDF：两列布局（原文左 + 译文右），浅黄/浅蓝背景矩形
- 译文-only PDF：单栏 target 文本 + 页眉 `Page N` + `Target: <lang>` 标签
- 零依赖纯 Node Buffer：`%PDF-1.4` 头 + `xref` 表 + `trailer`
- UTF-16BE BOM 支持 CJK / Emoji：`escapePdfString` 自动选择 latin-1 literal 或 hex string
- PDF magic：`%PDF-1.4`（实测 `25 50 44 46 2d 31 2e 34`）

---

## TDD 验证

### 24 个新测试全部通过

```
$ npx vitest run test/translate-memory.test.mjs test/translated-export.test.mjs
 ✓ test/translate-memory.test.mjs (12 tests) 16ms
 ✓ test/translated-export.test.mjs (12 tests) 88ms
 Test Files  2 passed (2)
      Tests  24 passed (24)
```

**translate-memory 12 case**：
- `scoreSimilarity` 5 例（identical / disjoint / empty / <2 chars / partial）
- CRUD 7 例（round-trip / threshold / sort DESC / count / clear / limit / context）

**translated-export 12 case**：
- DOCX 6 例（ZIP 魔数 / `word/document.xml` 存在 / 2 段落每页 / 特殊字符转义 / 50×1000 < 5s / taskName in core.xml）
- 双语 PDF 3 例（`%PDF-` magic / 内容 / taskName UTF-16BE hex 校验）
- 译文-only PDF 3 例（magic / target 内容 / taskName）

### 完整回归（排除其他 agent in-progress 工作）

```
$ npx vitest run --exclude "**/translate-glossary.test.mjs" --exclude "**/translate-jobs.test.mjs"
 Test Files  36 passed (36)
      Tests  443 passed (443)
```

未引入回归（其他 agent 的 `translate-glossary.test.mjs` 和 `translate-jobs.test.mjs` 失败属 pre-existing）。

---

## 实测输出样本

### DOCX 字节（首 80 字节）
```
50 4b 03 04 0a 00 00 00 00 00 c8 5e e1 5c 00 00 00 00 00 00 00 00 00 00 00 00 05 00 00 00 77 6f 72 64 2f 50 4b 03 04
```
→ `PK\x03\x04`（ZIP 本地文件头魔数），第一项即 `word/` 目录

### DOCX 内部结构
```
[
  'word/_rels/document.xml.rels',
  'word/document.xml',     ← 主文档
  'word/styles.xml',       ← 样式表
  'docProps/core.xml',     ← 含 taskName
  'word/numbering.xml',
  '[Content_Types].xml',
  ...
]
```

### PDF 字节（首 60 字节）
```
25 50 44 46 2d 31 2e 34 0a 25 e2 e3 cf d3 0a 31 20 30 20 6f 62 6a 0a 3c 3c 20 2f 54 79 70 65 20 2f 43 61 74 61 6c 6f 67
```
→ `%PDF-1.4\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog`（PDF 头 + 二进制提示 + 第 1 对象 Catalog）

### PDF 尾（末 80 字节）
```
... 30 30 30 30 30 20 6e 20 0a 74 72 61 69 6c 65 72 0a 3c 3c 20 2f 53 69 7a 65 20 37 20 2f 52 6f 6f 74 20 31 20 30 20 52 20 2f 49 6e 66 6f 20 36 20 30 20 52 20 3e 3e 0a 73 74 61 72 74 78 72 65 66 0a 31 31 32 34 0a 25 25 45 4f 46 0a
```
→ `...trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n1124\n%%EOF\n`

---

## 关键设计取舍

| 取舍 | 选择 | 理由 |
|---|---|---|
| DOCX 实现 | `docx` 库（`Packer.toBuffer`）| 业界标准；声明式 API；自动处理 OOXML 实体 |
| PDF 实现 | 扩 `ocr-pdf.mjs` 模式（零依赖）| 已稳定的内建 PDF 生成器；UTF-16BE BOM 支持 CJK |
| DOCX 背景色 | 6 位 hex（`FCE08B` / `D7E8FF` / `E6E6E6`）| `docx` 的 `hexBinary(val, 3)` 要求 3 字节 RGB |
| PDF 多页 | 每页独立 Page obj + Content stream obj 共享 Catalog/Pages | 比单 content 长流更灵活 |
| TM 相似度算法 | bigram Jaccard | 与 `template-matcher.mjs` 一致；OCR 容错友好（标点 / 大小写） |
| TM 排序规则 | score DESC → 同分按 ts DESC | 更相关 / 更新 的优先 |
| TM 路径安全 | `safeLang()` 替换 `/\W/g → _` | 防 `../../` 穿越 |

---

## 已知遗留 / 后续 Phase

- **路由层**：本 agent 只交付模块，不动 `router.mjs`。Phase A.3（Agent 3）将新增 5 条相关路由：
  - `POST /api/translate/memory`
  - `GET /api/translate/memory`
  - `DELETE /api/translate/memory/:id`
  - `GET /api/inspect/translate/export?format=bilingual-docx|bilingual-pdf|target-pdf`
- **`translate.mjs` 集成**：Phase A.2（Agent 3）将把 `lookupTm` / `applyGlossary` 串到 `translatePagesAsync`
- **DOCX 样式可定制**：当前背景色 / 边框 hardcode；后续可暴露 `theme` 参数
- **PDF 中文字体**：当前用 Helvetica 内建，CJK 字符显示为 `?`；完整 CJK 渲染需嵌字体子集（Phase 5+）

---

## 观测头 / 控制台日志样例

```
[translate-memory 2026-07-01T11:51:01.260Z] create pair=zh-CN→en id=tm_mr20lcazc97bc3 score=1.000 sourceLen=11
[translate-memory 2026-07-01T11:51:01.260Z] lookup pair=zh-CN→en q="foo bar baz" hits=3 threshold=0
[translate-memory 2026-07-01T11:51:01.261Z] remove pair=zh-CN→en id=tm_mr20lcavdd47f3
[translate-memory 2026-07-01T11:51:01.263Z] clear pair=zh-CN→en
```

每条操作都带 ISO 时间戳 + 关键参数，便于在生产环境追踪。