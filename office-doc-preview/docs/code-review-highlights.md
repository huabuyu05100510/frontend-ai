# office-doc-preview · 资深前端视角代码审查

> 审查维度：架构深度 / 性能工程 / 实现缺口 / 可挖掘亮点
> 模型：Claude Sonnet

---

## 全栈技术链路总览

| 层级 | 当前实现 | 技术深度标记 |
|---|---|---|
| 用户上传 | XHR + onprogress + FormData | 自研实时进度追踪 |
| multipart 解析 | 零依赖 Buffer 字节级扫描 | 可升级为编译器架构版 |
| 任务调度 | Round-Robin 进程池 | 已设计 SJF 升级版（未接入） |
| Office → PDF | soffice 多实例 + 独立 profile | 启动预热 + 重试切 profile |
| PDF 优化 | qpdf 线性化 + 原子重命名 | isLinearized 读前 4096B |
| PDF 渲染 | pdf.js Worker / PDFium WASM / pdftoppm | 三路降级链 |
| 视口虚拟化 | IntersectionObserver + tokenRef 取消 | 内存精确控制 |
| 可观测性 | usePerf Zustand + PerfPanel | 全链路指标 FPS 到 ETA |
| 文件服务 | node:http + Range 206 | ETag + 路径剥离 |

---

## 审查结论数字

| 维度 | 数量 |
|---|---|
| 已实现深度亮点 | 18 项 |
| 设计完成待集成 | 3 项 |
| 代码层改进项 | 5 项 |
| 可追加资深亮点 | 6 项 |

---

## 一、系统架构层亮点（6 项）

### 1. 三级渲染决策矩阵
**文件**：`config.mjs · RENDER_STRATEGY`

将所有格式静态分类为 `frontend / convert_pdf / unsupported`，服务端与前端共用同一张决策表。任何新格式只改一处，零业务逻辑散漏。

**价值**：高

---

### 2. soffice 进程池 + 独立 Profile 隔离
**文件**：`converter.mjs · slots / profiles`

每个并发槽位拥有独立 `UserInstallation` profile 目录（p0/p1…），消除 LibreOffice profile 文件锁冲突。失败时自动切换到下一个 profile 重试，实现进程级热备。

**价值**：高

---

### 3. 启动预热消除冷启动
**文件**：`converter.mjs · warmupAll()`

服务启动后立即对所有 slot 异步跑一次最小 docx 转换，触发 soffice 字体扫描 + profile 初始化（通常 5-15s）。首个真实任务到来时已无冷启动延迟。

**价值**：高

---

### 4. PDF 线性化 (Fast Web View)
**文件**：`pdf-optimize.mjs · linearizePdf()`

使用 `qpdf --linearize --object-streams=generate` 将 PDF 对象按页顺序重排。pdf.js 顺序读取流，首页数据在文件最前端，Range 请求不再跨越整个文件。

**价值**：高

---

### 5. 多引擎降级链路
**文件**：`previewers/ · pdf.js → WASM → pdftoppm`

同一份 PDF 支持三条渲染链路：
- ① pdf.js Worker（通用）
- ② `@hyzyla/pdfium` WASM（Chrome PDF 引擎，渲染速度 10x）
- ③ 服务端 pdftoppm 栅格化（超复杂页 pdf.js 需 15s，服务端预栅格后零延迟）

**价值**：高

---

### 6. 路由层路径信息剥离
**文件**：`router.mjs · /api/tasks`

任务列表响应中用解构 `{ originalPath, previewPath, ...rest }` 剥离服务器内部路径，防止文件系统结构泄露给前端。

**价值**：中

---

## 二、性能工程层亮点（7 项）

### 7. IntersectionObserver 视口虚拟化
**文件**：`PdfPreview.tsx · observer + rootMargin`

所有页面 slot 预先挂载 DOM（占位骨架），仅当进入视口时触发渲染。离屏页主动 `cancel RenderTask + cleanup PDFPageProxy + 重置 innerHTML`，精确控制内存占用。

**价值**：高

---

### 8. 渲染令牌取消模式（手写取消令牌）
**文件**：`PdfPreview.tsx · tokenRef`

每次 url/scale 变化递增 `tokenRef.current`，每个 `await` 后检查令牌是否仍与启动时一致。相当于轻量 AbortController，消除异步竞态——旧渲染任务完成后不会写入 DOM。

