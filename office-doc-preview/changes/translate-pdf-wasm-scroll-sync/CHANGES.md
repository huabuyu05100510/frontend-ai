# translate-pdf-wasm-scroll-sync

模型：claude-sonnet-4-6

## 功能

PDF 和 WASM 翻译对照模式的双滚动条同步 + hover 高亮联动。

## 核心改动

### `web/src/inspect/TranslationLayout.tsx` — v5.0 双面板架构

**布局变更：**
- 原：单个 `.ttl-pages-scroll` 容器（CSS Grid 行对齐，天然同步）
- 新：`.ttl-panels` 内含两个独立滚动容器：`.ttl-src-scroll`（左，原文）+ `.ttl-tgt-scroll`（右，译文）
- 竖向分割线 `.ttl-panels-divider`，两侧各有面板标题（原文/译文 + 语言徽章）

**滚动联动（page-offset 映射）：**
```
useEffect([status]) {
  buildPageOffsets(pageHeights, gap) → [0, h0, h0+h1, ...]
  scroll src → mapScrollPos(src.scrollTop, offsets, offsets) → tgt.scrollTop
  scroll tgt → mapScrollPos(tgt.scrollTop, offsets, offsets) → src.scrollTop
  防 ping-pong：syncFrom ref + requestAnimationFrame double-buffer
}
```

**Hover 联动（DOM-based，零 React re-render）：**
```
highlightSrcIdx(idx) {
  querySelectorAll('.is-hover').forEach(remove)
  querySelectorAll(`[data-src-idx="${idx}"]`).forEach(add .is-hover)
  // 同时操作 srcScrollRef 和 tgtScrollRef 两个容器
}
```
- 源面板事件委托：`mouseover` on srcScrollRef → `closest('[data-src-idx]')` → `highlightSrcIdx`
- 目标面板：TranslatedPage 已有 `mouseover/mouseout` 委托，改为调用 `highlightSrcIdx`
- TextPage chars 保留 `onMouseEnter`/`onMouseLeave` 兼容测试的 `fireEvent.mouseEnter`

**WASM 模式修复（重要 bug 修复）：**
- 原：TranslatedPage 在 WASM 模式下渲染源 PDF（两侧都显示原文，译文消失）
- 新：TranslatedPage 始终走 server images 管线（render-image + render-text）
- WASM 仅用于左侧（原文），右侧（译文）与 images 模式完全一致

**Fit-width 公式更新：**
- 原：`containerW * 0.95 / (pageW * 2 + 19)`（按双栏总宽）
- 新：`panelW * 0.92 / pageW`（按单面板宽）—— panelW = srcScrollRef.clientWidth

### `web/src/styles.css` — 新 CSS

```css
.ttl-panels { flex: 1; display: flex; overflow: hidden; }
.ttl-src-scroll, .ttl-tgt-scroll { flex: 1; overflow-y: scroll; scrollbar-width: thin; }
.ttl-panel-header { position: sticky; top: 0; z-index: 2; ... }
.ttl-src-grid, .ttl-tgt-grid { display: flex; flex-direction: column; gap: 20px; }
.ttl-page-item { ... } /* 取代 .ttl-page-row */
.ttl-panels-divider { width: 1px; background: var(--border); align-self: stretch; }
```

### 测试更新（58 tests pass）

| 测试文件 | 变更 |
|---|---|
| `TranslationLayout.test.tsx` | `.ttl-page-row` → `.ttl-src-grid .ttl-page-item`；`translate-pages-scroll` → `translate-src-scroll`/`translate-tgt-scroll`；6 embed → 3 embed（仅左侧）|
| `TranslationLayout.fitWidth.test.tsx` | mock target `translate-src-scroll`（非 `translate-pages-scroll`）；公式系数从 0.95/(2x) 调整为 0.92/1x |
| `TranslationLayout.docxTranslate.test.tsx` | `data-hovered-src-idx` 改为检查 `.is-hover` class（DOM-based hover） |
| `TranslationLayout.charHover.test.tsx` | 无需改动，全部通过 |
| `TranslationLayout.copy.test.tsx` | 无需改动，全部通过 |

## 行业调研

参考方案：
- **VS Code Diff Editor**：单虚拟滚动容器，locked scroll
- **Trados/Memoq（CAT Tools）**：段落级联动，找当前最顶段 → 对侧跳到对应段
- **Adobe Acrobat Compare**：独立双面板 + JS scroll sync

本实现选择：**独立双面板 + page-offset 映射**，与 PDF 页面结构天然对应，
等高页面（PDF/DOCX passthrough）退化为直接 scrollTop 同步（最优性能）。

## v5.1 更新（2026-06-23）

### 问题修复

