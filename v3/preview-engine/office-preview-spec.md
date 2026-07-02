# Office / 图片 在线预览引擎 — 技术规格（结构化 + 翻译对比）

> 范围：DOCX、XLSX/XLS、PPTX/PPT、图片(jpg/png/bmp 等)。
> 目标：高保真预览 + **可复制** + **翻译前后对比**（呼应 work.md：文档翻译/还原度高/可复制）。
> 复用既有内核：FormatProbe / CapabilityRouter / 虚拟化 / 渐进加载 / CollabDoc。

---

## 0. 立场与边界

| 格式 | 路径 | 理由 |
|------|------|------|
| **DOCX / XLSX / PPTX** | **客户端解析 OOXML（ZIP+XML）→ 结构化模型** | 不转图：保证可复制、可回填译文、可双栏对比 |
| **DOC / XLS / PPT（旧二进制 CFB）** | **服务端转换**（降级提示） | 旧 BIFF/PPT 记录格式属服务端工程，不在本期客户端范围 |
| **图片** | **浏览器原生**（已实现 ImageView） | `createImageBitmap`→canvas，缩放/平移 |

> 关键原则：**Office 转结构化而非位图**。这是“还原度高 + 可复制 + 可翻译”的前提。

---

## 1. 分层架构

```
File/Blob
  │ FormatProbe（魔数：OOXML=ZIP 头 PK\x03\x04，再看内部 [Content_Types].xml）
  ▼
OOXML 内核（零依赖）
  ├─ zip.ts   解析中央目录 + DecompressionStream('deflate-raw') 解压条目
  └─ xml.ts   极简 XML → 轻量树（命名空间感知，纯函数可测）
  ▼
格式提取器（纯逻辑，TDD）
  ├─ docx.ts  document.xml → Block[]（段落/标题/表格/列表）
  ├─ xlsx.ts  workbook + sharedStrings + sheetN → SheetModel（行列/单元格）
  └─ pptx.ts  slideN.xml → Slide[]（文本框/坐标）
  ▼
翻译层（TDD）
  ├─ extractUnits  结构 → 可译单元 {id, text, ref}
  └─ applyTranslation  译文按 id 原位回填 → 双语模型
  ▼
React 渲染器
  ├─ DocxView  block 流式渲染 + 双栏/叠加对比
  ├─ SheetView 虚拟化网格（复用 CumulativeIndex）
  ├─ PptxView  按页文本框定位
  └─ ImageView（已存在）
```

---

## 2. OOXML 内核

### 2.1 zip.ts（零依赖 ZIP 读取）
- 定位 EOCD（End Of Central Directory，签名 `PK\x05\x06`，从尾部回扫）。
- 读中央目录项：文件名、压缩方法（0=stored / 8=deflate）、压缩/解压尺寸、本地头偏移。
- 取条目：读本地头跳到数据；stored 直接切片；deflate 用 `DecompressionStream('deflate-raw')`。
- 纯逻辑（目录解析、头解析）可单测；解压用 Web 标准流（Node22/浏览器均内置）。

### 2.2 xml.ts（极简 XML 解析）
- 递归下降，产出 `{ tag, attrs, children, text }` 树；处理自闭合、属性、文本、跳过 `<?…?>`/注释。
- 命名空间按原样保留（`w:p`、`a:t`），提供 `findAll(tag)` / `firstText()` 辅助。
- 纯函数，Node 环境可测（不依赖 DOMParser）。

---

## 3. 提取器模型

```ts
// 文档（DOCX）
type Block =
  | { type:'heading'; level:number; runs:Run[] }
  | { type:'paragraph'; runs:Run[] }
  | { type:'table'; rows:Run[][][] }
interface Run { text:string; bold?:boolean; italic?:boolean }

// 表格（XLSX）
interface SheetModel { name:string; rows:number; cols:number; cells:Map<string,Cell> } // key "r,c"
interface Cell { r:number; c:number; text:string; t?:'s'|'n' }

// 演示（PPTX）
interface Slide { index:number; texts:{ text:string; x:number; y:number }[] }
```

---

## 4. 翻译对比（核心差异化）

- **抽取**：任意结构 → `TransUnit{ id, text, ref }`（ref 指回 block/cell/textbox）。
- **回填**：`apply(units, translations)` → 双语模型；缺译回退原文。
- **两种视图**：
  - **双栏**：左原文 / 右译文，段落（或单元格、文本框）一一对齐、滚动联动。
  - **叠加**：同版面切换原文/译文。
- **可复制**：所有渲染保留真实文本节点（DOCX block 文本、表格单元格、PPTX 文本）。
- 离线无翻译引擎：内置 `mockTranslate`（可注入真实 API），用于演示链路（如加 `[译] ` 前缀或字典替换）。

---

## 5. 大文件与性能

- XLSX 大表：`CumulativeIndex` + 视口调度，仅渲染可视行列；共享字符串懒解析。
- DOCX 长文：block 列表虚拟化。
- 解压按需：只解压当前需要的 part（如先 document.xml）。

---

## 6. TDD 范围

| 模块 | 测试点 |
|------|--------|
| zip.ts | EOCD 定位；中央目录项解析；stored 读取；deflate 往返（CompressionStream 造数据） |
| xml.ts | 嵌套/自闭合/属性/文本；命名空间标签；findAll/firstText |
| docx.ts | 段落、标题(pStyle)、加粗 run、表格 → Block[] |
| xlsx.ts | sharedStrings 解析；inlineStr/数字；坐标 A1→(r,c)；SheetModel |
| pptx.ts | slide 的 `<a:t>` 文本与顺序 |
| 翻译 | extractUnits 唯一 id；apply 回填与缺译回退 |

集成层（React 渲染、CDN 无关）：手测 + 构建校验。

---

## 7. 验收

| 场景 | 验收 |
|------|------|
| 拖入 DOCX | 结构化渲染，段落/标题/表格，文本可选可复制 |
| 拖入 XLSX | 虚拟化网格，单元格文本正确，大表流畅 |
| 拖入 PPTX | 逐页文本框定位呈现 |
| 旧 .doc/.xls/.ppt | 明确提示走服务端转换（降级不白屏） |
| 翻译对比 | 双栏原文/译文对齐，可切换，译文可复制 |
| 图片 | 原生预览（已具备） |
