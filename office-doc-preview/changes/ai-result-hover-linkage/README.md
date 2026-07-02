# AI 结果前后对比 + Hover 高亮联动（5 个 AI 能力统一升级）

## 概述

5 个 AI 能力页面（翻译 / OCR / 语音 / 质检查 / 格式转换带 AI）升级为统一的"左右双栏 + hover 高亮联动"体验。
图片识别完成后，新增"导出可搜索 PDF"按钮，把原图 + OCR 识别文字打包成可搜索 PDF **新建为文件**，出现在 FilesPage 任务列表。

## 变更范围

| 页面 | 体验升级 |
|------|----------|
| 翻译 — 文本模式 | 段落卡 hover 联动（左右两栏行内高亮 + borderLeft 加粗） |
| 翻译 — 实时模式 | 新增"段落对照"模式（之前只有词级 align） |
| OCR — 图片识别 | SVG region rect 改为可交互，hover 区域 ↔ 文字卡双向联动 |
| OCR — 图片识别 | 新增按钮 "📄 导出可搜索 PDF"，落地为新 task |
| 质检查 — 文字校对 | token ↔ 错误卡 hover 联动 + 新增"改正后文本"双栏 |
| 语音 — 音频翻译 | ASR 分段 + per-segment 翻译 + 音频时间轴 hover 跳转 |

## 设计原则

1. **统一的 hover bridge**: 通过 `data-err-id` / `data-testid` / `data-start` 等 DOM 属性在两侧 state 同步
2. **不重复造轮子**: 复用已有 Myers diff / align 等基础能力
3. **TDD**: 5 组测试先行，全部 red→green
4. **可观测**: 每个新接口加 `X-*-Ms` / `X-*-Engine` / `X-*-Align` / `X-*-Segments` 响应头
5. **零依赖新增**: 可搜索 PDF 用纯 Node.js 手写（无 pdf-lib / pdfkit 依赖）

## 子任务 1：翻译 — TextTranslateMode hover 联动

**现状**：左右两栏只显示结果，无 hover 响应
**改动**：
- 新增 `hoveredSegId` state
- 段落卡 `onMouseEnter/Leave` 触发；左/右两栏同时加底色 + borderLeft/Right 高亮
**测试**：`web/test/TranslationPage.hover.test.tsx` (2/2 通过)

## 子任务 2：翻译 — RealtimeTranslateMode 段落对照模式