**价值**：高

---

### 9. 线性化检测读取优化
**文件**：`pdf-optimize.mjs · isLinearized()`

仅用 `fd.read` 读取文件前 4096 字节，检测 `/Linearized` 标志。对百 MB 级 PDF 无需全量读取，O(1) 空间判断是否需要重新线性化。

**价值**：中

---

### 10. 防抖落盘防止磁盘抖动
**文件**：`store.mjs · saveTasks() 300ms debounce`

转码过程中每秒多次 `updateTask`（ETA、elapsed、状态变更），通过 300ms 防抖合并写入 `tasks.json`，避免高频小写 I/O 造成 SSD 写放大。

**价值**：中

---

### 11. 指数退避轮询
**文件**：`App.tsx · delay *= 1.3, max 4000ms`

转码进行中轮询从 1500ms 开始，每次 ×1.3 增长至 4000ms 上限，任务结束立即停止。在实时性与服务器负载之间自适应平衡。

**价值**：中

---

### 12. 客户端指数平滑速度预测引擎
**文件**：`predictive-render.ts · VelocityModel`

用 α=0.3 指数平滑算法融合最近 5 次滚动采样，输出 `fast/medium/slow/idle` 速度等级 + `accelerating/decelerating` 趋势。自适应缓冲区大小随速度动态调整（1-6 页）。

**价值**：高

---

### 13. XHR 实时上传进度
**文件**：`store.ts · xhr.upload.onprogress`

不使用 `fetch`（不支持上传进度），改用 `XMLHttpRequest.upload.onprogress` 获取 `loaded/total`，实时更新 `uploadPct` 状态驱动进度条。

**价值**：中

---

## 三、基础设施层亮点（5 项）

### 14. 零依赖 HTTP 服务器 + Range 支持
**文件**：`server/src/index.mjs · node:http`

无 Express/Fastify，纯 `node:http` 实现路由分发、CORS、Range 请求（206 Partial Content）。Range 支持对音视频拖拽播放至关重要，浏览器 `<video>` 依赖此协议跳帧。

**价值**：高

---

### 15. 零依赖 multipart/form-data 解析
**文件**：`multipart.mjs · parseMultipart()`

纯 Buffer 字节级操作解析 multipart，无 busboy/formidable 依赖。边界扫描、头部提取、body 切片全部用 `Buffer.indexOf` 实现，正确处理中文文件名（UTF-8）。

**价值**：高

---

### 16. ETag 缓存验证
**文件**：`router.mjs · serveFile()`

文件响应携带 `ETag: size_hex-mtime_hex`，浏览器二次请求可发 `If-None-Match` 获得 304。linearized PDF 命中缓存后前端零下载延迟。

**价值**：中

---

### 17. soffice 高保真导出参数调优
**文件**：`converter.mjs · filterArgs()`

`Quality=90 JPEG`（视觉无损）+ `ReduceImageResolution=false` + writer/impress/calc 分别指定不同 Filter。权衡点明确：纯无损导致含大量图片的 PDF 膨胀到 200MB+。

**价值**：高

---

### 18. 原子重命名防止文件损坏
**文件**：`pdf-optimize.mjs · linearizePdf()`

线性化先写 `.tmp` 临时文件，完成后 `fs.renameSync()` 原子替换。即使进程中途崩溃，也不会产生损坏的中间文件，保证数据一致性。

**价值**：中

---

## 四、设计完成但未集成（3 项缺口）

> 这三处是代码库最大的"可信度缺口"——设计文件完整，但主流程未接入。

### 缺口 1：SJF 调度器 (`scheduler.mjs`)

完整的「最短作业优先 + 优先级抢占 + 负载均衡」调度器已设计，但 `router.mjs` 仍 import `converter.mjs` 的简单 round-robin。升级后可将用户上传（HIGH 优先级）插队至批量扫描任务前。

### 缺口 2：编译器架构 multipart 解析器 (`multipart-compiler.mjs`)

`Lexer → Parser → AST → Visitor` 完整实现，支持导出原始 AST 用于调试，并有降级 fallback。但 `router.mjs` 仍 import `multipart.mjs`，编译器版未接入主流程。

