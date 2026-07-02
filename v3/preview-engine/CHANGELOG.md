# 变更记录（preview-engine）

> 按时间倒序记录每次改动。格式：日期 · 主题 · 改了什么 / 为什么 / 验证。

---

## 2026-06-17

### IndexedDB 文件持久化缓存 + DOCX/XLSX/PPTX 渲染质量提升 + 协同闪烁修复
- **IndexedDB 文件缓存**（`cache/fileCache.ts`，零依赖原生 API）：新建 `preview-engine` DB / `files` Store；`cacheFile` 去重（name+size+lastModified）；`FilePreview` mount 时 `listCachedFiles()` 恢复文件列表（刷新免重传）；ingest 时异步 `cacheFile()` 持久化；顶部新增"已缓存 N 个文件 · 清除缓存"提示栏。
- **DOCX 渲染质量大幅提升**（`ooxml/docx.ts`）：
  - `Run` 新增 `fontSize`（`w:sz÷2` pt）、`color`（`w:color val` 转 `#RRGGBB`）、`underline`（`w:u` val≠none）、`strikethrough`（`w:strike/w:dstrike`）。
  - 新增 `list` Block 类型（`ordered/level`）：解析 `w:numPr`（numId+ilvl）+ `word/numbering.xml`（`w:abstractNum w:numFmt` 判断有序/无序，`w:num` 建 numId→ordered Map）。
  - 新增 `paragraph` 的 `spacingBefore/spacingAfter`（`w:spacing` twips→px）与 `indentLeft`（`w:ind w:left` twips→px）。
  - `loadDocx` 自动加载 `word/numbering.xml` 并透传 `numMap` 给 `parseDocx`。
  - `OfficeView.DocxBlockView`：run span 渲染 fontSize/color/textDecoration；list 渲染为 `<ol>/<ul>` 带层级缩进；paragraph 使用 marginTop/Bottom/paddingLeft。
- **XLSX 真实列宽/行高**（`ooxml/xlsx.ts`）：`SheetModel` 新增 `colWidths?/rowHeights?`；`parseSheet` 解析 `<col width>`（字符宽×7px）与 `<row ht>`（pt×4/3px）；`VirtualSheet` 用真实尺寸构建 `CumulativeIndex`，列头/单元格宽高随之动态匹配。
- **PPTX 实际幻灯片比例**（`ooxml/pptx.ts`）：`loadPptx` 解析 `ppt/presentation.xml` 的 `<p:sldSz cx cy>`（EMU）；`Slide` 新增 `slideWidth?/slideHeight?`；`SlideFrame` 按 96dpi 换算实际像素比例渲染，不再硬编码 16:9。
- **协同闪烁根治**（`PdfEditor.tsx`）：删除每次渲染重建的 `collab = { current: getCollab() }` 中间变量；全文改用稳定的 `collabRef.current!`；`refresh` useCallback 依赖改为 `[]`；协同 useEffect 依赖从 `[source, refresh, collab]` 变为 `[source, refresh]`—— WebSocket 不再因组件重渲染反复断连。新增 `PageList` 组件 + `useMemo` 按页分组 annotations（稳定引用）；`PageView` 包裹 `React.memo`，无关页面注解更新不触发 canvas 重绘。
- **验证**：tsc 0 错；196/207 测试通过（11 个预存 jsdom 环境失败不变）；构建成功。

### 图片 OCR 文本层 + DOCX/PPTX 虚拟化 + 真实样例验证
- **图片 OCR 文本层**：`renderers/ocr/layout.ts`（词框→渲染坐标缩放，纯函数已 TDD）+ `tesseract.ts`（按需从 CDN 动态加载 Tesseract.js，不进主包）。`ImageView` 新增「识别文字(OCR)」：识别后在图上叠加透明可选/可复制文本层，支持「显示译文」（mockTranslate，半透明底）与「复制全部」。
- **DOCX/PPTX 虚拟化**：新增可复用 `VirtualList`（估算高度渲染→挂载量测真实高度回填 `CumulativeIndex`→重算窗口，仅渲染视口+overscan）。`DocxBody` 改为按块虚拟化（双栏对比按行对齐，单滚动）；`PptxBody` 幻灯片列表虚拟化。
- **真实样例 + 端到端验证**：`scripts/gen-samples.mjs` 生成真实 `sample.docx`（标题/对齐/表格/真实 PNG 图片）、`sample.xlsx`、`sample.pptx`、`sample.xls`（真实 CFB+BIFF8，中文宽字符 SST）到 `samples/`；新增 `samples.test.ts` 用真实文件跑通真实 loader。`.xls` 经 BIFF 解析得到「名称/数量/苹果/3」。
- **验证**：tsc 0 错；**前端 207 测试通过**（新增 8）+ 服务端 17；构建成功（gzip 70.6KB）。拖 `samples/` 里的文件即可实测。