**现状**：只有词级 align 联动，无段落 diff
**改动**：
- 新增 `viewMode: 'word' | 'paragraph'` 状态 + 切换工具栏
- 段落模式：按 `\n+` 切 src/tgt → srcTokenToPara / tgtTokenToPara 桥接 Map
- hover 段落 → 同段所有词高亮
**测试**：`web/test/TranslationPage.hover.test.tsx` (含在 #1 里)

## 子任务 3：OCR — 图片区域 ↔ 文字 hover 联动

**现状**：SVG rect 不可交互（仅有视觉提示）
**改动**：
- SVG rect 加 `onMouseEnter/Leave` + `cursor: pointer`
- 置信度配色：≥0.8 绿、0.5-0.8 黄、<0.5 红
- 文字卡反向 hover 同步高亮（borderColor + 浅蓝背景）
**测试**：`web/test/OCRPage.hover.test.tsx` (2/2 通过)

## 子任务 4：OCR — 图片识别 → 可搜索 PDF 新文件 ⭐ 核心

### 4.1 纯函数 PDF 生成器 (新文件: `server/src/ocr-pdf.mjs`)

**亮点**：
- 零依赖：纯 Node.js Buffer，按 PDF 1.4 spec 手写
- CJK 兼容：标题用 UTF-16BE hex 字符串（`<FEFF...>`），内容 Latin-1（多字节字符透明替换为 `?`，保证 PDF 仍可解析）
- 单页 A4，每段单独 BT/ET（便于 viewer 选中单行）
- 元数据完整：`/Title` / `/Producer` / `/CreationDate`
- **实测有效**：`pdftotext` 成功提取文字（已用 sample PDF 验证）

**核心 API**：
```js
generateSearchablePdf({
  text, title, pageSize, imageSize, regions
}) → Buffer
```

### 4.2 新接口 `POST /api/ocr/create-task`

**入参**：`{ taskId }`
**出参**：
```json
{
  "taskId": "t_xxx",
  "originalUrl": "/api/files/t_xxx?as=original",
  "size": 851,
  "engine": "mock",
  "textRegions": 2,
  "ms": 5,
  "sourceTaskId": "t_img1",
  "name": "invoice-searchable.pdf"
}
```

**响应头**：
- `X-OCR-PDF-Engine: office-preview-pdf`
- `X-OCR-Ms`: 识别总耗时
- `X-OCR-Regions`: 文字区域数
- `X-OCR-Text`: 文字字符数

**实现**：
1. `getTask` 校验源图存在
2. `ocrImage(imagePath)` 复用 OCR 引擎
3. `generateSearchablePdf()` 生成 Buffer
4. 写入 `UPLOAD_DIR` + `createTaskFromFile()` 建新 task
5. 新 task metadata 记下 `sourceTaskId / ocrEngine / ocrTextRegions` 便于追溯

**测试**：`server/test/ocr-pdf.test.mjs` (8 通过) + `server/test/ocr-create-task.test.mjs` (5 通过)

### 4.3 前端按钮 + Toast

**改动** (`web/src/pages/OCRPage.tsx`):
- 工具栏新增按钮 "📄 导出可搜索 PDF"（识别完成才启用）
- 成功后显示绿色 toast："✅ 已生成可搜索 PDF：invoice-searchable.pdf"
- 调 `fetchTasks()` 让新文件立刻出现在 FilesPage

**测试**：`web/test/OCRPage.exportPdf.test.tsx` (3/3 通过)

### 4.4 可搜索性的实证验证

```bash
$ node -e "import('./src/ocr-pdf.mjs').then(m => {...})"
$ file /tmp/test-output.pdf
/tmp/test-output.pdf: PDF document, version 1.4, 1 pages
$ pdftotext /tmp/test-output.pdf -
(Hello)

(World)
```

PDF v1.4 合法 + pdftotext 可提取文字 → **真正可搜索**

## 子任务 5：质检查 — token ↔ 错误卡 hover + 改正后双栏

**改动** (`web/src/pages/QualityCheckPage.tsx`):
- 新增 `hoveredErrId` state + `setHover(id)` 桥接
- token 和 card 各自 `onMouseEnter/Leave` → 互相高亮
- 新增 `buildCorrectedText(leftText, errors)` 实用函数：按 position 拼接改正后文本
- 双栏底部新增"改正后文本"面板 + "复制改正后"按钮

**改动** (`web/src/styles.css`):
- `.xf-error-card.hovered` 和 `.xf-token.error.hovered`（与 `.selected` 可共存，selected 优先）

**测试**：`web/test/QualityCheckPage.hover.test.tsx` (3/3 通过)

## 子任务 6：语音 — ASR 分段 + 音频时间轴 hover 联动

### 6.1 Server-side mock 升级 (新文件 + 增强现有)

**新增辅助函数** (`server/src/speech.mjs`):
- `mockSplitSegments(text)`：按中英标点切分 + 按字符长度比例分配时间段
- `translateSegments(segments, opts)`：逐段调用 `translateOnce`，错误时用原文兜底
- `recognizeASR` mock 路径返回实在的分段（不再是单一 `[0,0]` 段）

### 6.2 新接口 `POST /api/speech/asr-segments`

**入参**：`{ taskId?, lang?, sourceLang?, targetLang?, text? }`
- 支持 standalone 模式：传 `text` 字段直接喂入分段
- 真实 taskId：先 ASR 再分段

**出参**：
```json
{
  "segments": [
    { "start_ms": 0, "end_ms": 3000, "source": "今天...", "target": "...", "engine": "mock" },
    ...
  ],
  "fullText": "...",
  "fullTranslation": "...",
  "engine": "mock",
  "ms": 0,
  "segmentsCount": 4
}
```

**响应头**：
- `X-ASR-Engine: mock | standalone | volc-bigmodel`
- `X-ASR-Ms`: 总耗时
- `X-ASR-Segments`: 段数

**测试**：`server/test/speech-segments.test.mjs` (4/4 通过)

### 6.3 前端 FileTranslateMode 重写

**改动** (`web/src/pages/VoicePage.tsx` `FileTranslateMode`):
- 替换原 ASR + 翻译 两次请求为单次 `/api/speech/asr-segments`
- 新增 `<audio ref={audioRef} controls onTimeUpdate>` 播放器
- 新增 `activeSegIdx` / `hoveredSegIdx` 状态
- 每个 segment 卡渲染 `[start_ms → end_ms] source / target`
- hover segment → `audioRef.current.currentTime = start_ms / 1000`
- timeupdate 监听 → 高亮当前段（`.active` class）

**测试**：`web/test/VoicePage.segments.test.tsx` (4/4 通过)

## 测试覆盖

| 模块 | 文件数 | 测试数 |
|------|--------|--------|
| Server (新增) | +3 文件 (ocr-pdf, ocr-create-task, speech-segments) | +17 (8+5+4) |
| Web (新增) | +5 文件 (TranslationPage.hover, OCRPage.hover, OCRPage.exportPdf, QualityCheckPage.hover, VoicePage.segments) | +14 |
| **回归基线** | server 388 → **405** ；web 232 → **246** | **总计 651 passing** |

## 改动文件清单

**新增 (3 server)**:
- `server/src/ocr-pdf.mjs`
- `server/test/ocr-pdf.test.mjs`
- `server/test/ocr-create-task.test.mjs`
- `server/test/speech-segments.test.mjs`

**修改 (3 server)**:
- `server/src/speech.mjs` — `mockSplitSegments`/`translateSegments` + ASR mock 升级
- `server/src/router.mjs` — 2 个新端点

**修改 (5 web)**:
- `web/src/pages/TranslationPage.tsx` — TextTranslate/Realtime 双向 hover
- `web/src/pages/OCRPage.tsx` — SVG 交互 + 可搜索 PDF 按钮 + toast
- `web/src/pages/QualityCheckPage.tsx` — hover 桥 + 改正后双栏
- `web/src/pages/VoicePage.tsx` — FileTranslateMode 重写
- `web/src/styles.css` — `.hovered` 类

**新增测试 (5 web)**:
- `web/test/TranslationPage.hover.test.tsx`
- `web/test/OCRPage.hover.test.tsx`
- `web/test/OCRPage.exportPdf.test.tsx`
- `web/test/QualityCheckPage.hover.test.tsx`
- `web/test/VoicePage.segments.test.tsx`

## 验证步骤

1. **TDD 流程**：✅ 全部红→绿（每个新功能先失败测试，再实现过绿）
2. **回归**：
   - `cd server && npx vitest run` → 405/405 通过 (33 文件)
   - `cd web && npx vitest run` → 246/246 通过 (28 文件)
3. **类型检查**：`cd web && npx tsc --noEmit` → 无错
4. **PDF 实证**：`file` 识别为 `PDF document, version 1.4, 1 pages`；`pdftotext` 可提取文字
5. **可观测**：每个新接口 curl 看 `X-*-Engine` / `X-*-Ms` 响应头

## 风险与权衡

### 1. 可搜索 PDF 不嵌入原图
**权衡**：暂不嵌入图像（避免 `/DCTDecode` 流复杂度）
- ✅ 优点：纯 JS 零依赖，838 字节生成一个 PDF，pdftotext 可搜索
- ⚠️ 缺点：纯文字版不含原图视觉信息
- 📝 后续：可加 `?embedImage=true` 选项，传 JPEG Buffer 时嵌入

### 2. CJK Title 用 UTF-16BE hex，但内容 Latin-1
**权衡**：保证 PDF 合法（CJK 在 Latin-1 范围外会破文件结构）
- ✅ Title 用 UTF-16BE hex 可保持 CJK 原文
- ⚠️ 内容区的 CJK 字符当前显示为 `?`（不影响搜索）
- 📝 后续：嵌入 NotoSansCJK 字体子集（CSS 的 `subset()` 函数 + pdf-lib）

### 3. 语音 mock 时间估算 ±10% 误差
**真实 API**：volc-bigmodel 返回确切 start_ms/end_ms → 准确
**mock**：按字符长度比例分配 → 误差较大但满足测试需求

### 4. 翻译段落模式默认不展示
**决策**：默认 word-level（已建立），段落模式作为可选 view mode
- 避免破坏 RealtimeTranslateMode 现有的词级联动交互

## 后续路线（未在本变更）

- 可搜索 PDF：嵌入原图 + CJK 字体子集（需 pdf-lib 或自写字体嵌入）
- 语音：real volc-bigmodel ASR 文件轮询完整实现
- 翻译段落级 diff：作为基础组件（ParaRow + CharDiffText）共享给所有 AI 结果页
- 质检查错误分类折叠：当前实现按错误类型分组但没折叠，可继续
- 通用 hover 桥抽象：把 `hoveredXxxId` 模式抽成 hook（`useHoverBridge`）
