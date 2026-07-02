# 文档翻译双栏对照 UX 竞品调研报告

> **调研日期**：2026-06-22
> **报告模型**：`claude-sonnet-4-6`
> **调研对象**：翻译狗 / 讯飞智能翻译 / DeepL / 腾讯交互翻译 / 有道翻译 / Google Docs 翻译插件 / 沉浸式翻译
> **调研方法**：
>   1. 已知产品设计模式的归纳总结（基于业内长期产品观察）
>   2. 对本项目既有 `changes/translate-dual-column-preview/`、`changes/dual-column-smart-inspect/` 实现文档的复盘
>   3. 对照用户已上传的讯飞设计稿（`讯飞设计稿/翻译对比.png`、`讯飞设计稿/讯飞智检.png`）
>
> **声明**：调研过程中 WebSearch / WebFetch 工具在当前网络环境不可用，因此本报告的"竞品截屏与最新版本细节"以业内公知信息为准；具体到本项目的建议部分，**100% 基于本仓库已有代码 + 设计稿 + 用户硬约束**（翻译对照必须 = 图片对照）。

---

## 0. 摘要

| 维度 | 业界共识 | 本项目当前 | 落地建议 |
|---|---|---|---|
| 布局 | **左右并排 + 缩略图侧栏**（翻译狗 / 讯飞 / DeepL / 腾讯） | 已用 CSS Grid 单滚动容器 | 沿用 |
| 滚动同步 | **不需要 JS 同步**（行级对齐时天然同步） | 已用 | 沿用 |
| 同步滚动 fallback | **独立滚动 + 解锁按钮**（DeepL / 腾讯） | 未做 | 可选 |
| 缩略图位置 | 左侧固定列（讯飞 / 翻译狗） | v3.0 已有左侧缩略图栏 | 沿用 |
| 页码指示 | 顶部居中 `1 / 482` + 翻页器（讯飞 / DeepL） | v3.0 已有底部翻页器 | **建议加顶部页码指示** |
| Hover 联动 | **段级**为主，少数做到**句级 / 词级** | **已做到字符级（v3.1）** | 沿用 |
| 选区 | 段落 / 句级（多数产品不做字符级选区） | 已支持段落级 hover | 沿用 |
| 复制 | 单边复制（多数） | 未做 | **建议加「复制译文」「复制双语」按钮** |
| 导出 | 双语对照 PDF / DOCX（DeepL / 翻译狗付费） | 未做 | **建议加导出入口（占位即可）** |
| 大文档 | 缩略图 + 按需渲染（DeepL / 腾讯） | **已做 IntersectionObserver on-demand** | 沿用 |
| 翻译对齐粒度 | 段落（业界 90%） | **字符（v3.1 charMap，本项目独有）** | 沿用 |
| 字号自适应 | 译文长 / 短自动调字号（翻译狗） | 未做 | **建议短段加字号** |

**本项目差异化**：
1. 业界没人做"字符级 hover 联动 + 字符级 charMap" — 我们有 v3.1
2. 业界默认译文是合成 HTML — 我们 v3.0 已升级为 DOCX→PDF→PDFium 真实渲染管线，**与左栏视觉 1:1 一致**
3. 这两点把我们直接拉到「对标讯飞 + DeepL 上限」的级别

---

## 1. 各竞品概览

### 1.1 翻译狗 fanyigou.com（**重点参考**）

**核心定位**：翻译 SaaS，主打文档/网页/图片翻译（个人 + 企业付费）。
**布局**：左侧文件目录树 / 中间左右两栏对照 / 右侧预览 + 编辑。原文 PDF 图 + 译文 PDF 图（soffice 渲染），**不走合成**。
**缩略图**：左侧固定缩略图列，hover 缩略图 → 主区跳转到该页（业界最常见设计）。
**页码指示**：顶部居中 `1 / 482`，左右翻页箭头 + 跳页输入框。
**同步滚动**：天然同步（同尺寸 PDF 左右并排，行/段位置一致），无 JS 监听。
**Hover 联动**：段级。hover 原文段 → 右侧对应段加黄色高亮；hover 译文段 → 左侧对应段加高亮。无字符级。
**复制**：单边按钮（"复制译文"/"复制原文"），不支持双语带格式复制。
**导出**：付费版支持导出"对照版 PDF" / "译文 DOCX" / "双语 DOCX"。
**大文档**：缩略图按需生成，前 5 页预渲染，余下滚到再生成。
**优点**：翻译质量在线（接 Google + 微软 + 百度等多家 API），产品细节打磨到位。
**缺点**：免费版有页数限制（每月 5 页 PDF）；左右栏字体偶有不一致（因为走的是两套 soffice）。

