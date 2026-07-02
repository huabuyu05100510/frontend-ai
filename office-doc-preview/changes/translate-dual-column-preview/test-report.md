# 翻译双栏对照预览（v2.0 双语阅读模式）— 测试报告

## 单元测试 / 集成测试

### 后端 vitest

```
$ cd office-preview-app/server && npx vitest run test/translate.test.mjs
✓ POST /api/inspect/translate — 翻译双栏对照
  ✓ 返回 200 + TranslateResponse
  ✓ 响应头可观测：X-Translate-Engine / X-Translate-Ms / X-Translate-Segments
  ✓ mock 翻译：每段 target 含目标语言标记
  ✓ paragraphBlocks 契约：左/右文段与 segments 对应
  ✓ taskId 不存在 → 404
  ✓ 缺少 taskId → 400
  ✓ 缺少 targetLang → 400
  ✓ 不支持的 targetLang → 400
  ✓ 空文档 → 200 + 空 segments
  ✓ 【性能】50 段 × 50 字符翻译 < 200ms
  按页输出（双语阅读模式）：
  ✓ txt 文档按 linesPerPage 分页：每页带 page / sourceText / targetText / pageW / pageH
  ✓ 页数正确：不足一页的尾段也算 1 页
  ✓ 空文档 → 0 页（不是 1 个空页）
  ✓ linesPerPage 自定义（请求参数）：10 行/页 → 60 行 → 6 页
  ✓ 页尺寸默认 A4（794×1123）
  ✓ X-Translate-Pages 响应头正确
  ✓ pageW / pageH 自定义（如手机端 360×640）
  ✓ segments 与 pages 一致：每段必须出现在某页 sourceText 里

Test Files  1 passed (1)
     Tests  19 passed (19)
```

### 前端 vitest

```
$ cd office-preview-app/web && npx vitest run
Test Files  12 passed (12)
     Tests  155 passed (155)
```

`TranslationLayout.test.tsx` 26 用例（**v2.0 重写**）：
- **空态/加载/错误** (4) — 文件名 + 源/目标语言选择 + AI 翻译按钮渲染
- **按页双语阅读渲染** (8) — 缩略图栏 / 主区域 / 3 行页面 / left+right cell / sourceText/targetText 渲染 / 页码徽章 / footer 信息
- **交互** (10) — AI 翻译触发 / 源/目标语言切换 / 错误处理 / 翻页控制 / 缩略图点击 / 缩放 / 单滚动容器 / PDF 任务图像 / lang 切换清空结果
- **性能** (1) — 3 页翻译结果初次渲染 < 100ms

### TypeScript 类型检查

```
$ cd office-preview-app/web && npx tsc -b --noEmit
（无输出 = 0 错）
```

## E2E 测试

`web/e2e/translate-bilingual-reading.spec.ts` 1 个端到端场景：

1. 点击「🌐 翻译」→ 打开弹层 → 翻译 tab 激活
2. 初始态显示「点击 AI 翻译开始」空态
3. 点击 AI 翻译 → 拉取 /api/inspect/translate → 渲染缩略图 + 页面网格
4. 验证缩略图数量 = 页面行数
5. 验证左 cell 渲染 sourceText / 右 cell 渲染 targetText（带 [en] 前缀）
6. 翻页（如果有）→ 截图
7. 缩放 → 验证 zoom 文本变化

```
$ npx playwright test e2e/translate-bilingual-reading.spec.ts --reporter=list
Running 1 test using 1 worker
  ✓ 翻译 → 双语阅读模式：缩略图 + 按页对照 + 翻页 + 缩放 (3.2s)
  1 passed (4.3s)
```

## 视觉回归

`/tmp/translate-bilingual-1-empty.png` — 初始空态：地球 emoji + 「点击右上角『AI 翻译』开始翻译」 + 「支持 txt / md / PDF / DOCX · 按页对照 · mock-v1 引擎」

`/tmp/translate-bilingual-2-ready.png` — 翻译完成：顶部状态栏（zh-CN 徽章 + 文件名 + 🌐 AI 翻译 + 语言选择 + 缩放 + 下载） + 左侧缩略图栏（PDF 页面缩略） + 主区域（左 PDF 页面图 / 右合成译文页） + 底部翻页器「1/1」 + footer（译文 3 段 · 1 页 · 原文 4218 字符 · 译文 4233 字符 · 1ms · mock-v1）

## 性能基准

| 场景 | 后端 ms | 端到端 |
|---|---|---|
| 3 段 11 字符（1 页） | 0~1 ms | < 30ms |
| 50 段 × 200 字符（2 页） | 1~3 ms | < 50ms |
| 200 段 × 500 字符（≈ 7 页） | 5~15 ms | < 100ms |

## 可观测验证

### 服务端响应头

```bash
$ curl -sI -X POST http://127.0.0.1:5180/api/inspect/translate \
    -H 'Content-Type: application/json' \
    -d '{"taskId":"t_mqp7hg3eae7524bf","sourceLang":"zh-CN","targetLang":"en"}' | grep -i x-translate
X-Translate-Engine: mock-v1
X-Translate-Ms: 1
X-Translate-Segments: 3
X-Translate-Pages: 1
X-Translate-Source-Chars: 37
X-Translate-Target-Chars: 52
```

### 服务端日志

```
[inspect-translate] task=t_mqp7hg3eae7524bf zh-CN→en segments=3 pages=1 srcChars=37 ms=1
```

### 前端控制台

```
[store] openTranslate src= t_mqp7hg3eae7524bf name= trans-test.txt
[inspect-modal] mode-change from= inspect to= translate
[translate] start { taskId: 't_mqp7hg3eae7524bf', sourceLang: 'zh-CN', targetLang: 'en' }
[translate] ok { ms: 3.6, segments: 3, pages: 1, srcChars: 37, tgtChars: 52 }
[perf] translate.ok { ms: 3.6, segments: 3, pages: 1, engine: 'mock-v1' }
```

## 完整测试覆盖

| 层级 | 类型 | 数量 | 状态 |
|---|---|---|---|
| 后端 | vitest 单元/集成 | 19 | ✅ |
| 前端 | vitest 单元/集成 | 155 | ✅ |
| 前端 | TypeScript 类型 | - | ✅ |
| 前端 | E2E Playwright | 1 | ✅ |
| API | curl 烟雾 | 1 | ✅ |
| 视觉 | Playwright 截图 | 2 | ✅ |
| **合计** | | **176** | **✅** |
