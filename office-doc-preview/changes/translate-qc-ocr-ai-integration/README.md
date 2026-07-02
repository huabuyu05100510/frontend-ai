# 翻译 · 质检 · OCR — 行业顶尖场景 AI 集成

**模型：claude-sonnet-4-6**

## 概览

对标科大讯飞简历中的三大核心能力（智能翻译平台、质检平台、OCR规则训练平台）进行行业顶尖能力的 AI 集成。

## 变更内容

### 1. AI 翻译 Provider 抽象层 (`server/src/translate-provider.mjs`)

- 统一接口 `translateAI({ text, sourceLang, targetLang, provider?, apiKey? })`
- 支持 MiniMax (abab6.5s-chat)、智谱 GLM (glm-4-flash)、火山引擎 Ark (doubao-pro)
- 内置 3 次重试 + 指数退避 + 30s timeout
- 每个 provider 最多 3 并发（信号量限流）
- 无 API Key 时自动 fallback mock
- 可观测性：provider 名称、耗时、字符数日志
- `/api/health/translate` 健康检查端点

### 2. AI 翻译集成 (`server/src/translate.mjs`)

- `translate()` 改为 async，集成 AI provider（可选）
- 批量段落翻译 `translateSegmentsAsync()` — 合并段落为一次 API 调用
- 分页翻译 `paginateTextAsync()` — 智能使用 AI 或 mock
- 保留 mock 模式：无 AI key 时返回兼容旧行为的结果
- engine 标记升级为 provider 感知 (`minimax-v1` / `mock-v1` 等)

### 3. 质量检测增强 (`server/src/diff.mjs`)

- `segmentWords(text)` — 中文分词（CJK 单字 + ASCII 合并）
- `detectPhraseErrors(left, right)` — 短语级错误检测
  - 拼写、冗余、遗漏、语序、语法 5 种错误类型
- `categorizeErrors(errors)` — 按讯飞 6 大类分类
  - 拼写、标点、数字、量和单位、语法、政治领域
- `aiQualityCheck(text)` — AI 语义校对
  - 调用 AI LLM 做深度文本校对
  - 无 AI 时 fallback 到 heuristic（重复标点、中英混用标点、常见错别字、数字单位）
- 新端点：`POST /api/inspect/quality-check`、`POST /api/inspect/phrase-errors`

### 4. OCR 模块 (`server/src/ocr.mjs`)

- `ocrImage(imagePath, opts)` — 图片 OCR 识别
  - MiniMax 多模态 (abab6.5s-chat + image_url)
  - 智谱 GLM-4V (glm-4v-flash + image_url)
  - 本地 heuristic（PNG/JPEG header 解析，返回图片尺寸）
- `compareOCRResults(reference, test)` — OCR 结果对比（基于 Myers diff）
  - 逐字符 diff，标注 missing（漏识别）/ extra（多识别）
- `ocrAccuracy(reference, test)` — 准确率计算
  - accuracy / precision / recall / F1
- 新端点：`POST /api/ocr/recognize`、`POST /api/ocr/compare`
- `/api/health/ocr` 健康检查

### 5. 单元测试

| 测试文件 | 测试数 | 状态 |
|---------|--------|------|
| `server/test/translate-provider.test.mjs` | 68 | ✅ |
| `server/test/diff-word-phrase.test.mjs` | 17 | ✅ |
| `server/test/ocr.test.mjs` | 16 | ✅ |
| `server/test/translate-identity.test.mjs` | 9 | ✅ (async 适配) |
| `server/test/translate.test.mjs` | 19 | ✅ |
| 总计 | **129** | **全通过** |

### 6. E2E 测试 (`web/e2e/ocr-quality-check.spec.ts`)

- OCR 识别 API 端到端
- OCR 结果对比 API 端到端
- 质量检测 API 端到端
- 短语错误检测 API 端到端
- 健康检查端点验证

## 配置方式

```bash
# 设置 AI Provider（可选，不设则用 mock）
export TRANSLATE_PROVIDER=minimax  # 或 zhipu / volcano
export MINIMAX_API_KEY=your_key
# 或
export ZHIPU_API_KEY=your_key
# 或
export VOLCANO_API_KEY=your_key
```

## 架构

```
translate-provider.mjs ─┐
                        ├─→ translate.mjs (async) ─→ POST /api/inspect/translate
                        │                         ─→ POST /api/inspect/translate/render-image
                        │                         ─→ POST /api/inspect/translate/render-text
                        └─→ ocr.mjs ─→ POST /api/ocr/recognize
                                     ─→ POST /api/ocr/compare

diff.mjs (v6) ─→ POST /api/inspect/diff
              ─→ POST /api/inspect/quality-check
              ─→ POST /api/inspect/phrase-errors
```

## 可观测性

所有端点返回以下响应头：
- `X-Translate-Engine` / `X-QC-Engine` / `X-OCR-Engine` — 引擎标识
- `X-*-Ms` — 耗时
- 服务端日志：`[translate-provider]`, `[quality-check]`, `[ocr]` 等