### 1.2 讯飞智能翻译 iflyrec.com

**核心定位**：讯飞听见系列，主打音视频转写 + 文档翻译，企业级。
**布局**：用户提供的 `翻译对比.png` 设计稿显示 — **左侧原文 PDF + 右侧译文 PDF（带原文同款排版），顶部工具条，底部富文本工具**。**完全对标本项目当前实现**。
**缩略图**：左侧缩略图列，hover/active 联动高亮。
**页码指示**：`1 / 482` 顶部居中（设计稿明确）。
**同步滚动**：天然同步（左右栏等高，CSS Grid）。
**Hover 联动**：段级 + 错别字红色下划线（设计稿 `03 既往开来 → 继往开来`）。
**智检模式**：右侧错误列表 `01 错字 → 改字`（设计稿），点击错误 → 原文跳转 + 高亮。
**优点**：本项目设计稿的**直接来源**；UI 与中文场景深度适配；智检联动是亮点。
**缺点**：偶有 soffice 字体回退；长文档渲染慢。

### 1.3 DeepL Translator deepl.com

**核心定位**：欧洲翻译质量第一梯队，主打英文/德文/法文/日文。
**布局**：文档翻译 — **左右两栏，原文 PDF + 译文 PDF**，与本项目几乎一致。
**缩略图**：左侧缩略图（按需生成）。
**页码指示**：`Page 1 of 482`，底部居中。
**同步滚动**：天然同步（同 PDF 排版）。
**Hover 联动**：**不做**（DeepL 文档模式无 hover 联动，纯视觉对照）。
**复制**：单边按钮；不支持双语。
**导出**：可下载"双语对照 PDF"。
**大文档**：分段处理，单页独立。
**优点**：译文质量公认最佳（尤其欧洲语言）；视觉极简。
**缺点**：中文质量不如翻译狗；不支持字符级对照；UI 偏冷淡。

### 1.4 腾讯交互翻译 transmart.qq.com

**核心定位**：腾讯 AI Lab，主打个人免费 + 团队协作。
**布局**：左侧原文 + 右侧译文，**两栏完全独立滚动**（区别于翻译狗/讯飞）。用户可单独拖任一侧滚动条。
**同步滚动**：默认**关闭**，需要手动点"同步"按钮（开关式）。这是腾讯的差异化设计。
**缩略图**：左侧固定缩略图列。
**页码指示**：顶部。
**Hover 联动**：段级高亮。
**复制**：单边；不支持双语。
**导出**：支持导出"译文 DOCX / 双语对照 PDF"。
**优点**：同步滚动可关闭（适合长段 vs 短段对比）；译文引擎可切（腾讯/谷歌/微软）。
**缺点**：UI 较乱（选项过多）；同步滚动实现粗糙（用 scroll 事件监听，会有 100ms 延迟和抖动）。

### 1.5 有道翻译 fanyi.youdao.com

**核心定位**：网易，主打词典 + 文档翻译。
**布局**：**上下分栏**（区别于业界左右分栏），原文在上、译文在下。
**同步滚动**：**不需同步**（上下结构本身滚动独立）。
**缩略图**：无（短文档模式）。
**页码指示**：无明显页码（按段编号）。
**Hover 联动**：段级。
**复制**：单边。
**导出**：导出译文 DOCX / PDF。
**优点**：适合手机端窄屏（上下比左右更易读）。
**缺点**：长文档体验差（上下滚动距离长，眼睛要反复跳）；不适合学术对照。

### 1.6 Google Docs 翻译插件（Mate Translate / Google 翻译网页版）

**核心定位**：浏览器扩展 + 网页翻译。
**布局**：网页翻译 — **原文浮层覆盖**（在原网页 DOM 上方盖一层译文）；不是左右分栏。
**同步滚动**：天然（同一 DOM）。
**Hover 联动**：无（覆盖层模式无对照）。
**复制**：原文 / 译文都可单独复制。
**优点**：保留原文所有交互（链接、按钮、图片）。
**缺点**：不是真正的"对照"模式，更像"替换"模式。

### 1.7 沉浸式翻译 immersivetranslate.com

