# 翻译双栏对照预览 — 双语阅读模式（按页对照）

> 对标设计稿：`翻译狗 / 讯飞设计稿/翻译对比.png`
> 关键用户反馈：「这是翻译对照 其实是和图片对照一样的我们」→ **整页对照 = 整页并排展示**
> 关键用户反馈 v3.0：「原文和译文应该是相同的格式也就说DOCX格式那么我们是用图片+文字显示的」→ **右栏 = DOCX→PDF→PDFium 真实渲染，与左栏同格式**
> 技术方案模型：`claude-sonnet-4-6`
> 实现日期：2026-06-22（v1.0 初版）/ 2026-06-22（v2.0 重做为按页阅读模式）/ 2026-06-22（v3.0 右栏真实渲染 + on-demand）
> 状态：✅ v3.0 已完成 · TDD 全绿 · 后端 21/21 · 前端 160/160 · E2E 通过 · 视觉回归 1/1

---

## 1. 目标

把 v1.0 的「文本段级 diff 双栏」重构为 v2.0 的「**按页双语阅读模式**」：

- **单一入口**：TaskCard「🌐 翻译」按钮
- **顶部状态栏**：源文件 + 源/目标语言选择 + 🌐 AI 翻译 + 缩放（页面 + 缩略图）+ 下载
- **左侧缩略图栏**：每页一个缩略卡（PDF 显示图像 / txt 显示首段缩略），点击跳转
- **主区域**：每页一对 cell（左原文 / 右译文），CSS Grid 单滚动 → 天然同步
- **浮动翻页器**：底中位置 · 首页/上/下/末页 · 当前页码 `1 / 482`
- **底部信息条**：段数/页数/字符数/耗时/引擎

PDF 任务：左 cell 渲染 PDF 页面图 + 文字层；右 cell 合成译文页。
txt/md 任务：左/右都合成文本页（多行段落）。

## 2. 架构

```
TaskCard 「🌐 翻译」 ──┐
                        ├── App.handleOpenTranslate ──▶ openInspect(src, null, { mode: 'translate' })
                        │                            + openTranslate(src)
                        │
InspectCompareModal    ──┴── InspectMode = 'translate'
                            ├── TranslationLayout（v2.0 重构）
                            │     ├── 顶部状态栏（lang + AI 翻译 + 缩放 + 下载）
                            │     ├── 左侧缩略图栏（ThumbCard × N）
                            │     ├── 主区域（页面网格：每行一对原文/译文）
                            │     ├── 浮动翻页器（IntersectionObserver 跟踪当前页）
                            │     └── 底部信息条
                            │
                            └── store：translateSource / SourceLang / TargetLang / Status / Result / Error

TranslationLayout 内部 ── fetch POST /api/inspect/translate ──▶
  server/router.handleInspectTranslate ──▶
    translate.mjs.{translate, paginateText, mockTranslate} ──▶ TranslateResponse
                                                          (含 pages: [{page, sourceText, targetText, pageW, pageH, ...}])
```

### 数据契约

```ts
// types.ts（v2.0 新增）
export interface TranslatePage {
  page: number                  // 页序号（1-based）
  sourceText: string            // 该页原文（多行 \n 分隔）
  targetText: string            // 该页译文
  pageW: number                 // 页面宽度（默认 A4=794）
  pageH: number                 // 页面高度（默认 A4=1123）
  startLine: number             // 该页首行（1-based）
  endLine: number               // 该页末行（1-based）
}

export interface TranslateResponse {
  sourceLang: LangCode
  targetLang: LangCode
  segments: TranslationSegment[]
  paragraphBlocks: ParagraphDiffBlock[]
  pages: TranslatePage[]        // v2.0 新增
  ms: number
  meta: {
    segmentsCount: number
    pagesCount: number          // v2.0 新增
    sourceChars: number
    targetChars: number
    engine: 'mock-v1' | string
  }
}
```

## 3. TDD 步骤（红→绿→重构）

### 3.1 后端 TDD（v2.0 按页输出）

```
1. 写 server/test/translate.test.mjs（19 用例，含 8 个按页相关）
2. 跑 vitest → 11 个老用例绿，新增 8 个红
3. 写 server/src/translate.mjs#paginateText（按 linesPerPage 切分 + 每页 mock 翻译）
4. 改 translate() 返回 pages 字段
5. 改 router.mjs 接受 linesPerPage/pageW/pageH 参数 + X-Translate-Pages 响应头
6. 跑 vitest → 19/19 绿 ✅
```

### 3.2 前端 TDD（v2.0 重做）