### XLSX 视口虚拟化（去掉截断，支撑超大表）
- **问题**：原 `SheetTable` 截断 500 行 × 60 列，违背“极致性能”。
- **实现**：新增 `VirtualSheet`，行列双轴各用一个 `CumulativeIndex` 计算可见区间（O(log n)），仅渲染视口内 + overscan 的单元格；绝对定位 + 行号/列头（`indexToCol` 0→A/26→AA，已 TDD 与 `colToIndex` 互逆）；`rAF` 节流滚动。`SheetBody`（含双栏对比与 `LegacyOfficeView` 的 BIFF 回退）全部改用虚拟化。
- **验证**：xlsx 测试 8 通过；tsc 0 错；构建成功。

## 2026-06-16

### 修复 DOCX 图片/对齐 + 本地服务端真转换（旧版二进制 doc/xls/ppt）
- **DOCX 图片**：`docx.ts` 解析 `w:drawing/a:blip` 的 `r:embed` + `wp:extent`(EMU→px)，`loadDocx` 读 `word/_rels/document.xml.rels`(新增 `parseRels`) 解析 rId→media，读出 `word/media/*` 字节生成对象 URL；`OfficeView` 新增 image 块渲染（真实 `<img>`）。
- **DOCX 对齐**：解析 `w:jc`(both/distribute→justify)，段落/标题/图片按对齐渲染（之前完全没解析对齐，故“对齐有问题”）。
- **本地服务端 /convert（之前只给降级提示，现真正落地）**：
  - `server/cfb.mjs`：零依赖 CFB(OLE2 复合文档)读取（FAT/DIFAT/mini-FAT 链、按名取流）。
  - `server/xlsLegacy.mjs`：零依赖 BIFF8 `.xls` 解析（SST 跨 CONTINUE/边界重置压缩标志、LABELSST/RK/MULRK/NUMBER/LABEL/BOUNDSHEET）→ sheet model。
  - `server/convert.mjs`：优先 **LibreOffice headless**(doc/xls/ppt 高保真→OOXML)，本机未装时 `.xls` 走**内置 BIFF 回退**；`server.mjs` 新增 `POST /convert?ext=`(CORS + 600MB 上限)。
  - 客户端 `convertClient.ts` + `LegacyOfficeView.tsx`：拿到 OOXML 字节复用 `OfficeView`，拿到 sheet model 直接复用 `SheetBody`(含翻译对比)；`FilePreview` 把 doc/xls/ppt 接到真转换。
- **TDD/验证**：新增 CFB(3)/BIFF(1) 服务端测试 + DOCX 图片对齐(5) 前端测试；**前端 199 通过 + 服务端 17 通过**；`/convert` 用合成 `.xls` 端到端跑通（builtin-biff 返回正确单元格）；tsc 0 错；构建成功；8787/5180 在线。
- **说明**：本机未安装 LibreOffice，故 doc/ppt 走该路径时返回安装提示 `brew install --cask libreoffice`（装后即高保真）；`.xls` 已可零依赖本地真预览。

### Office 结构化预览 + 翻译对比（DOCX / XLSX / PPTX）
- **设计基准**：新增 `office-preview-spec.md`。立场——Office **转结构化而非位图**，保证“还原度高 + 可复制 + 可翻译”。旧二进制 doc/xls/ppt(CFB) 明确划归服务端转换。
- **零依赖 OOXML 内核（TDD）**：
  - `ooxml/zip.ts`：从尾部回扫定位 EOCD → 解析中央目录 → `DecompressionStream('deflate-raw')` 解压条目（不依赖任何 npm 包）。
  - `ooxml/xml.ts`：命名空间感知的极简 XML 解析器（元素/属性/文本/自闭合/声明/注释/CDATA/实体），纯函数、不依赖 DOMParser。
- **三格式提取器（TDD，纯逻辑）**：
  - `ooxml/docx.ts`：`document.xml → Block[]`（标题 pStyle、加粗/斜体 run、表格行列），保持文档顺序。
  - `ooxml/xlsx.ts`：sharedStrings + sheet → `SheetModel`，含 A1↔行列换算、共享串/内联串/数值取值。
  - `ooxml/pptx.ts`：`slideN.xml → Slide[]`，逐形状提取文本与 EMU 坐标。