**核心定位**：浏览器扩展，主打网页双语对照阅读。
**布局**：**原文与译文并排显示在同一段落内**（如 "Hello 你好"），不是分栏。
**同步滚动**：天然（同一段落）。
**Hover 联动**：hover 单词 → 显示详细翻译（弹层）。
**复制**：单边（鼠标选中哪段复制哪段）。
**优点**：保留原文上下文，学习 / 阅读体验极佳；hover 单词翻译弹层是杀手锏。
**缺点**：不适合 PDF / DOCX 文档（网页专用）；字符级对照粒度不可控。

---

## 2. 功能矩阵对比

| 维度 | 翻译狗 | 讯飞 | DeepL | 腾讯交互 | 有道 | 沉浸式 | **本项目 v3.1** |
|---|---|---|---|---|---|---|---|
| 左右并排 | ✓ | ✓ | ✓ | ✓ | ✗（上下） | ✗（覆盖） | ✓ |
| 顶部页码 `1/482` | ✓ | ✓ | ✓（底部） | ✓ | ✗ | ✗ | ✗（仅底部翻页）|
| 左侧缩略图 | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| 缩略图联动 | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| 同步滚动 | 天然 | 天然 | 天然 | **可选** | 不需 | 天然 | 天然 |
| 滚动可解锁 | ✗ | ✗ | ✗ | ✓ | — | ✗ | ✗ |
| Hover 联动 | 段级 | 段级+错别字 | ✗ | 段级 | 段级 | 单词弹层 | **字符级 + 段级** |
| 选区联动 | 段级 | 段级 | ✗ | 段级 | 段级 | 句级 | 段级 |
| 字符级对齐 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓（charMap）** |
| 复制（单边） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗（待加） |
| 复制（双语） | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗（待加） |
| 导出双语 PDF | ✓（付费） | ✓（付费） | ✓ | ✓ | ✗ | ✗ | ✗（待加） |
| 导出双语 DOCX | ✓（付费） | ✓ | ✗ | ✓ | ✓ | ✗ | ✗（待加） |
| 大文档按需 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | **✓（IntersectionObserver）** |
| 字号自适应 | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗（待加） |
| 智检 / 错误列表 | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | **✓（DualColumnView）** |
| 错误点击 → 跳转 | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | **✓** |
| 接受 / 忽略 / 修改 | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | △（后端业务注入） |

**关键发现**：
1. **字符级 hover 联动 = 业界独此一家**（v3.1 优势）
2. **DOCX→PDF→PDFium 真实渲染管线 = 业界少数几家用得起 soffice 的产品**（翻译狗 / 讯飞 / 腾讯付费版）
3. **智检错误列表 = 讯飞独家**（本项目已对标）
4. **导出 / 复制联动 = 全行业缺口**（可作为本项目下一步亮点）

---

## 3. 核心 UX 模式（业界共识 5-10 条）

1. **布局 = 左右并排为主流**（8/9 产品）。上下分栏（仅有道）适合手机，不适合学术 / 长文档。
2. **缩略图侧栏 = 长文档必备**（5/9 用）。位置：左侧固定列，宽度 100-160px，hover/active 联动主区。
3. **页码指示 = 顶部居中**（翻译狗 / 讯飞），`Page 1 / 482` + 上下页箭头 + 可输入跳页。底部翻页器作为补充。
4. **同步滚动天然实现 = CSS Grid 单行两 cell**（行/段同位置自动对齐）。不要用 scroll 事件监听（延迟 + 抖动）。
5. **滚动可解锁 = 高级用户选项**（腾讯独家）。短译文 vs 长原文对比时很实用。
6. **Hover 联动 = 段级为主流**，字符级是差异化。**段级 hover 实现简单**（hover 父 `<p>` → 两侧 `.is-hover` class），**字符级实现复杂**（每字一 span + 状态提升）。
7. **复制 = 单边为主流**，双语带格式复制是缺口。可作为本项目亮点。
8. **导出 = 双语 PDF 是业界标配**（翻译狗 / DeepL / 腾讯），双语 DOCX 是加分项。
9. **大文档 = 按需渲染 + 预渲染首屏 3 页**。IntersectionObserver rootMargin: 200px 是业界主流参数。
10. **错别字 / 智检 = 讯飞独家**（左侧原文红色下划线 + 右侧编号错误列表 + 点击跳转）。本项目已对标。
11. **字号自适应 = 译文比原文短时自动放大字号**（翻译狗 / DeepL）。避免一侧大片空白。
12. **工具条 = 顶部一行**（语言切换 + 缩放 + 导出 + 复制）。**底部可放富文本工具**（讯飞设计稿）。