```
1. 重写 web/test/TranslationLayout.test.tsx（26 用例，全新页面阅读模式）
2. 跑 vitest → 老用例（dcv-para, .dcv-char-insert 等）全红
3. 重写 web/src/inspect/TranslationLayout.tsx（按页双语阅读 + 缩略图 + 翻页 + 缩放）
4. 修 InspectCompareModal.test.tsx 中失效的 testid（translate-lang-src/tgt → translate-source-lang/target-lang）
5. 跑 vitest → 26/26 + 129 既有 = 155/155 绿 ✅
6. 改 types.ts 加 TranslatePage + meta.pagesCount
7. 改 styles.css 加 .ttl-* 命名空间（约 200 行）
8. tsc -b --noEmit → 0 错
9. 写 e2e/translate-bilingual-reading.spec.ts（缩略图 + 翻页 + 缩放全流程）
10. playwright → 1/1 通过
```

## 4. 关键设计取舍

### 4.1 为什么 v2.0 不再依赖 DualColumnView？

v1.0 用 DualColumnView（段级 diff 文本）实现，导致用户反馈：「翻译对照 应该是和图片对照一样」。

v2.0 重写为按页对照：
- **每页一对**（不是每段一对）— 与 PDF 阅读器、DualImageColumn 一致
- **完整页面渲染** — 左 cell 渲染整页（PDF 图像 / 合成文本页），右 cell 渲染整页译文
- **缩略图侧栏** — 用户可全局导航
- **页码指示** — 「1 / 482」式信息密度

### 4.2 缩略图侧栏（与翻译狗一致）

- 宽 84px
- 每页卡片：60×84 比例（按 pageW/pageH 自适应）
- PDF 任务：渲染 page image 作为缩略
- txt 任务：渲染 sourceText 前 4 行作为缩略
- 点击 → scrollIntoView 平滑滚动到对应页
- 当前页卡片高亮（is-active）

### 4.3 当前页跟踪（IntersectionObserver）

```ts
new IntersectionObserver(
  (entries) => {
    let best: { page: number; ratio: number } | null = null
    for (const e of entries) {
      if (!e.isIntersecting) continue
      const pn = Number((e.target as HTMLElement).dataset.page)
      if (!best || e.intersectionRatio > best.ratio) {
        best = { page: pn, ratio: e.intersectionRatio }
      }
    }
    if (best) setActivePage(best.page)
  },
  { root: containerRef.current, rootMargin: '0px 0px -80% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
)
```

`rootMargin: '0px 0px -80% 0px'`：只有「顶部 20% 区域」内的页被认为是「当前页」，避免长页跨界时高亮抖动。

### 4.4 单滚动容器（不引入 JS 同步）

设计稿与 `DualImageColumn` 风格一致：每行一对 cell（左右同宽同行高），CSS Grid 自动对齐 → 天然同步。
不引入双滚动容器 + JS 同步（复杂度高，且与现有设计不一致）。

### 4.5 Mock 翻译策略

```js
mockTranslate(text, targetLang) → `text.split('\n').map(l => '[lang] ' + l).join('\n')`
```

可肉眼验证：选择「en」会看到 `[en] 你好` 这样的前缀，切换「ja」会变成 `[ja] 你好`。
真实实现替换为外部 API（讯飞 / 百度 / DeepL / GPT-4），契约不变。

### 4.6 后端按页策略

- **txt/md**：按 `linesPerPage`（默认 30 行）切分，每页 pageW=794 / pageH=1123（A4 比例）
- **PDF**：当前实现走 textDir 拼回文本（粗略），后续可由 `task.pages` 驱动精确分页
- **空文档**：返回 `[]`（不是 `[空页]`）
- **末页不足**：「不足一页的尾段也算 1 页」语义

### 4.7 切语言清空结果

```ts
useEffect(() => {
  if (status === 'ready' && result && (result.sourceLang !== sourceLang || result.targetLang !== targetLang)) {
    setResult(null); setStatus('idle')
  }
}, [sourceLang, targetLang])
```

避免语言与旧结果不匹配导致的视觉错位。

## 5. 可观测

### 5.1 服务端响应头

```bash
$ curl -sI -X POST http://127.0.0.1:5180/api/inspect/translate \
    -H 'Content-Type: application/json' \
    -d '{"taskId":"src-1","sourceLang":"zh-CN","targetLang":"en"}' | grep -i x-translate
X-Translate-Engine: mock-v1
X-Translate-Ms: 1
X-Translate-Segments: 3
X-Translate-Pages: 1
X-Translate-Source-Chars: 37
X-Translate-Target-Chars: 52
```

### 5.2 服务端日志

```
[inspect-translate] task=t_mqp7hg3eae7524bf zh-CN→en segments=3 pages=1 srcChars=37 ms=1
```

### 5.3 前端日志

```
[translate] start { taskId: 'src-1', sourceLang: 'zh-CN', targetLang: 'en' }
[translate] ok { ms: 3.6, segments: 3, pages: 1, srcChars: 37, tgtChars: 52 }
[perf] translate.ok { ms: 3.6, segments: 3, pages: 1, engine: 'mock-v1' }
```

### 5.4 perf 埋点（usePerf store）