- **翻译层（TDD）**：`translation/translate.ts` 的 `extractUnits`(docx/sheet/slide) + `applyTranslations`(缺译回退原文) + 可替换的 `mockTranslate` 词典引擎。
- **渲染器**：`OfficeView.tsx` 三视图（文档流 / 虚拟网格 / 幻灯片定位）+ **原文 / 译文 / 双栏对比** 切换，文本节点真实保留（可选可复制）。`FilePreview` 接入 docx/xlsx/pptx 分发，doc/xls/ppt 诚实降级到服务端转换提示。
- **端到端集成测试**：用真实 deflate 压缩造合法 OOXML zip 字节，验证 `loadDocx/loadXlsx/loadPptx` 的 ZIP→解压→解析 全链路。
- **验证**：tsc 0 错；**191 测试通过**（新增 38）；构建成功（gzip 67KB）；dev 5180 在线。

### 三轮修复：重影(强制透明) + 公式/符号渲染(cMap/标准字体)
- **重影根因再定位**：文本层文字未真正透明 → canvas 字 + 文本层回退字体字错位叠加。`styles.css` 对 `.textLayer span` 及 `::selection/::-moz-selection` 用 `color/-webkit-text-fill-color: transparent !important`，压过任何 UA/内联样式，文字恒不可见（仅供选区/复制）。
- **公式/符号渲染**：`getDocument` 增加 `cMapUrl` + `cMapPacked` + `standardFontDataUrl`（jsdelivr 提供 pdfjs-dist 包内 cmaps/standard_fonts）。非嵌入标准字体的文本（含大量数学符号）与 CJK 现可正确栅格化。`pdfjsLoader.ts` 导出 `PDFJS_CMAP_URL` / `PDFJS_STD_FONTS_URL`。
- **验证**：tsc 0 错；153 测试通过；构建成功。

### 二轮修复：默认选择模式 + 划词高亮 + 彻底消重影
- **默认工具改为「选择」**：进入即可划词复制，符合预期。
- **划词高亮（Acrobat/飞书式）**：高亮工具下文本层可交互、光标为文本选择样式；选中文字后 `mouseup` 读取选区 `getClientRects()` 逐行字形矩形 → 转归一化 → 贴合生成高亮，不再是拖框。`rect` 工具保留拖框。
- **重影彻底修复**：仅置 `color:transparent` 不够——WebKit/Blink 选中时用 `-webkit-text-fill-color` 覆盖。`styles.css` 对 `span` 与 `::selection` 同时置 `color` 与 `-webkit-text-fill-color` 为透明，选中文字不再显形。
- **指针层级**：文本层在「选择/高亮」可交互（`pointer-events:auto`），其余工具交给 SVG 绘制层。
- **验证**：tsc 0 错；153 测试通过；构建成功。

### 修复三个用户反馈问题（高亮/导出/选中重影）
- **选中重影**：浏览器选中时会用高亮文字色覆盖 `color:transparent`，使文本层字形显形并与 canvas 字形错位 → 重影。修复：`styles.css` 增加 `.textLayer span::selection { color: transparent }`，选中态文字仍透明，只留高亮底色；补 `.endOfContent` 样式；移除 `.textLayer` 的 `z-index`。
- **高亮不行**：文本层 `z-index:1` 盖在无 z-index 的 SVG 之上，层级语义含糊。修复：`PdfEditor.tsx` 显式分层 canvas(1) < 文本层(2) < 批注 SVG(3)，绘制层恒在最上可靠接收指针；并在 effect cleanup 清空文本层 + `TextLayer.cancel()`，消除严格模式竞态。
- **导出批注不行**：Helvetica(WinAnsi) 无法编码中文便签 → `drawText` 抛错使整个导出失败。修复：`exportPdf.ts` 加载失败明确报错；逐操作 try/catch；非 Latin 文本回退为标记框，不再中断整体导出。
- **验证**：tsc 0 错；153 测试通过；构建成功。


