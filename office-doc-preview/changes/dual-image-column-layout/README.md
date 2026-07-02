# 双栏对比 · 原文件布局预览 + 差异标注（Phase 3）

> 模型：claude-sonnet-4-6
> 日期：2026-06-22
> 对应需求：双栏对比必须显示原文档布局（图片 + 文字层 + 差异高亮），而非纯文本

## 问题

之前的 `DualColumnView` 是**纯文本**双栏对比，丢失了：
1. **原文档排版** —— 图片、表格、字体、缩进全部丢失
2. **页面边界** —— 看不出哪里换页
3. **视觉对照** —— 排版差异完全不可见

## 方案

### 1. 新增 `DualImageColumn` 组件

复用 `PdfImagesPreview` 已稳定的渲染管线：
- **每页一个 row**（CSS Grid 单滚动容器），左图 + 右图配对
- **图片 + 文字层 overlay**：`<img>` + `.pdf-text-layer` 透明叠加
- **scaleX 对齐**：v4.4 像素级对齐方案（已验证）
- **差异高亮**：fetch text-layer HTML 后，对 span 做内容匹配 → 加 `dic-diff-delete/insert` class

### 2. 左/右独立缓存

`textLayers` Map key 从 `page` 改为 `${side}:${page}` —— 左/右两侧独立 fetch、独立缓存、不冲突。

### 3. 路由分发（`DualLayout`）

```
有 pages（docx/pdf 经 PDFium 栅格化） → DualImageColumn（原文件布局）
无 pages（txt/md 纯文本）           → DualColumnView（纯文本 fallback）
```

## 改动文件

| 文件 | 变更 |
|---|---|
| `web/src/inspect/DualImageColumn.tsx` | **新增**：原文件布局双栏渲染，文字层懒加载，差异高亮 + scaleX 对齐 |
| `web/src/inspect/DualLayout.tsx` | 修复 `hasPages` 类型谓词 bug + `compare={compare! ? source : compare}` 逻辑错（现改为 `compare={compare}`） |
| `web/src/inspect/index.ts` | 导出 `DualImageColumn` |
| `web/test/DualImageColumn.test.tsx` | **新增 5 个测试用例**：grid 渲染、左右图片、不等页数空占位、无 pages 提示、差异高亮 class |
| `web/src/styles.css` | `.dic-*` 系列样式（grid 容器、page cell、图片、文字层、diff 颜色） |

## TDD 结果

```
npx vitest run test/DualImageColumn.test.tsx
→ 5/5 passed

npx vitest run  (full suite)
→ 125/125 passed（11 files, 0 regression）
```

## 性能与体验要点

- **单滚动容器同步**：CSS Grid 2 列 + 每 row 一对 cell，垂直滚动天然同步
- **图片懒加载**：`loading="lazy"` + `decoding="async"`
- **文字层懒加载**：useEffect 内异步 fetch，避免阻塞首屏
- **差异导航**：↑/↓ 按钮跳到上一处 / 下一处差异（`scrollIntoView` 平滑滚动）
- **错误隔离**：单页 fetch 失败不阻断其他页

## 关联 Phase

- **Phase 1**（完成）：`InspectCompareModal` God Component 重构为 9 个模块
- **Phase 2**（完成）：字符级跨栏 hover 联动（`pairIdx`）
- **Phase 3**（本次）：原文件布局 + 差异高亮