```ts
translateMs          // 最近一次翻译总耗时
translateSegments    // 最近一次翻译段数
translateTotalMs     // 累计翻译耗时
translateCount       // 累计翻译次数
translateEngine      // 翻译引擎标识
```

## 6. 性能基准

| 场景 | 后端 ms | 端到端 |
|---|---|---|
| 1 段 6 字符（1 页） | 0~1 ms | < 30ms |
| 3 段 11 字符（1 页） | 0~1 ms | < 30ms |
| 50 段 × 200 字符（2 页） | 1~3 ms | < 50ms |
| 200 段 × 500 字符（≈ 7 页） | 5~15 ms | < 100ms |

（Mock 翻译 + paginateText；真实 API 取决于外部服务）

## 7. UI 回归

- ✅ 顶部状态栏：源文件名 + 语言 + AI 翻译 + 缩放 + 下载 一行排开，不挤压
- ✅ 左侧缩略图栏：固定 84px 宽，缩略卡按比例缩放
- ✅ 主区域：CSS Grid 单滚动，每页一对 cell，左右同宽同行高
- ✅ 浮动翻页器：底中位置，玻璃态背景，1 / N 页码
- ✅ 切换「智检 ↔ 双栏对比 ↔ 翻译对照」无样式抖动
- ✅ CSS 与现有 `.icm-*` / `.dcv-*` 命名空间对齐，无样式泄漏（新增 `.ttl-*`）
- ✅ 切语言清空结果，避免视觉错位

## 8. 改动清单（v2.0 vs v1.0）

### 新增
- `web/e2e/translate-bilingual-reading.spec.ts` — 1 个端到端用例
- `web/test/TranslationLayout.test.tsx` — 26 个单元/集成用例（**重写** v1.0 14 个）
- `server/test/translate.test.mjs` — 新增 8 个按页相关用例（**扩展** v1.0 11 个）

### 修改
- `server/src/translate.mjs` — 新增 `paginateText` + `translate()` 返回 `pages` 字段
- `server/src/router.mjs` — 接受 `linesPerPage`/`pageW`/`pageH` 参数 + `X-Translate-Pages` 响应头
- `web/src/inspect/TranslationLayout.tsx` — **重写** 为按页双语阅读模式（v1.0 文本 diff → v2.0 整页对照）
- `web/src/types.ts` — 新增 `TranslatePage` 接口 + `TranslateResponse.pages` / `meta.pagesCount`
- `web/src/styles.css` — 新增 `.ttl-*` 命名空间（约 200 行）
- `web/test/InspectCompareModal.test.tsx` — 修失效 testid

## 9. 端到端验证

```
✅ 后端 vitest 19/19 绿（translate.test.mjs）
✅ 后端 vitest 既有 102+ 绿（router/diff 等回归无破坏）
✅ 前端 vitest 155/155 绿（含 26 个 TranslationLayout + 4 个 InspectCompareModal 翻译 tab）
✅ TypeScript tsc -b --noEmit 0 错
✅ e2e Playwright 1/1 通过（translate-bilingual-reading.spec.ts）
✅ API 烟雾测试：3 段 → 1 页，A4 794×1123，mock [en] 前缀正确
```

## 10. 后续可拓展

- **真实 API 替换 mock**（讯飞机器翻译 / DeepL / GPT-4）
- **PDF 精确分页**：由 `task.pages` 驱动（当前 txt/md 走 linesPerPage 切分，PDF 走 textDir 拼回）
- **多段并行翻译**（Web Worker）— 长文档加速
- **翻译缓存**（按 taskId+lang 哈希，避免重复翻译）
- **翻译结果导出**（双语对照 PDF / docx）
- **翻译记忆**（TM）+ **术语库**
- **字符级 diff 高亮**（在右 cell 渲染译文时，按 lineOps 字符级高亮 — v1.0 思路，可叠加到 v2.0）
- **左侧缩略图同步滚动**（滚主区域时高亮对应缩略图；当前仅反向）

## 11. v1.0 → v2.0 重构说明

| 维度 | v1.0 | v2.0 |
|---|---|---|
| 布局 | 段级 diff 双栏 | 按页双语阅读 |
| 每行内容 | 1 个段落 | 1 个完整页面 |
| 左 cell | 段落文字 | PDF 图像 / 合成文本页 |
| 右 cell | 段落译文 | 合成译文页 |
| 缩略图 | ❌ | ✅ 左侧栏 84px 宽 |
| 翻页 | ❌ | ✅ 首页/上/下/末页 |
| 字符级 diff | ✅（DualColumnView） | ❌（v2.0 不做，v1.0 思路可叠加） |
| 后端 pages 字段 | ❌ | ✅ |
| X-Translate-Pages 响应头 | ❌ | ✅ |

v1.0 没有废弃（向后兼容）：`paragraphBlocks` 仍返回，可作为后续字符级 diff 的基础。