### 协同服务端 ✅ 完成 — 零依赖 Node WebSocket，跑通真·多端协同
- **背景**：此前 `CollabDoc`（CRDT）只在客户端，无传输层，无法真正多端同步。用户要求「写一个服务端，务必把链路跑通」。
- **方案**：零依赖 Node WebSocket 服务端（仅用内置 `http`/`crypto`，自实现握手 + 帧编解码），复用 `CollabDoc` 的 LWW 决胜规则。规避反复出现的 npm 安装失败。
- **协议**：client→server `{t:'join',room}` / `{t:'op',update}`；server→client `{t:'snapshot',snapshot}` / `{t:'op',update}`；外加 `awareness` 透传。
- **TDD / 文件**：
  - `server/wsFrame.mjs` + `__tests__/wsFrame.test.mjs`（7 测试，node --test）：acceptKey RFC6455 向量、文本帧编码（126 扩展长度）、解掩码、粘包、半包保留 rest、close 帧识别。
  - `server/room.mjs` + `__tests__/room.test.mjs`（6 测试）：LWW 决胜（时钟/clientId 平局）、墓碑删除、幂等。
  - `server/server.mjs`：http upgrade → WebSocket，按房间维护权威态，新成员下发快照，仅状态真变时广播。`server/package.json`（start/test 脚本）。
  - 客户端 `demo/src/collab/CollabClient.ts` + `__tests__/CollabClient.test.ts`（5 测试）：`handleServerMessage` 纯函数（snapshot/op/旧 op 不覆盖/未知类型）+ 断线重连。
  - `PdfEditor.tsx` 接入：每标签唯一 clientId；新增/删除/撤销/重做/模拟协作者均广播；远端 op/快照自动合并刷新；工具栏加协同连接状态灯。
- **验证**：
  - 前端 tsc 0 错；vitest 153 测试通过；`vite build` 成功（bundle 仍 ~186KB，CDN 不打包）。
  - 服务端 `node --test` 13 测试通过。
  - **端到端 `server/e2e.mjs`**：两个 WebSocket 客户端同房间 → B 后加入收到含 A 写入的快照 + B 实时收到 A 的新 op，全 PASS。
- **启动方式**：协同服务端 `cd server && npm start`（默认 8787）；前端 `cd demo && npm run dev`（可设 `VITE_COLLAB_URL` 指向服务端）。两个浏览器窗口开同一 PDF 即实时同步批注。

### PDF 文本层 — 可框选 / 复制
- **问题**：之前只有 canvas + 注解层，缺「文本层」，无法选中复制文字。
- **改动**：
  - `PdfEditor.tsx` `PageView`：canvas 渲染后用 PDF.js `TextLayer`/`renderTextLayer` 生成透明可选中文本层（`getTextContent` + CSS px 视口 + `--scale-factor`）；按工具态切换三层 `pointer-events`（选择→文本层可选，绘制→ SVG 捕获）；单个注解即使在选择模式仍可点选。
  - `styles.css`：新增 `.textLayer` 官方样式（`color:transparent` + `::selection` 高亮）。
- **验证**：tsc 0 错；148 测试通过；构建成功。

### PDF 编辑引擎 — 替换只读 iframe 为自研引擎（spec → plan → TDD）
- **问题**：原 PDF 预览是浏览器只读 `<iframe>`，不可编辑。
- **新增 spec**：`pdf-editor-spec.md`（渲染内核/编辑层/协同层/导出层边界）。
- **TDD 纯逻辑模块**（共 31 测试）：
  - `renderers/pdf/anchor.ts`：坐标无关锚点，归一化↔屏幕，含 90/180/270 旋转往返一致（12 测试）。
  - `renderers/pdf/AnnotationModel.ts`：注解类型/创建/命中测试/手绘包围盒（11 测试）。
  - `renderers/pdf/exportOps.ts`：注解→与库无关绘制描述符，左上↔左下坐标翻转、颜色解析（8 测试）。
- **集成层**：
  - `renderers/pdf/pdfjsLoader.ts`：运行时 CDN（esm.sh）动态加载 PDF.js / pdf-lib，绕开 npm 网络限制，bundle 仅 ~183KB。
  - `renderers/pdf/exportPdf.ts`：描述符 → pdf-lib 真实绘制 → 下载带批注新 PDF。
  - `components/renderers/PdfEditor.tsx`：自渲染逐页（IntersectionObserver 懒加载）+ 工具栏（高亮/矩形/手绘/便签）+ Overlay + 撤销/重做 + 模拟协作者 + 导出；CDN 不可达自动降级只读 iframe，不白屏。
  - `FilePreview.tsx`：PDF 分支由 `PdfView` 改为 `PdfEditor`；删除 `PdfView.tsx`。
- **验证**：tsc 0 错；148 测试通过；`vite build` 成功。
