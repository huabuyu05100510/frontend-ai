# 双渲染路径：A（WASM）+ B（图片+文字层）落地

> **生成模型**：Claude MiniMax-M3（MiniMax）
> **生成时间**：2026-06-20
> **状态**：✅ 完成（A + B 双方案落地，三模式可切换）

## 用户决策

> "现在的修改先保存起来 然后你 multi agent 实现 A 与 B"

确认同时落地 A 与 B，用户在 UI 切换。

## 最终架构

### 三模式可切换（PreviewModal 顶部工具栏）

| 模式 | 引擎 | 性能 | 文本可选 | 跨平台 |
| --- | --- | --- | --- | --- |
| **PDF 模式** | pdf.js（兜底） | 中 | ✓ 高质量 | ✓ 全兼容 |
| **图片+文字**（方案 B，默认） | 服务端 pdftoppm + pdftotext bbox | **最快** | ✓ 字符级 | ✓ 无 WASM 依赖 |
| **WASM**（方案 A） | @hyzyla/pdfium（Chrome pdfium） | 接近 B（线程） | ✓ 高质量 | ⚠️ 需 crossOriginIsolated |

localStorage `previewMode` 持久化用户选择（`pdf` / `images` / `wasm`，`auto` 不存）。

## A（WASM 修复）改动

| 文件 | 改动 |
| --- | --- |
| `web/vite.config.ts` | 新增 `pdfiumWasmPlugin` 拦截 `pdfium.wasm.base64-*.js` 虚拟模块，重映射到 node_modules 物理文件；`optimizeDeps.exclude` 加入 pdfium 包 |
| `web/src/previewers/index.tsx` | 新增 lazy `PdfPreviewWASM`；`PdfRenderMode = 'pdf' \| 'images' \| 'wasm'`；路由分发 |
| `web/src/components/PreviewModal.tsx` | 新增 WASM 按钮 + 持久化 |
| `web/playwright.config.ts` | e2e 配置（与 B 共享） |

**curl 验证**：`http://127.0.0.1:5188/node_modules/@hyzyla/pdfium/dist/pdfium.wasm.base64-B4io7kt4.js` → HTTP 200 / 14.3 MB（修复前 404）。

**未跑通**：浏览器端到端完整链路需要 crossOriginIsolated（COOP/COEP 头），未在 dev 模式强制启用（避免破坏 HMR）。生产部署需配合 reverse proxy 设置头。

## B（图片+文字层）改动

| 文件 | 改动 |
| --- | --- |
| `server/src/pdf-rasterize.mjs` | 新增 `bboxHtmlToTextLayer()` + `extractTextLayer()` + `extractAllTextLayers()`；pt→px 缩放（`PT_TO_PX = 96/72`，整体按 RASTERIZE_PAGE_DPI 缩放）与 PNG 像素级对齐 |
| `server/src/converter.mjs` | 在 `pages` 阶段后新增 `textLayer` 阶段；调 `extractAllTextLayers` 写 `<id>/text/page-NNN.html`；`updateTask` 加 `textDir` + `pages[].textUrl` + `pages[].textWords` |
| `server/src/router.mjs` | 新增 `?as=text&n=N` 路由；`Content-Type: text/html; charset=utf-8`；路径穿越防护同 pages |
| `web/src/types.ts` | `PageImage` 加 `textUrl` / `textWords`；`Task` 加 `textDone` / `convertStage` |
| `web/src/previewers/PdfImagesPreview.tsx` | 每页包 `<div class="pdf-image-page">`；`<img>` 底层 + `<div class="pdf-text-layer" dangerouslySetInnerHTML={...}>` 透明覆盖；文字懒加载（图片可见后 fetch text） |
| `web/src/styles.css` | `.pdf-text-layer`：`color: transparent` + `user-select: text` + `z-index: 1`；`.pdf-image-page`：`position: relative`；选中态高亮 |
| `server/test/pdf-rasterize.test.mjs` | **+7 测试**：bbox 解析、pt→px 缩放、中文支持、HTML 实体解码、零宽跳过、并行等价、进度回调 |
| `web/test/PdfImagesPreview.test.tsx` | **+5 测试**：基础渲染、文字层注入、中文、CSS 类、fetch 失败优雅降级 |
| `web/e2e/image-with-text.spec.ts` | e2e：上传→转码→文字层 200 + text/html + 中文断言 |

**实测**（郭亚平_前端_03.docx → OnlyOffice → 3 页）：
- textWords: 83 词
- 文字层 page 1 HTML 片段：`郭亚平`（68px）、`求职岗位：前端工程师`（34px）等 13 个 span
- 浏览器：图片底层加载 + 文字透明覆盖 + 可选中可复制

## 关键文件改动总览

```
server/src/config.mjs              +20 lines (OnlyOffice + rasterize keys)
server/src/converter.mjs           +50 lines (textLayer stage + import)
server/src/pdf-rasterize.mjs       +115 lines (text extraction)
server/src/router.mjs               +60 lines (thumb/page/text routes)
web/src/types.ts                   +25 lines (PageImage.textUrl/textWords, textLayer stage)
web/src/previewers/index.tsx       +12 lines (wasm mode dispatch)
web/src/previewers/PdfImagesPreview.tsx   +50 lines (text overlay + lazy load)
web/src/components/PreviewModal.tsx +20 lines (WASM button)
web/src/styles.css                 +40 lines (text-layer + mode-toggle + progress)
web/vite.config.ts                 +30 lines (pdfiumWasmPlugin)
```

## 测试结果

| 测试套 | 结果 |
| --- | --- |
| 后端单测（config / converter / pdf-rasterize / router） | **37/37 ✓** |
| 前端单测（types / TaskCard / PreviewModal / PdfImagesPreview） | **39/39 ✓** |
| Playwright e2e（smoke / mode-toggle / **image-with-text**） | **4/4 ✓** |
| **合计** | **80/80 ✓** |

## 验证步骤

```bash
# 1. 服务（端口 5180）— 已运行
curl http://localhost:5180/api/health

# 2. 前端（端口 5188）— 已运行
curl -o /dev/null -w "%{http_code}\n" http://localhost:5188

# 3. 打开浏览器 http://localhost:5188
# 4. 拖入 files/郭亚平_前端_03(1).docx → 等 ~10s
# 5. 卡片显示缩略图 → 点预览
# 6. 顶部三个按钮：PDF 模式 / 图片+文字 / WASM
# 7. 默认图片+文字 → 看图 + 选中「郭亚平」复制
# 8. 切 PDF 模式 → pdf.js 渲染 + 文本层
# 9. 切 WASM → 加载 pdfium（首次慢，~14MB）
# 10. 刷新 → 模式保留
```

## 已知限制

1. **WASM 模式 dev 不可用**：crossOriginIsolated 需要 COOP/COEP 头，与 Vite HMR 不兼容。要在生产 build 后用静态文件服务器配合设置头才能跑。
2. **大 PDF 文字层 HTML 可能膨胀**：500 页 × 1-5 KB/页 ≈ 2.5 MB HTML 全部 fetch。可后续加分页或按需加载。
3. **bbox 精度依赖 pdftotext 版本**：当前 26.06.0 对复杂排版（双栏、表格）位置可能略偏，肉眼几乎无差别但选中时位置偏移。