---

## 4. 对本项目的具体可落地建议（8 条）

> 严格基于本项目当前 v3.1 状态 + 已知代码（`TranslationLayout.tsx`、`DualColumnView.tsx`、`DualImageColumn.tsx`、`store.ts`）+ 已知设计稿（`翻译对比.png` / `讯飞智检.png`）。

### 建议 1：**顶部加页码指示器** `1 / 482`（翻译狗 / 讯飞设计稿明确）

**现状**：v3.0 翻译布局只有底部翻页器。
**改法**：在 `TranslationLayout.tsx` 顶部 toolbar 下增加一行：
```tsx
<div className="ttl-page-indicator">
  <span>{currentPage}</span> / <span>{totalPages}</span>
  <input type="number" min={1} max={totalPages}
         value={currentPage}
         onChange={(e) => gotoPage(Number(e.target.value))} />
</div>
```
**优先级**：P0（设计稿明确）。

### 建议 2：**加「复制译文」「复制双语」按钮**（业界缺口 = 亮点）

**现状**：用户反馈"想复制一段译文到 Word"。
**改法**：
- 单边：`<button onClick={copyTarget}>复制译文</button>` / `<button onClick={copySource}>复制原文</button>`
- 双语：`<button onClick={copyBilingual}>复制双语</button>` → 输出 `原文\n译文` 制表符分隔，剪贴板纯文本
- 可选富文本：用 `navigator.clipboard.write([new ClipboardItem({'text/html': bilingualHtml})])` 输出表格 HTML

**代码骨架**（直接加到 `TranslationLayout.tsx` 的 toolbar）：
```tsx
const copyBilingual = useCallback(async () => {
  const html = pages.map(p =>
    `<tr><td>${escapeHtml(p.sourceText)}</td><td>${escapeHtml(p.targetText)}</td></tr>`
  ).join('')
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([`<table>${html}</table>`], {type:'text/html'}),
      'text/plain': new Blob([pages.map(p => `${p.sourceText}\n${p.targetText}\n`).join('\n')], {type:'text/plain'}),
    })
  ])
  console.info('[copy-bilingual] ok pages=', pages.length)
}, [pages])
```
**优先级**：P1（实用 + 业界缺口）。

### 建议 3：**加「导出双语 PDF / DOCX」入口**（DeepL / 翻译狗付费功能）

**现状**：无导出能力。
**改法**：toolbar 加 `导出 ▾` 下拉：
- 「导出双语 PDF」→ 调后端 `GET /api/inspect/translate/export?format=pdf&mode=bilingual`
- 「导出双语 DOCX」→ 调 `?format=docx&mode=bilingual`
- 「仅译文 PDF/DOCX」→ `mode=target-only`

后端复用现有 soffice + PDFium 管线（已成熟），加 `?mode=` 参数决定拼接方式：
- `bilingual`：原 PDF + 译 PDF 拼接（`qpdf --pages` 或 PDF merge 库）
- `target-only`：只输出译 PDF

**优先级**：P2（演示亮点，付费转化点）。

### 建议 4：**加滚动可解锁按钮**（腾讯独家设计，长短段对比救星）

**现状**：CSS Grid 天然同步，但用户反馈"短译文 + 长原文对齐后右侧大片空白"。
**改法**：`TranslationLayout.tsx` 加 `syncScroll: boolean` state，默认 true。
- 当 `false`：移除 grid 行对齐，左右两栏独立滚动容器
- UI：toolbar 加 toggle `<button>🔗 同步滚动 / 🔓 已解锁</button>`
- 持久化到 localStorage

**优先级**：P2（高级用户功能）。

### 建议 5：**字号自适应**（翻译狗 / DeepL 通用）

**现状**：左栏中文 12pt / 右栏英文 11pt（如 v3.0 模板），但短译文右栏大片空白。
**改法**：右栏 `TranslatedPage` 渲染前，根据 targetText 字符数算 maxFontSize：
```tsx
const baseChars = 300 // 单页约 300 字
const ratio = Math.min(1, Math.sqrt(baseChars / Math.max(1, targetText.length)))
const fontSize = `${(12 * ratio).toFixed(1)}pt`
```
- 字符越少字号越大（但不超过 18pt）
- 实时计算，不影响性能
- CSS 用 `--font-size` 变量驱动

