# OnlyOffice 转码 + PDF/图片双产物预览

> **生成模型**：Claude MiniMax-M3（MiniMax）
> **生成时间**：2026-06-20
> **状态**：✅ 完成，端到端跑通（DOCX 3 页、PPTX 16 页）

---

## 改动概览

把"Office → PDF"单链路升级为"Office → OnlyOffice → PDF → 服务端栅格化为缩略图 + 每页 PNG → 双模式前端预览"。同时按 `CLAUDE.md` 把 TDD 脚手架（Vitest + Playwright）补齐。

### Before / After 对比

| 维度 | Before | After |
| --- | --- | --- |
| 转码引擎 | OnlyOffice + 三段 fallback（HTTP / docker cp / wget） | OnlyOffice HTTP（生产）；HTTP 403 时 docker cp 兜底（本地开发） |
| 产物 | PDF 一份 | PDF + `thumb.png` + `pages/page-NNN.png` |
| 状态机 | 单段（convert + linearize） | 6 段：convert → linearize → thumb → pages → finalize |
| 配置 | 内联硬编码 | 集中到 `config.mjs`，支持环境变量覆盖 |
| 前端缩略图 | 文本徽章 | 服务端缩略图 + 骨架屏 + 「PDF+图片」徽章 |
| 前端预览 | 仅 pdf.js | 双模式：图片模式（`<img>` 列表）/ PDF 模式（pdf.js），localStorage 持久化 |
| 测试 | 无（仓库 0 个测试文件） | **68 个单测**（前端 36 + 后端 32）+ Playwright e2e |

---

## 新增 / 修改的关键文件

### 服务端
- `office-preview-app/server/src/config.mjs` — 新增 ONLYOFFICE_*, RASTERIZE_*, PDFTOPPM, PDFINFO 等配置
- `office-preview-app/server/src/converter.mjs` — 重写为 6 段状态机；抽出 `signOnlyOfficeRequest` 与 `parseOnlyOfficeResponse` 纯函数；HTTP 403 时本地 docker cp 兜底
- `office-preview-app/server/src/pdf-rasterize.mjs` — 新增 `rasterizeThumb` / `rasterizeAllPages` / `imageDimensions` / `fileSize`
- `office-preview-app/server/src/router.mjs` — 新增 `?as=thumb` / `?as=page&n=N` 路由；路径穿越防护；`/api/tasks` 剥离内部字段
- `office-preview-app/server/test/*.{mjs}` — 4 套单元测：config / converter / pdf-rasterize / router（32 tests）
- `office-preview-app/server/vitest.config.mjs` — Vitest 配置
- `office-preview-app/server/package.json` — 加 vitest devDep + test 脚本

### 前端
- `office-preview-app/web/src/types.ts` — Task 加 thumbUrl / pages[] / convertStage / pagesDone / pagesTotal / convertRasterizeMs；ConvertStatus 加 'rasterizing' / 'rasterized'；PreviewKind 加 'pdf-images'
- `office-preview-app/web/src/components/TaskCard.tsx` — 缩略图 + 骨架屏 + 「PDF+图片」徽章 + 阶段标签 + 进度 chip
- `office-preview-app/web/src/components/PreviewModal.tsx` — 模式切换 + localStorage 持久化 + 转码中进度条
- `office-preview-app/web/src/previewers/PdfImagesPreview.tsx`（新）— 虚拟滚动 `<img>` 列表
- `office-preview-app/web/src/previewers/index.tsx` — 双模式路由
- `office-preview-app/web/src/perf.ts` — 加 rasterizeMs 字段
- `office-preview-app/web/src/App.tsx` — busy 谓词加 'rasterizing'
- `office-preview-app/web/src/styles.css` — 缩略图/骨架屏/模式切换/进度条样式
- `office-preview-app/web/test/*.{ts,tsx}` — 4 套单测（36 tests）
- `office-preview-app/web/e2e/smoke.spec.ts` — Playwright e2e
- `office-preview-app/web/vitest.config.ts` / `playwright.config.ts` / `test/setup.ts`
- `office-preview-app/web/package.json` — 加 vitest + RTL + jsdom + @playwright/test devDeps + test/e2e 脚本
- `office-preview-app/web/tsconfig.json` — include test/e2e + types: node

---

## 验证

### 单元 / 集成测试

```bash
cd office-preview-app/server && npm test    # 32 passed (32)
cd office-preview-app/web && npm test       # 36 passed (36)
```

### 端到端真实环境（仅本地，需要 Docker）

```bash
# 1) 启动 OnlyOffice（已自带 5000+ 文档格式支持）
docker run -d --name onlyoffice -p 8080:80 \
  -e JWT_SECRET=mvtndSBp0a7fa400u81Cq2MSfddXD090 onlyoffice/documentserver

# 2) 启动后端
cd office-preview-app/server
ONLYOFFICE_HOST=http://localhost:8080 \
ONLYOFFICE_JWT_SECRET=mvtndSBp0a7fa400u81Cq2MSfddXD090 \
HOST_FOR_DOCKER=http://host.docker.internal:5180 npm start &

# 3) 启动前端
cd ../web && npm run dev &

# 4) 上传 + 验证
curl -X POST -F 'file=@files/GuoYaping_Resume_Full.docx' http://localhost:5180/api/upload
# 约 6 秒后：
curl http://localhost:5180/api/tasks | jq '.tasks[0] | {convertStatus,thumbUrl,pagesTotal,pagesDone}'
# { "convertStatus": "done", "thumbUrl": "...", "pagesTotal": 3, "pagesDone": 3 }
```

### Playwright e2e

```bash
cd office-preview-app/web
npx playwright test   # 自动起 server + vite，跑 smoke.spec.ts
```

---

## 已知限制 / 后续优化

1. **OnlyOffice 9.4 cache URL 路径 bug**：当前容器版本（9.4.0.129）的 cache 文件 URL 路径 `/cache/files/data/conv_xxx/output.pdf/output.pdf` 期望嵌套目录，但实际文件是平铺 `/output.pdf`，导致 HTTP 下载 403。本地开发自动回退到 docker cp（生产环境应使用配置正确的 OnlyOffice 版本或自行挂卷）。
2. **原生 PDF 不自动栅格化**：仅 `convert_pdf` 策略（DOCX/PPTX/XLSX）走转码流水线；原生 PDF 走 frontend 策略，目前没有缩略图。后续可在 `createTaskFromFile` 中对 frontend+pdf 也触发 `rasterizeThumb`。
3. **`PdfPreviewWASM.tsx` 未启用**：保留作未来优化入口，注释说明「pdfium WASM 返回空白 bitmap」暂未解决。
4. **`scheduler.mjs` / `multipart-compiler.mjs` 未启用**：用户要求保留作技术亮点素材，未清理。

---

## 相关文件

- `changes/backup-before-onlyoffice/` — 改造前的代码快照（含 MANIFEST.md5）
- `changes/onlyoffice-images-pipeline/diff.patch` — 本次完整 diff
- `changes/onlyoffice-images-pipeline/diffstat.txt` — diff 摘要
- `changes/onlyoffice-images-pipeline/manifest.txt` — git 状态
- 计划文件：`/Users/huabuyu/.claude/plans/resilient-dazzling-wall.md`