# 修复：图片+文字预览复制错位（第二轮）

## 问题（第一轮修复后仍存在）
第一轮把 API width/height 改成每页栅格化 PNG 真实尺寸，但仍有错位。

## 第二轮根因（文字层结构）
`bboxHtmlToTextLayer` 用了**行容器 `<p> display:flex; align-items:flex-end`** 来定位整行，
行内 word `<span>` 用 `margin-left / margin-top` 相对 `<p>` 偏移。

但 flex 布局的 `align-items: flex-end` 会让 span 的**底部**对齐到容器底部，
而 margin-top 会让 span 进一步下移溢出容器。
→ DOM span 实际位置 ≠ 计算出的 bbox 坐标 → 选中框漂移。

## 修复

### server/src/pdf-rasterize.mjs
**抛弃 `<p>` 行容器 + flex**，每词直接 `position:absolute` 定位到 `.pdf-text-layer` 根 div：
```html
<div class="pdf-text-layer" data-page-w="1020" data-page-h="1320">
  <span style="position:absolute;left:133.33px;top:937.33px;width:66.67px;height:12px">Hello</span>
  <span style="position:absolute;left:206.67px;top:937.33px;width:60px;height:12px">World</span>
  ...
</div>
```
- 每个 span 坐标 = bbox × scale，是页面像素空间下的绝对位置
- 与栅格化 PNG 坐标系 1:1 对齐，无 flex 二次计算干扰
- 文字层根 div 带 `data-page-w / data-page-h` → 前端兜底源

### web/src/previewers/PdfImagesPreview.tsx
- 缓存文字层时同时缓存 `pageW / pageH`（从 `data-page-w/h` 解析）
- wrapper 尺寸优先级：**text-layer data-page-w/h > API width/height > 默认 800×1130**
  - 兼容老任务脏数据（API 仍返回 300×424 缩略图尺寸的情况）
- 每页 `.pdf-image-page` 同时带 `data-page-w / data-page-h` 属性，便于 e2e 抓取

### web/src/styles.css
`.pdf-text-layer span` 改为 `position: absolute; display: block`，移除旧的 `<p>` 容器样式。

## TDD 测试覆盖

### server/test/pdf-rasterize.test.mjs（+4）
- "每词都是 position:absolute（无 flex 行容器干扰）"
- "ascender 校正：top = yMin + 25% rawH"
- 更新原有结构相关断言（移除 `<p>`，改为 `<span position:absolute>`）
- `extractTextLayer` 的 word 计数改为 `<span ` 计数

### web/test/PdfImagesPreview.test.tsx（+4）
- "API 返回老脏数据（thumb 尺寸）时，wrapper 仍按 text-layer data-page-w/h 缩放"
- "text-layer 未返回 data-page-w/h 时，wrapper 兜底用 API width/height"
- "新结构：每词都是 position:absolute 的 span（无 <p> 行容器）"
- "每页 wrapper 同时带 data-page-w / data-page-h 属性"

### web/e2e/text-image-alignment.spec.ts（更新）
- "API 维度：text layer bbox 坐标必须落在 page.width/page.height 内" 改为解析新 span 结构
- 校验 `data-page-w/h` 与 `page.width/height` 一致
- 校验 HTML 中无 `<p>` 容器

## 验证

| 项目 | 数量 | 状态 |
|---|---|---|
| server vitest | 42 | ✅ |
| web vitest | 46 | ✅ |
| vite build | 1 | ✅ |

## 用户操作清单

修复已部署，**需要重启后端 + 重新上传文件**才能看到效果：
1. 重启 server: `cd office-preview-app/server && npm run dev`
2. 在前端重新上传 PDF/docx 触发新一轮转码（OnlyOffice → pdftoppm → pdftotext）
3. 打开预览，鼠标拖选文字 → 蓝色选区与图片文字 1:1 对齐，可正常复制

## 模型
Claude MiniMax-M3（MiniMax）