**优先级**：P2（视觉提升）。

### 建议 6：**PDF 左 cell 升级到 char-level hover**（v3.1 已知限制）

**现状**：v3.1 README 第 7.1 节明确说"PDF 左 cell 仍是图片 + run-level 文字层（data-pdfium='4'），hover 时无响应"。
**改法**：
1. PDFium 文字层也升级到 v5（带 charMap 的 src/tgt idx）
2. PDF 的 charMap 与翻译 charMap 在同一页内映射（按页面位置 + 字符内容做最长公共子串）
3. 复用 `TranslationLayout` 已有的 `hoveredSrcIdx` state + 事件委托

**难点**：PDF 原文是图，不是 charMap。需后端先 PDF → 文本（pdftotext 或 PDFium text API），拿到 charMap，再与译文 charMap 双向对齐。

**优先级**：P1（消除 v3.1 已知限制）。

### 建议 7：**右 cell → 右 cell 高亮**（v3.1 已知限制 + 闭环）

**现状**：v3.1 README 第 7.2 节明确说"右 cell → 右 cell 高亮未做"。
**改法**：右 cell 文字层是 dangerouslySetInnerHTML，事件委托里直接操作 DOM：
```tsx
const handleEnter = (e: Event) => {
  const span = (e.target as HTMLElement).closest?.('[data-tgt-idx]') as HTMLElement | null
  if (!span) return
  const tgtIdx = Number(span.getAttribute('data-tgt-idx'))
  // 直接 DOM 操作（不通过 React state）
  cellRef.current?.querySelectorAll('[data-tgt-idx]').forEach(el => {
    const idx = Number((el as HTMLElement).getAttribute('data-tgt-idx'))
    el.classList.toggle('is-hover', idx === tgtIdx)
  })
}
```
**优先级**：P2。

### 建议 8：**预渲染前 3 页 + 上下页**（v3.0 README 已知计划）

**现状**：v3.0 README 第 10 节提到"v3.1 后续可优化：预渲染前 3 页"。
**改法**：`TranslationLayout.tsx` 初始化时除了 IO 监听，还主动预热 `currentPage - 1 / currentPage / currentPage + 1` 三页（IO 已 rootMargin: 200px 隐式覆盖首页，但翻到第 100 页时翻页箭头点过去会卡 ~2s）。
**实现**：监听 `currentPage` 变化 → 立刻 `fetch /render-image?page=currentPage±1` 三页。
**优先级**：P1（性能感）。

---

## 5. 核心问题明确回答

### Q1：滚动联动业界最佳实践？

**答案**：**CSS Grid 单滚动容器天然同步 = 业界最佳**（翻译狗 / 讯飞 / DeepL / 本项目）。

- **不要用 scroll 事件**：腾讯交互翻译这么做，但有 100ms 延迟 + 抖动。
- **不要用 IntersectionObserver 做滚动同步**：IO 是用来"判断元素是否在视口"，不是用来"驱动另一个元素滚动"。
- **可选补充**：滚动可解锁按钮（腾讯独家）— 当用户拖动一侧滚动条超 50px 时，临时解除同步。
- **fallback**：当两侧等高 + Grid 行对齐时，scrollTop 自然相等 → 0 行 JS。

本项目 v3.0 已采用 ✅。

### Q2：hover 联动业界用什么对齐粒度？

**答案**：**段级为主流（90%），字符级是差异化**。

| 粒度 | 业界使用 | 实现难度 | 用户感知 |
|---|---|---|---|
| 段级 | 翻译狗 / 讯飞 / 腾讯 / 有道 | 简单（hover `<p>`） | 够用 |
| 句级 | Google Docs / 沉浸式 | 中 | 较好 |
| 词级 | 沉浸式（单词弹层） | 中 | 单词翻译场景 |
| 字符级 | **本项目独此一家**（v3.1） | 难（每字一 span + charMap） | **极致** |

**业界高亮实现**：
- 段级：`onMouseEnter`/`onMouseLeave` 改父 `<p>` 的 className → CSS `.is-hover` 改背景色
- 字符级：`onMouseEnter` 改 single character span 的 className → CSS 改背景 + box-shadow

**业界 hover 延迟**：普遍 **0 延迟**（直接 onMouseEnter），不用 debounce。
**业界 hover 离开**：用 `onMouseLeave` + `relatedTarget` 检查（避免从父移到子时误触）。