### 缺口 3：预测引擎的预渲染闭环

`PdfPreview.tsx` 已采集速度/方向并更新 `usePerf`，但 `predictNextPages()` 的返回值（下一批页号）从未触发 `renderPageInto()`。数据采集完整，预渲染动作尚未闭环。

---

## 五、代码层改进空间（5 项）

### 改进 1：DPR 硬编码为 1（Retina 屏幕渲染模糊）

`PdfPreview.tsx` line 105: `const dpr = 1`。Retina/HiDPI 屏需 `window.devicePixelRatio`（通常为 2），否则渲染分辨率减半，文字发虚。修复仅需 3 行：canvas 物理像素翻倍 + `ctx.scale(dpr, dpr)`。

### 改进 2：文本层手写 span 定位不精确

`PdfPreview.tsx` 手动遍历 `textContent.items` 构造 span，位置变换未处理字符间距/旋转文字。官方 `renderTextLayer()` API 已处理边缘情况，复制/搜索精度更高。

### 改进 3：WASM 预览器无 AbortController

`PdfPreviewWASM.tsx` 用普通 `fetch` 下载 PDF，url 变化时只设 `cancelled=true`，但 fetch 请求无法被中止。切换大文档时旧下载仍在消耗带宽。修复：`fetch(url, { signal: controller.signal })`。

### 改进 4：WASM 预览器仅单页渲染

`PdfPreviewWASM` 只渲染当前页到单个 canvas，换页须重新调用 `page.render()`，未复用 IntersectionObserver 虚拟化方案，大文档多页切换体验退化。

### 改进 5：`store.mjs` import path 顺序混乱

`store.mjs` 第 10 行已调用 `path.dirname()`，但 `import path` 在第 15 行。ES module 静态 hoist 不报错，但结构令人困惑，易被误认为 bug。

---

## 六、可追加的资深级亮点（6 项）

### 亮点 1：预测引擎驱动预渲染闭环（最容易落地的高价值改进）

将 `predictNextPages()` 结果接入 `renderPageInto()`：快速向下滚动时提前渲染 3-5 页，慢速阅读时仅预渲染 1 页。当前引擎已采集数据但未行动，闭环后即刻生效。

### 亮点 2：DPR 感知渲染（Retina 屏幕 demo 必备）

用 `window.devicePixelRatio` 替换硬编码 `dpr=1`，canvas 物理像素翻倍，`ctx.scale(dpr,dpr)` 缩放回 CSS 尺寸。在 Retina 屏幕 demo 时视觉差异肉眼可见。

### 亮点 3：OffscreenCanvas + Worker 线程渲染（主线程零阻塞）

将 pdf.js / PDFium 的 `canvas.getContext("2d")` 替换为 `OffscreenCanvas`，`transferControlToOffscreen()` 交给 Worker。滚动手势 100% 流畅，渲染不抢占主线程。

### 亮点 4：Service Worker 预览缓存（离线可用 + 秒开）

拦截 `/api/files/:id?as=preview` 请求，linearized PDF 缓存到 Cache API。重开已看过的文档零网络请求，弱网环境下体验等同本地文件。

### 亮点 5：真正流式 multipart 上传（大文件内存恒定）

当前 `readBody()` 将整体 body 收进 Buffer 再解析，500MB 文件峰值内存 >1GB。改用流式 multipart：数据边进边写盘，内存占用恒定 O(chunk_size)。

### 亮点 6：SJF 调度器集成（用户上传优先级插队）

现有 `scheduler.mjs` 已设计完整，接入 `converter.mjs` 替换 round-robin。用户主动上传（HIGH priority）可插队至批量扫描任务前，响应体感明显提升。

---

## 整体评价

项目在**架构决策层**（进程池 / 决策矩阵 / 多引擎降级链）和**性能工程层**（线性化 / 虚拟化 / 取消令牌 / 预测引擎）均有明显的资深工程师思维。

最大可信度缺口是「设计文件完整但未集成」——`scheduler.mjs`、`multipart-compiler.mjs`、预测引擎预渲染闭环三者若能整合进主流程，技术深度将从「有设计」跃升为「可运行的系统级工程」。

**DPR 修复是最简单的高回报改动**：仅需 3 行，但 Retina 屏幕 demo 时视觉冲击明显。