**WASM 显示太大：**
- 原因：`PdfPageWASM` hardcode `scale=1.5`（PDF point 单位），但容器按 server pixel 宽 `pageW * userScale` 计算
- 修复：新增 `targetW/targetH` prop，传入 `p.pageW / p.pageH`，内部 `computedScale = targetW / originalWidth`
- 结果：canvas 恰好填满容器，不再溢出

**PDF embed 显示整本文档：**
- 原因：浏览器 `<embed type="application/pdf">` 加载整本 PDF（`#page=N` 仅滚动到该页），不限单页
- 修复：废弃 embed 模式，统一改用 `SourcePage`（服务端图片 + pdfium 文字层）
- pdf/images 模式在双栏中行为完全一致（仅 wasm 模式走 pdfium WASM canvas）

### 新功能

**源面板文字层（SourcePage 组件）：**
- 从 `/api/files/:taskId?as=text&n=N` 拉取 pdfium v4 text-layer HTML
- `annotateSourceTextLayer()` 遍历 run span，顺序查找文字在 `sourceText` 中的位置
- 为每个 span 打上 `data-src-idx-start` / `data-src-idx-end`
- 覆盖在源页面图片上（`position: absolute; inset: 0`）
- 支持浏览器原生文字选择（`user-select: text; cursor: text`）

**选区联动（selectionchange）：**
```
document.addEventListener('selectionchange') → {
  if (inSrc) collect [data-src-idx-start/end] → srcRange
  if (inTgt) collect [data-src-idx] → srcRange
  highlightBySourceRange(srcStart, srcEnd) → {
    srcScroll: [data-src-idx-start/end] overlapping range → .is-selected
    tgtScroll: [data-src-idx] ∈ [srcStart, srcEnd) → .is-selected
  }
  on isCollapsed → clearSelHighlight()
}
```

**hover 更新：**
- `highlightSrcIdx` 同时支持 `data-src-idx`（目标 char-level）和 `data-src-idx-start/end`（源 run-level）
- 源面板 hover 委托同时查找两种属性

### 测试（196 tests pass）

| 测试文件 | 变更 |
|---|---|
| `TranslationLayout.test.tsx` | 3 embed 测试改为验证 SourcePage / 无 embed |
| `TranslationLayout.selection.test.tsx` | 新增 4 个选区联动测试 |

## v5.2 更新（2026-06-23）

### 问题修复

**右侧选中几个字符、左侧高亮整行（run-level 粒度太粗）：**
- 原因：`annotateSourceTextLayer` v1 保留 run-level span（一整行一个 span → 选 2 字高亮整行）
- 修复：char-level 拆分 —— 每个 run span 按等宽切割成单字 span，`charW = runWidth / charCount`
- 每字 span 携带 `data-src-idx-start="${N}" data-src-idx-end="${N+1}"`
- 结果：选 2 字只高亮对应 2 字，粒度与目标侧 char-level 完全对等

**选区重影（双重高亮）：**
- 原因：`highlightBySourceRange` 同时给两侧加 `.is-selected`；用户选中侧已有浏览器原生蓝色选区 → 双重覆盖
- 修复：`skipSide?: 'src' | 'tgt'` 参数；`selectionchange` 传入 `inSrc ? 'src' : 'tgt'`，被选侧跳过 `.is-selected`
- 结果：只有对侧显示 `.is-selected`，自身依靠浏览器原生选区样式

**WASM canvas 与文字层 1px 错位：**
- 原因：`.pdf-page-wasm { display: flex; justify-content: center }` 居中 canvas；若 canvas 宽 < 父容器则向右偏移，与 `inset: 0` 的文字层错位
- 修复：去掉 flex 布局，改为 `position: relative; width: 100%; height: 100%`；canvas 从左上角 0,0 开始
- `noTextLayer` prop：WASM 内置 `page.getText()` 简单文字层与 SourcePage pdfium v4 定位文字层冲突 → `noTextLayer` 时跳过

### CSS 变更

```css
/* v5.2 修复：block 布局避免 canvas 横向偏移（原 flex justify-content:center 导致 1px 错位） */
.pdf-page-wasm {
  position: relative; width: 100%; height: 100%;
  background: white; border-radius: 4px; overflow: hidden;
}
/* 选区高亮 — 仅对侧，不与浏览器原生选区叠加 */
.pdf-text-layer span.is-selected {
  background-color: rgba(66, 133, 244, 0.28);
  box-shadow: 0 0 0 1px rgba(66, 133, 244, 0.6);
}
```

### 测试更新（196 tests pass）

| 测试文件 | 变更 |
|---|---|
| `TranslationLayout.selection.test.tsx` | 测试 1 改为验证 4 个单字 span（非 run-level）；测试 2/3/4 查找字改为单字 |

## 已知限制

- WASM 在 jsdom 测试环境下 pdfium 不可用，WASM 相关测试仅靠 mock 覆盖