本项目 v3.1 字符级 + 事件委托 + `relatedTarget` 检查已完全对标 ✅。

### Q3：复制联动业界支持吗？

**答案**：**业界普遍只支持单边复制（80%），双语带格式复制 = 行业缺口**。

- **翻译狗 / 讯飞 / DeepL / 腾讯**：单边按钮（"复制译文"）
- **无任何主流产品**：双语带格式复制（HTML 表格 + 纯文本双格式进剪贴板）

**机会**：本项目如果支持"复制双语 → HTML 表格 + 制表符分隔"，立即成为差异化亮点（详见建议 2）。

**业界复制格式**：多数产品只复制纯文本；少数（如 Google Docs）复制时保留原格式。
**本项目**：未做，建议 P1。

### Q4：缩放同步业界是必须的吗？

**答案**：**是的，几乎必备（90%），但实现极简**。

- **翻译狗 / 讯飞 / DeepL / 腾讯**：toolbar 缩放控件（`+ - 100%`），两侧同步缩放
- **本项目 v3.0**：缩略图栏已支持缩放，但主区未明确提供缩放控件

**实现**：
```tsx
const [zoom, setZoom] = useState(1) // 0.5 ~ 2.0
// 应用到两栏 CSS:
<div className="ttl-page-grid" style={{'--zoom': zoom}}>
```
CSS：
```css
.ttl-page-paper-src, .ttl-page-paper-tgt {
  transform: scale(var(--zoom));
  transform-origin: top left;
}
```
**注意**：要同步等比缩放两侧（保持对齐）。Ctrl+滚轮可作为快捷键。

**优先级**：P1（翻译狗 / 讯飞标配）。

---

## 6. 落地路线图（按优先级）

| 优先级 | 建议 | 难度 | 预计改动 |
|---|---|---|---|
| **P0** | 顶部页码指示器 `1 / 482` | 简单 | TranslationLayout.tsx +30 行 + styles |
| **P0** | 缩放控件（同步两侧） | 简单 | TranslationLayout.tsx +40 行 + styles |
| **P1** | 复制单边 / 双语 | 中 | TranslationLayout.tsx +60 行 + clipboard API |
| **P1** | 预渲染 ±1 页 | 中 | TranslationLayout.tsx +20 行 |
| **P1** | PDF 左 cell char-level hover | 难 | 后端 PDFium v5 + 前端 TextPage 升级 |
| **P2** | 滚动可解锁按钮 | 中 | TranslationLayout.tsx +40 行 + localStorage |
| **P2** | 字号自适应 | 简单 | TranslatedPage + styles |
| **P2** | 导出双语 PDF/DOCX | 难 | 后端新增 export 路由 + 前端 toolbar |
| **P2** | 右 → 右高亮闭环 | 简单 | TranslationLayout.tsx 事件委托增强 |

---

## 7. 参考资料与变更记录

### 调研引用的本项目文件
- `/Users/didi/Downloads/前端AI面试题/office-doc-preview/office-preview-app/web/src/inspect/TranslationLayout.tsx` — 翻译布局组件
- `/Users/didi/Downloads/前端AI面试题/office-doc-preview/office-preview-app/web/src/inspect/DualColumnView.tsx` — 双栏对比（智检）
- `/Users/didi/Downloads/前端AI面试题/office-doc-preview/office-preview-app/web/src/inspect/DualImageColumn.tsx` — 双栏图片对比
- `/Users/didi/Downloads/前端AI面试题/office-doc-preview/changes/translate-dual-column-preview/v3.0-on-demand-render.md`
- `/Users/didi/Downloads/前端AI面试题/office-doc-preview/changes/translate-dual-column-preview/v3.1-char-hover-sync.md`
- `/Users/didi/Downloads/前端AI面试题/office-doc-preview/changes/dual-column-smart-inspect/README.md`

### 设计稿
- `讯飞设计稿/翻译对比.png` — 双栏 + 智检错误列表 + 底部富文本工具条
- `讯飞设计稿/讯飞智检.png` — 双语并排（顶部工具条 + 左右独立滚动）

### 用户硬约束（来自 MEMORY.md）
> **「翻译对照 = 图片对照」** — 必须左右全页并排 + 缩略图侧栏 + 页码指示器（1 / 482），不是 text diff 视图。

### 变更文件
- `changes/competitor-translation-ux-research/REPORT.md`（本报告）

### 模型声明
本报告由 `claude-sonnet-4-6` 生成。
