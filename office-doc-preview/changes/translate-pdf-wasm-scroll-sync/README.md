# 翻译 PDF / WASM 模式：滚动同步 + 按页对应（v4.3）

> 模型: claude-sonnet-4-6（由 glm-5.2 调用）
> 日期: 2026-06-23

## 背景

v4.2 给翻译弹层加了 `PDF / 图片+文字 / WASM` 三态格式选择器，但 PDF 和 WASM 模式与 images 模式**未对齐**：

- **images 模式**：每行一对 cell（左原文 + 右译文），CSS flex 行 + 单一外层滚动容器 → 天然同步；IntersectionObserver 跟踪当前页
- **PDF 模式（旧）**：每 cell 用 `<iframe src={url}#page=N}>` 嵌整本 PDF，左右栏无法行对齐（iframe 内置滚动条 + 工具栏）
- **WASM 模式（旧）**：每 cell 用 `<PdfPreviewWASM url>` 渲染**整本文档**，每个 cell 自带工具栏 + 虚拟滚动 + IO，左右栏各自独立滚动

用户诉求：「**PDF 和 WASM 也要和图片一样实现滚动同步以及对应**」。

## 目标

1. PDF 模式：每 cell 只显示**单页** PDF（不再嵌整本文档）
2. WASM 模式：每 cell 只渲染**单页** canvas（不再嵌整本文档查看器）
3. 三种模式共用 `.ttl-page-row` 行架构 + 单一外层滚动 + IntersectionObserver → 行对齐 + 滚动同步**零 JS**
4. WASM 共享 PDF 文档实例（避免 N 个 cell 各自 fetch + parse）

## 改动清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `web/src/previewers/PdfPageWASM.tsx` | 新建 | 单页 WASM 渲染组件 + 模块级共享 doc 缓存（refcount） |
| `web/src/inspect/TranslationLayout.tsx` | 修改 | PDF: `iframe`→`<embed>`；WASM: `PdfPreviewWASM`→`<PdfPageWASM>` |
| `web/src/styles.css` | 微调 | `.ttl-cell-pdf` 适配 embed；新增 `.pdf-page-wasm-*` |
| `web/test/PdfPageWASM.test.tsx` | 新建 | 5 用例：smoke / canvas / 共享 doc / refcount destroy / 可观测 |
| `web/test/TranslationLayout.test.tsx` | 修改 | 替换为 5 个 v4.3 用例（embed / view=FitH / page=N / WASM slot / 结构共用） |
| `web/e2e/translate-dual.spec.ts` | 修改 | iframe→embed；新增 3 个 v4.3 用例（embed 按页、滚动同步、WASM slot） |

## 关键设计

### 1. 模块级共享 doc 缓存

```ts
type CachedDoc = { docPromise: Promise<any>; refCount: number }
const docCache = new Map<string, CachedDoc>()
```

- mount: `refCount++`，未命中则 fetch + parse
- unmount: `refCount--`，归零则 `doc.destroy()` + cache.delete
- **效果**：N 个 cell 同 URL → 只下载/解析 1 次

### 2. PDF embed 替代 iframe

```tsx
<embed
  className="ttl-cell-pdf"
  src={`${url}#page=${N}&view=FitH&toolbar=0`}
  type="application/pdf"
/>
```

- `<embed>` 不渲染 Chrome PDF Viewer 工具栏
- `view=FitH` 水平适配 cell 宽度

### 3. 行架构复用 images 模式

三种模式共用 `.ttl-page-row > .ttl-page-cell[data-side=left|right]` flex 行 →
同行左右 cell 天然 y 对齐 + 单一外层 `.ttl-pages-scroll` 滚动 → **零 JS 同步**。

## 测试

### 单元测试（Vitest + jsdom）

```bash
cd office-preview-app/web
npx vitest run test/PdfPageWASM.test.tsx test/TranslationLayout.test.tsx
```

- `PdfPageWASM.test.tsx`：5 用例全绿（含 mock @hyzyla/pdfium 全链路）
- `TranslationLayout.test.tsx`：「格式选择器」describe 块 5 用例全绿

### E2E（Playwright）

```bash
npx playwright test e2e/translate-dual.spec.ts
```

- 9 用例全绿（含 3 个 v4.3 新增：embed 按页、滚动同行 y 容差 <5px、WASM slot data-page）

### 手动 UI 回归（headed Chrome）

- WASM 模式：3 行 × 2 cell，`data-page=1/2/3`，canvas 正常渲染
- PDF 模式：6 个 embed，scroll diff = **0.00px**（完美同步）
- 三种模式切换无白屏，IntersectionObserver 当前页跟踪正常

## 风险与边界

- **`<embed>` 兼容性**：Chrome / Firefox / Safari / Edge 均支持 `type="application/pdf"`
- **WASM 并发安全**：pdfium 文档非线程安全，但 JS 单线程 + 每次操作 await → 无并发；refcount=0 的 destroy 用 `.then()` 异步避免阻塞 in-flight render
- **大文件 PDF embed 性能**：每个 `<embed>` 仍下载/解析整本 PDF（浏览器内部缓存命中），后续可优化为后端 `?page=N` 返回单页 PDF
- **jsdom 限制**：`HTMLCanvasElement.getContext` 未实现（warning only），不影响 DOM 结构断言
- **WASM 文字层偶发失败**：`page.getText()` 在个别页抛 `table index out of bounds`，已 try/catch 兜底，canvas 主图层不受影响

## 复用资产

- `PdfPreviewWASM` 的渲染逻辑（canvas + 文字层）作为参考，提取为单页版本
- `libraryInstance` 模块级单例模式（`PdfPreviewWASM.tsx`）
- `.ttl-page-row` flex 行结构（v4.2 已建立）
- IntersectionObserver 当前页跟踪（v4.1 已建立）
