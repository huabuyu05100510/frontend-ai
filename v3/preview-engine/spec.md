# 通用文件在线预览引擎 — 技术方案 v1.0

> 对标：Google Drive Viewer / 飞书文档预览 / 微软 Office Online / WPS 在线预览 / Dropbox Paper / Figma（协同模型）
> 覆盖范围：`work.md` 中讯飞翻译平台全部文件格式 —— 23 种文档、4 种图片、9 种音频（1G+）、10 种视频（1G+）、SRT 字幕、网页
> 定位：一套**「打开即所见、所见即可编辑、编辑即协同」**的前端预览内核，极致首屏 + 恒定内存 + 帧率不掉。

---

## 0. 设计目标与原则

| 维度 | 目标 | 量化指标 |
|------|------|----------|
| **即时可见** | 点击/拖入即出内容，不等加载 | **首个内容像素 < 100ms**（含 1GB 文件），骨架 < 16ms |
| **极速高清** | 感知瞬开，高清无感替换 | 高清首屏 < 400ms；视频起播 < 300ms |
| **恒定内存** | 大文件不爆内存 | 1GB 视频/千页 PDF/百万行表格，常驻 < 256MB |
| **不掉帧** | 滚动/缩放/拖拽永远跟手 | 滚动稳定 60FPS，输入延迟 INP < 100ms，主线程长任务 0 |
| **全格式** | 一个入口吃全部 | 56+ 扩展名，统一交互 |
| **可编辑** | 预览态无缝转编辑态 | 批注 / 文本 / 单元格 / 字幕 / 剪辑，零跳转 |
| **可协同** | 多人实时 + 离线 | CRDT 最终一致，断网可编辑，弱网 < 100ms 同步感知 |

> **核心理念：把「感知性能」和「完整保真」彻底拆开。** 用户要的是「点了立刻看到东西」，而不是「等整页高清渲染完」。所以首屏走「**骨架(16ms) → 预渲染低清封面(100ms) → 高清(400ms)**」三段渐进，让「可见」永远发生在 100ms 内 —— 1GB 文件和 10KB 文件的首屏体感完全一致。

### 五条核心原则

| 原则 | 含义 |
|------|------|
| **能力路由优先** | 不预设「客户端解析 or 服务端转换」，由探测结果 + 设备能力动态决策。 |
| **渲染与解析分离** | 解析（Parse）在 Worker/WASM，渲染（Paint）在主线程，二者用 ViewModel 解耦。 |
| **一切皆视口驱动** | 只渲染可见区域（页/行/瓦片/帧），视口外即回收。 |
| **编辑是图层不是重写** | 预览底图只读，编辑落在叠加层（Overlay），导出时再合并，避免「为编辑重渲染」。 |
| **协同基于 CRDT 不基于格式** | 协同同步的是「编辑操作」而非「文件字节」，与具体格式解耦。 |

---

## 1. 场景矩阵（全格式覆盖）

| 类别 | 格式 | 大小 | 渲染策略 | 编辑能力 | 协同粒度 |
|------|------|------|----------|----------|----------|
| **版式文档** | PDF | 500MB | PDF.js + 文本层，虚拟分页 | 批注/高亮/盖章/表单填写 | 批注 CRDT |
| **流式文档** | DOCX、DOC | 500MB | OOXML→ViewModel→分页渲染；DOC 服务端转 | 富文本编辑 | 文本 CRDT |
| **演示文档** | PPTX、PPT | 500MB | OOXML→SVG/Canvas 单页；PPT 服务端转 | 文本框/形状编辑、批注 | 形状 CRDT |
| **电子表格** | XLSX、XLS | 500MB | SheetJS 解析 + Canvas 虚拟网格 | 单元格/公式编辑 | 单元格 CRDT |
| **纯文本** | TXT | 500MB | 流式分块 + 行虚拟化 | 全文编辑 | 文本 CRDT |
| **字幕** | SRT | 小 | 解析为时间轴轨道 | 时间轴 + 文本编辑 | 字幕条 CRDT |
| **位图** | jpg/jpeg/png/bmp | 500MB | OffscreenCanvas；超大图瓦片金字塔 | 框选/打码/标注/裁剪 | 标注 CRDT |
| **音频** | mp3/wav/m4a/aac/amr/wma/s48/pcm | 1G+ | MSE 流式 + Worker 波形；非标准编码 WASM 解码 | 区段标记/裁剪/字幕对齐 | 标记 CRDT |
| **视频** | mp4/m4v/mov/mkv/flv/avi/ts/wmv/mxf | 1G+ | 原生/MSE/WASM 转封装；服务端转 HLS | 打点/剪辑/字幕叠加/抽帧 | 标记 CRDT |
| **网页** | URL/HTML | — | 沙箱 iframe + 双语对照 | 译文批注 | 批注 CRDT |

> **格式归一**：56+ 扩展名最终收敛为 **8 类 ViewModel**（PagedDoc / FlowDoc / Slide / Sheet / Text / Subtitle / Raster / Media）。新增格式 = 写一个「Parser → ViewModel」适配器，渲染/编辑/协同全部复用。

---

## 2. 系统总体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Application Shell                             │
│   PreviewContainer · Toolbar · SidePanel · PresenceBar · PerfHUD       │
├──────────────────────────────────────────────────────────────────────┤
│                       Renderer Plugins（渲染插件）                       │
│  PdfRenderer · DocRenderer · SlideRenderer · SheetRenderer ·           │
│  TextRenderer · ImageRenderer · MediaRenderer · SubtitleRenderer       │
├──────────────────────────────────────────────────────────────────────┤
│   ViewModel（统一中间表示）  │   EditLayer（编辑图层）  │  CollabLayer    │
│  PagedDoc/Sheet/Media/...   │  OverlayModel + Ops      │  CRDT+Awareness │
├──────────────────────────────────────────────────────────────────────┤
│                       Rendering Pipeline（渲染管线）                     │
│  ViewportScheduler → Tile/PagePool → PaintQueue(rAF) → Compositor       │
├──────────────────────────────────────────────────────────────────────┤
│                          Core Kernel（内核）                            │
│  FormatProbe · CapabilityRouter · WorkerPool · WasmRegistry ·          │
│  TransportLayer(Range/Stream) · CacheManager · EventBus · Telemetry    │
└──────────────────────────────────────────────────────────────────────┘
         ↑解析在 Worker/WASM            ↑渲染在主线程 rAF
```

**数据流（一次打开）**：
```
fileRef → FormatProbe(前4KB魔数) → CapabilityRouter(决策)
        → Loader(Range 流式拉取) → Parser(Worker) → ViewModel(增量产出)
        → ViewportScheduler(算可见集) → PagePool(复用 DOM/Canvas) → Paint(rAF)
        ↘ 同时挂载 EditLayer（空）与 CollabLayer（订阅远端 Ops）
```

---

## 3. 格式探测与能力路由

### 3.1 FormatProbe（不信任扩展名）

读取文件**前 4KB** 做魔数 + 容器结构识别，解决「`.jpg` 实为 `.exe`」「`.docx` 实为 zip 加密」等问题：

```ts
interface ProbeResult {
  ext: string                 // 申报扩展名
  realType: string            // 真实类型（魔数判定）
  container: 'ooxml' | 'zip' | 'cfb' | 'raw' | 'mp4box' | 'matroska' | null
  category: ViewModelCategory // 归一类别
  trusted: boolean            // ext 与 realType 是否一致
  codecHints?: string[]       // 音视频：从 ftyp/EBML 头提取编码
}
```

| 容器 | 魔数 | 内含格式 |
|------|------|----------|
| OOXML | `50 4B 03 04`（zip）+ `[Content_Types].xml` | docx/xlsx/pptx |
| CFB（老 Office） | `D0 CF 11 E0` | doc/xls/ppt |
| MP4 Box | `....ftyp` | mp4/m4v/mov |
| Matroska | `1A 45 DF A3` | mkv |
| FLV | `46 4C 56` | flv |

> 音视频额外解析 `ftyp`/`moov`/EBML 头提取 codec（H.264/HEVC/AV1/AAC…），用于判定「能否原生播放」。

### 3.2 CapabilityRouter（三态决策）

每种格式按「设备能力 × 文件特征」决策渲染路径，**不写死**：

```
                 ┌─────────────────────────────────────────┐
  ProbeResult ──→│  浏览器原生支持？（<img>/<video> 直渲）   │──是──→ NativePath
                 └─────────────────────────────────────────┘
                                │否
                 ┌─────────────────────────────────────────┐
                 │  有 WASM 解码器 + 设备性能足够？           │──是──→ WasmPath
                 │  （ffmpeg.wasm / pdfium / 自研 parser）   │       （客户端解析/转封装）
                 └─────────────────────────────────────────┘
                                │否（老格式/弱机/超大）
                                └──────────────────────────────→ ServerPath
                                                                （服务端转 PDF/HLS/PNG）
```

| 格式 | NativePath | WasmPath | ServerPath（兜底） |
|------|-----------|----------|------------------|
| PDF | — | PDF.js（pdfium 可选） | 超大/加密失败时转图 |
| DOCX/XLSX/PPTX | — | 自研 OOXML Parser | 复杂排版还原度优先时服务端转 |
| DOC/XLS/PPT/WMF | — | — | LibreOffice headless 转 OOXML/PDF |
| mp4/m4v/mov（H.264/AAC） | `<video>` | — | — |
| mkv/flv/avi/ts/wmv/mxf | — | mux.js 转封装 / ffmpeg.wasm | 服务端转 HLS（fMP4） |
| amr/wma/s48/pcm | — | ffmpeg.wasm 解码 | 服务端转 mp3/aac |
| bmp | 多数浏览器原生 | WASM 解码兜底 | — |

**决策缓存**：同一 `(realType, codec, deviceTier)` 的决策结果缓存到 IndexedDB，二次打开跳过探测。

---

## 4. 统一预览内核 — Renderer Plugin 协议

所有格式渲染器实现同一接口，内核只认接口、不认格式 —— 这是「一个入口吃全部」的关键。

```ts
interface RendererPlugin<VM extends ViewModel = ViewModel> {
  readonly name: string
  /** 该插件能否处理探测结果 */
  match(probe: ProbeResult): number          // 0~1 优先级打分，最高者胜出

  /** 解析：流式产出 ViewModel（在 Worker 中跑） */
  parse(source: SourceHandle, ctx: ParseContext): AsyncIterable<Partial<VM>>

  /** 渲染单个「视口单元」（页/瓦片/行块/帧） */
  paintUnit(unit: ViewportUnit, surface: Surface): void | Promise<void>

  /** 命中测试：屏幕坐标 → 内容坐标（供选择/批注/编辑） */
  hitTest(point: Point, vm: VM): ContentAnchor | null

  /** 该格式支持的编辑能力 */
  capabilities(): EditCapability[]            // ['annotate','text','cell','trim',...]

  /** 将编辑 Overlay 合并回原格式导出（可选） */
  export?(vm: VM, overlay: OverlayModel, target: ExportFormat): Promise<Blob>

  dispose(): void
}
```

**ViewModel 统一中间表示**（解耦解析与渲染）：

```ts
type ViewModel =
  | PagedDocVM   // PDF/PPTX：固定页，每页有 textRuns + 图元 + 媒体盒
  | FlowDocVM    // DOCX/TXT：可重排块流（段落/表格/图片）
  | SheetVM      // XLSX：稀疏单元格矩阵 + 公式 AST + 合并区
  | RasterVM     // 图片：瓦片金字塔元信息
  | MediaVM      // 音视频：时长/轨道/关键帧索引/波形分块
  | SubtitleVM   // SRT：时间轴 cue 列表

interface PagedDocVM {
  category: 'paged'
  pageCount: number
  pageSize: (i: number) => Size        // 懒求，避免一次解析全文
  getPage: (i: number) => Promise<PageUnit>   // 按需解析第 i 页
}
```

> 关键点：`getPage(i)`/`getRows(range)` 是**惰性**的。打开 500 页 PDF 时只解析第 1 页，其余随滚动按需解析 —— 首屏与文件大小**解耦**。

---

## 5. 渲染管线与极致首屏

### 5.0 极致首屏：三段式渐进（这是「秒开」的灵魂）

「< 1s」之所以差，是因为它在等「完整高清渲染」。极致体验要让**「可见」与「保真」解耦**，分三段交付，每一段都比上一段更清晰，但用户在第一段（< 100ms）就已经「看到内容」了：

```
t=0       点击/拖入
│
├─ 16ms   ① 骨架 + 布局占位（页框/行高/封面尺寸已知，无内容也不跳动 → CLS=0）
│         来源：服务端预存的「文档指纹」(页数/页尺寸/封面色) ，几百字节
│
├─ 100ms  ② 预渲染低清「封面/首页」贴图（LQIP）——用户此刻已"看到文档了"
│         来源：服务端在「上传完成时」就异步预渲染好首页 WebP/AVIF 缩略（~10KB）
│         随首屏 HTML/接口一起下发，甚至内联 base64 → 0 额外 RTT
│
├─ 400ms  ③ 客户端高清重渲染，无感替换低清图（同位置淡入，无闪烁）
│         来源：Range 拉首页字节 → Worker 解析 → 高清位图
│
└─ 之后    滚动方向预测预取 + 空闲预渲染相邻页
```

**关键：① 和 ② 不依赖文件大小**。1GB 视频的「封面帧」和 1000 页 PDF 的「首页缩略」都是上传时就预生成好的小图，所以 **1GB 文件和 10KB 文件首屏体感完全相同**。这才是真正的「秒开」。

| 段 | 内容 | 体积 | 来源 | 是否阻塞 |
|----|------|------|------|----------|
| ① 骨架 | 文档指纹（页数/尺寸/主色） | < 1KB | 元数据接口（可与列表页一起预取） | 否，立即渲染 |
| ② 低清 | 首页/封面 LQIP | ~10KB WebP/AVIF | **上传时预渲染**，可内联 base64 | 否，与首屏并行 |
| ③ 高清 | 真实首页位图 | 按需 | Range + Worker 解析 | 后台，就绪后淡入 |

### 5.0.1 服务端预渲染（Prerender Service）

极致首屏的前提是「内容在被打开**之前**就已经准备好缩略」。复用 `upload-engine` 的上传完成钩子，异步生成：

| 格式 | 预渲染产物 | 用途 |
|------|-----------|------|
| PDF/DOCX/PPTX | 首页 + 前 3 页 LQIP（WebP），全文页缩略雪碧图 | 首屏即时贴图 + 侧栏导航 |
| XLSX | 首个 sheet 可视区快照 | 即时贴图 |
| 图片 | 多级缩略（LQIP/中图）+ 瓦片金字塔 | 渐进加载 |
| 视频 | 封面帧 + 关键帧雪碧图 + 转好的 HLS 首片 | 即时封面 + 起播 < 300ms |
| 音频 | 全量波形峰值数组（降采样，~KB） | 波形即时出，无需下整文件 |

> 这些产物随「预览元数据接口」一次返回（HTTP/2 push 或内联），**首屏 0 额外往返**。未预渲染完成的文件降级为客户端实时低清渲染。

### 5.0.2 预测式预取（让翻页/滚动也「零等待」）

```
信号源：滚动速度+方向、鼠标 hover 缩略图、列表页 hover 文件、用户历史浏览模式
        ↓
预取决策：连续下翻 → 预取后方 N 页高清；hover 第 8 页缩略 → 预取第 8 页
        ↓
空闲渲染：requestIdleCallback 把预取页提前解析+栅格化进 PagePool
        ↓
效果：翻到时已就绪，「可见」延迟 ≈ 0
```

- **hover-to-warm**：文件列表页鼠标悬停即触发预探测 + 拉首页 LQIP，点开瞬间出图。
- **方向预测**：用滚动速度积分预测落点页，优先渲染落点而非途经页。

### 5.1 ViewportScheduler（视口驱动调度）

```
滚动/缩放事件 ─(节流到 rAF)→ 计算可见单元集 V = [start, end]
                            预取窗口 P = [start-2, end+2]
   ┌─────────────────────────────────────────────────┐
   │ for u in V:  若未就绪 → 高优先级解析+渲染          │
   │ for u in P:  空闲时（requestIdleCallback）预渲染   │
   │ for u not in P: 回收 → 归还 PagePool / 释放纹理    │
   └─────────────────────────────────────────────────┘
```

- 可见单元用 **二分 + 累计高度数组** O(log n) 定位，百万行表格定位 < 1ms。
- 缩放用 **CSS transform 先变换、空闲时重栅格化**：缩放瞬间不重绘（GPU 合成），停手 150ms 后按目标 DPR 重渲染清晰位图。

### 5.2 PagePool / TilePool（对象池，恒定内存核心）

```
内存预算 256MB ÷ 单元平均纹理 ≈ N 个槽位
视口滚动时：离开视口的单元 Canvas/DOM 不销毁，进对象池 → 给新单元复用
            （避免反复 new Canvas 触发 GC 抖动）
纹理用 LRU + 双阈值水位：> 高水位触发回收到 < 低水位
```

| 单元类型 | 池化对象 | 回收策略 |
|----------|----------|----------|
| PDF/PPTX 页 | OffscreenCanvas 位图 | LRU，保留可见 ±3 页 |
| 表格行块（每 100 行一块） | Canvas 层 | LRU，保留可见 ±5 块 |
| 图片瓦片 | 256×256 纹理 | 按当前缩放层级 LRU |
| 视频帧（缩略轨） | ImageBitmap | 滑动窗口 |

### 5.3 Worker / WASM 分工

| 任务 | 位置 | 说明 |
|------|------|------|
| 文件解析（OOXML/PDF/SRT 解析） | Parse Worker 池 | 主线程零解析 |
| 音视频解码/转封装 | Codec Worker + ffmpeg.wasm/mux.js | SharedArrayBuffer 零拷贝回传 |
| 波形/缩略图/抽帧 | Media Worker | OffscreenCanvas 直接出图 |
| 大图解码与瓦片切分 | Image Worker | `createImageBitmap` + `resizeWidth` |
| 表格公式计算 | Calc Worker | 增量重算（依赖图脏标记） |
| 文本/版本 Diff | Diff Worker | Myers，避免阻塞输入 |

> Worker 池大小 = `navigator.hardwareConcurrency - 1`，任务带优先级队列（可见 > 预取 > 后台）。

### 5.4 渲染清晰度与性能平衡

- **两遍渲染**：滚动中用低分辨率（0.5×DPR）快出 → 停手后高清重绘，兼顾流畅与清晰。
- **PaintQueue**：所有绘制塞进 rAF 队列，每帧预算 8ms，超时让出，杜绝长任务掉帧。
- **文本层分离**：PDF/DOCX 的可选择文本用透明 `<span>` 浮在位图上（PDF.js 模式），既清晰又可选可批注。

---

## 6. 分格式渲染方案

### 6.1 PDF（PagedDoc）
- PDF.js 解析 → 每页 `PageUnit{ bitmap, textRuns, annotations }`。
- 位图 OffscreenCanvas 渲染，文本层透明 span 叠加（可选中、可批注定位）。
- 表单（AcroForm）映射为 HTML 输入控件，支持在线填写。
- 加密 PDF：客户端输入密码 → PDF.js 解密；失败降级 ServerPath 转图。

### 6.2 DOCX / DOC（FlowDoc，上限 500MB）
- DOCX = OOXML zip：用 Range 只取 zip 目录 + 首段 entry，**流式解析**为块流（段落/表格/图片/分页符），样式取自 `styles.xml`，500MB 文档不全量解压进内存。
- 内嵌大图按需懒加载（先占位框，进视口再取该 entry）。
- 可重排布局：按容器宽度重新分页（reflow），不依赖固定页大小。
- DOC（CFB 二进制）→ ServerPath（LibreOffice）转 DOCX 后走同一路径。
- 编辑态：块流直接驳接富文本编辑（见 §7.2）。

### 6.3 PPTX / PPT（Slide）
- PPTX = OOXML：每张 `slideN.xml` 解析为形状树（文本框/图形/图片/SmartArt）。
- 渲染：形状树 → SVG（矢量清晰、可点选）；位图元素走 Canvas。
- 缩略图导航条用低分辨率快照，单页全分辨率按需渲染。
- PPT → ServerPath 转 PPTX。

### 6.4 XLSX / XLS（Sheet）
- SheetJS 解析为**稀疏矩阵**（只存非空单元格）+ 公式 AST + 合并单元格 + 样式索引。
- **Canvas 虚拟网格**：只画可见行列（双向虚拟化），冻结行列固定层，百万行流畅。
- 公式：构建依赖图，编辑时增量重算（Calc Worker），支持常用函数子集。
- 图表：sheet 内嵌图表解析为 Canvas/SVG。

### 6.5 TXT（Text）
- `File.stream()` 流式分块读取，**不全量入内存**；行索引边读边建。
- 行虚拟化 + 等宽/折行两种模式；大文件（GB 级日志）秒开。
- 编码探测（BOM / chardet 采样）→ 正确解码 GBK/UTF-8/UTF-16。

### 6.6 SRT 字幕（Subtitle）
- 解析为 cue 列表 `{ index, start, end, text }`。
- 双视图：**时间轴轨道**（与音视频对齐）+ **列表编辑**。
- 与 §6.8 媒体播放器联动：播放头高亮当前 cue，点 cue 跳转。

### 6.7 图片（Raster，上限 500MB）
- 常规图：`createImageBitmap` → OffscreenCanvas，EXIF 方向矫正。
- **超大图（>4096px / 扫描件 / 500MB 级）必走瓦片金字塔**：上传时预生成 Deep Zoom 金字塔（DZI 风格多层瓦片）+ LQIP，客户端按缩放层级只加载可见 256×256 瓦片，**整图永不全量解码进内存**（500MB 原图解码后可达数 GB，禁止直载）。类 OpenSeadragon，亿级像素秒开。
- 内存护栏：单图解码像素超阈值（如 64MP）强制走金字塔路径，绝不 `createImageBitmap` 整图。
- bmp 等：原生失败 → WASM 解码兜底（仍走金字塔切分）。

### 6.8 音频 / 视频（Media，1G+ 核心）
- **传输**：HTTP Range 流式拉取，边下边播，不等整文件。
- **原生可播**（mp4/m4v/mov H.264 + AAC，mp3/wav/aac）→ `<video>`/`<audio>` 直接播。
- **不可原生播**：
  - 容器问题（mkv/flv/avi/ts/mxf/wmv）→ Codec Worker 用 mux.js/ffmpeg.wasm **转封装为 fMP4** → MSE `SourceBuffer` 喂入（无需重编码，CPU 低）。
  - 编码问题（老编码/amr/wma/s48/pcm）→ ffmpeg.wasm 解码或 ServerPath 转 HLS。
- **波形**：Media Worker 读 PCM 分块降采样为峰值数组，OffscreenCanvas 画波形，1GB 音频波形 < 1s 出图（分块渐进）。
- **缩略轨**：视频按关键帧 `seek + drawImage` 抽帧成缩略条，悬停预览。

---

## 7. 编辑层（EditLayer）

### 7.1 核心理念：编辑是叠加图层，不是重渲染

```
┌─────────────────────────────┐
│   EditLayer（可交互、可协同） │ ← 批注/文本/单元格/字幕/标记 等 Op
├─────────────────────────────┤
│   BaseLayer（只读底图）       │ ← 渲染器产出的位图/SVG/网格
└─────────────────────────────┘
        ↓ 导出时 RendererPlugin.export() 合并两层
```

所有编辑动作统一为 **EditOp**，与协同层共享同一套操作语义：

```ts
type EditOp =
  | { kind: 'annot.add';  anchor: ContentAnchor; shape: AnnotShape }   // PDF/图片批注
  | { kind: 'text.splice'; blockId: string; at: number; del: number; ins: string } // 文本/DOCX
  | { kind: 'cell.set';   sheet: string; r: number; c: number; value: CellValue }   // 表格
  | { kind: 'cue.edit';   id: string; start?: number; end?: number; text?: string } // 字幕
  | { kind: 'mark.add';   t: number; label: string }                  // 音视频打点
  | { kind: 'clip.trim';  inT: number; outT: number }                 // 音视频剪辑
  | { kind: 'image.mask'; rect: Rect; mode: 'blur' | 'box' }          // 图片打码
```

> `ContentAnchor` 是**与渲染分辨率无关**的内容坐标（如 PDF：`{page, x%, y%}`），保证缩放/不同设备下批注位置一致，也保证协同时坐标可交换。

### 7.2 各格式编辑能力

| ViewModel | 编辑能力 | 实现 |
|-----------|----------|------|
| PagedDoc(PDF) | 高亮/下划线/便签/手绘/盖章/表单填写 | 批注存 Overlay，导出时写回 PDF AcroForm/Annot |
| FlowDoc(DOCX/TXT) | 富文本编辑（加粗/列表/标题/表格） | 块流模型 + contenteditable 受控，输出 EditOp |
| Slide(PPTX) | 文本框/形状文字编辑、位置调整、批注 | 形状树节点编辑 |
| Sheet(XLSX) | 单元格值/公式编辑、行列增删、格式 | 稀疏矩阵 patch + 增量重算 |
| Subtitle(SRT) | 拖拽时间轴改时间、文本编辑、增删 cue | 时间轴 drag + cue 编辑 |
| Media | 区段标记、裁剪入/出点、字幕对齐、抽帧导出 | 标记/剪辑 Op，非破坏性，导出时 ffmpeg.wasm 剪 |
| Raster | 框选/打码/箭头/文字标注、裁剪 | Canvas Overlay 矢量图元 |

> **非破坏性编辑**：原文件字节永不修改，编辑只产生 Overlay + Op 序列；导出/保存时才合并，天然支持撤销/重做（Op 取反）与版本回溯。

---

## 8. 协同层（CollabLayer）

### 8.1 为什么用 CRDT 而非 OT

预览引擎要协同的内容是**异构的**（批注、单元格、字幕、标记…），且要求**离线可编辑**（弱网/移动端断流频繁）。CRDT 满足：

| 需求 | CRDT 优势 |
|------|-----------|
| 离线编辑 | 本地先改，联网自动合并，无需中心服务器仲裁 |
| 多格式统一 | 用 Map/Array/Text 三种 CRDT 类型即可表达所有 EditOp |
| 弱网 | 操作可乱序到达、可重复，最终一致 |
| 无单点 | 服务端只做中继/持久化，不做冲突仲裁 |

> 选型：Yjs 风格的 CRDT（YDoc）。各格式编辑模型映射到 Y 类型：
> - 文本/DOCX → `Y.Text`（保留意图，字符级合并）
> - 表格 → `Y.Map<cellKey, Y.Map>`（单元格级，互不干扰）
> - 批注/标记/字幕 → `Y.Array<Y.Map>`（增删稳定，带 clientID）

### 8.2 同步架构

```
Client A ──┐                          ┌── Client B
  YDoc     │   ┌──────────────────┐   │   YDoc
  (本地权威)│──→│  Sync Server     │←──│  (本地权威)
           │   │  (中继+持久化)    │   │
  IndexedDB│   │  WebSocket/WebRTC │   │ IndexedDB
  (离线)   ┘   │  广播 update      │   └ (离线)
              └──────────────────┘
       update = 二进制增量（仅变更，KB 级），非全量文档
```

- **本地优先**：编辑先落本地 YDoc + IndexedDB（断网无感），联网后增量同步。
- **传输**：WebSocket 中继；同房间小规模可选 WebRTC P2P 降延迟。
- **持久化**：服务端存 update log + 定期快照（snapshot）压缩历史。

### 8.3 Awareness（在场感知，非持久化）

光标、选区、当前页、播放头位置等**临时状态**走独立的 awareness 通道（不进 CRDT 文档，随断连自动清理）：

```ts
interface PresenceState {
  user: { id: string; name: string; color: string; avatar?: string }
  cursor?: ContentAnchor       // 文档/表格光标
  selection?: AnchorRange
  viewport?: { page?: number; scrollPct?: number }  // "跟随 TA" 功能
  playhead?: number            // 音视频协同观影：同步播放头
}
```

- 实时渲染他人光标/选区/头像（彩色，带姓名气泡）。
- **跟随模式**：点头像跟随 TA 的视口滚动（评审场景）。
- **协同观影**：音视频播放头同步，一人暂停全员暂停（可选）。

### 8.4 冲突与一致性保障

| 冲突场景 | 处理 |
|----------|------|
| 两人改同一单元格 | CRDT LWW（last-writer-wins，按 Lamport 时钟 + clientID 定序） |
| 两人编辑同一段文字 | `Y.Text` 字符级合并，意图保留 |
| 删除被批注的内容 | 批注 anchor 失锚 → 标记「孤儿批注」侧栏提示 |
| 离线大量编辑后上线 | 增量批量合并，进度可见，失败可重试 |

---

## 9. 传输层（TransportLayer）

| 机制 | 说明 |
|------|------|
| **HTTP Range** | 音视频/大 PDF 按需取片段（`Range: bytes=`），首屏只拉前若干页/秒。 |
| **渐进解析** | zip/OOXML 用 Range 只取目录区 + 首页 entry，不下整包。 |
| **预取** | 视口前方 N 单元空闲预取；翻页方向预测（连续下翻则预取后页）。 |
| **优先级** | 可见 > 预取 > 缩略图 > 后台，HTTP/2 多路复用按优先级发。 |
| **断点续传** | Range 偏移记 IndexedDB，断网恢复从断点续。 |
| **CDN/边缘** | 转换产物（HLS 分片、转码图）走 CDN，边缘缓存。 |

---

## 10. 缓存与存储（CacheManager）

```
L1 内存 LRU（解码后 ViewModel/位图/波形）   命中即毫秒级重绘
   ↓ miss
L2 IndexedDB（原始片段 + 解析中间产物 + 决策缓存）  二次打开免重解析
   ↓ miss
L3 Service Worker（转换产物/静态资源缓存）        离线可打开看过的文件
   ↓ miss
L4 源站 / 服务端转换
```

- **内容寻址**：缓存 key = `hash(fileId + range + renderParams)`，相同内容跨会话复用。
- **配额管理**：`navigator.storage.estimate()` 监控，超阈值 LRU 淘汰 L2。
- **预热**：列表页悬停即预探测 + 预取首页（hover-to-preview）。

---

## 11. 性能预算与指标

> 指标分「感知性能」（用户看到什么时候）与「完整性能」（高清就绪），前者才是体验的关键。**所有「任意格式/大小」指标对 10KB 和 1GB 文件一视同仁** —— 这是预渲染 + 三段渐进带来的。

| 指标 | 目标 | 保障手段 |
|------|------|----------|
| 骨架/布局占位（任意格式/大小） | **< 16ms** | 文档指纹元数据，1 帧内出页框，CLS=0 |
| 首个内容像素 / 低清可见（任意大小） | **< 100ms** | 上传时预渲染 LQIP + 内联下发，0 额外 RTT |
| 高清首屏（首页/封面） | **< 400ms** | Range 拉首页 + Worker 解析 + 淡入替换 |
| 1000 页 PDF 打开体感 | = 单页（**< 400ms**） | 只解析首页，预渲染缩略 + 余页预测预取 |
| 1GB 视频起播 | **< 300ms** | 预生成 HLS 首片 + 封面帧即时 + MSE 边下边播 |
| 翻页 / 跳页延迟 | **≈ 0** | 预测预取 + 空闲预渲染 PagePool 已就绪 |
| 百万行表格滚动 | 稳定 **60 FPS** | 双向虚拟化 + 累计高度二分 + 行块对象池 |
| 亿像素图缩放/平移 | 稳定 **60 FPS** | 瓦片金字塔 + GPU transform 先变换后栅格化 |
| 输入延迟（编辑/批注） | INP **< 100ms** | 编辑落 Overlay 不重渲底图 + Op 异步协同 |
| 常驻内存 | **< 256MB** | PagePool/TilePool 对象池 + LRU 双水位 |
| 主线程长任务 | **0**（> 50ms） | 解析全在 Worker，Paint 切片到 rAF（8ms 预算） |
| 协同同步感知 | **< 100ms** | 二进制增量 update（KB 级）+ WebSocket |
| 离线可编辑 | 100% | 本地 YDoc + IndexedDB |

---

## 12. 安全与降级

| 风险 | 对策 |
|------|------|
| 伪造类型文件 | FormatProbe 魔数校验，拒绝不可信类型 |
| 恶意宏/脚本（Office） | 解析时丢弃 VBA/外部引用；网页预览用 sandbox iframe（无 `allow-scripts` 默认） |
| 大文件打爆内存 | 流式 + 对象池 + 内存水位熔断（超限降级缩略模式） |
| WASM 不支持/弱机 | 能力路由自动降级 ServerPath |
| 解析失败 | 三级降级：客户端解析 → 服务端转 PDF → 转图兜底，永不白屏 |
| 字体缺失 | 内嵌字体子集 + Web Font 兜底，DOCX/PDF 还原度 |
| XSS（批注/文本） | 编辑内容渲染前消毒（DOMPurify 同源策略） |

---

## 13. 文件目录结构

```
preview-engine/
├── spec.md                          # 本文件
└── demo/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── kernel/
        │   ├── types.ts             # ViewModel / EditOp / ProbeResult 等全局类型
        │   ├── FormatProbe.ts       # 前4KB 魔数 + 容器探测
        │   ├── CapabilityRouter.ts  # Native/Wasm/Server 三态决策
        │   ├── RendererRegistry.ts  # 插件注册 + match 打分路由
        │   ├── WorkerPool.ts        # 优先级任务队列 Worker 池
        │   ├── WasmRegistry.ts      # ffmpeg/pdfium/解码器懒加载
        │   ├── TransportLayer.ts    # Range/流式/预取/断点续传
        │   ├── CacheManager.ts      # L1~L3 多级缓存
        │   ├── EventBus.ts
        │   └── Telemetry.ts         # 性能采集
        ├── pipeline/
        │   ├── ViewportScheduler.ts # 可见集计算 + 预取 + 回收
        │   ├── PagePool.ts          # 对象池（恒定内存）
        │   ├── TilePool.ts          # 瓦片池（大图）
        │   └── PaintQueue.ts        # rAF 绘制队列（8ms 预算）
        ├── viewmodels/
        │   ├── PagedDocVM.ts
        │   ├── FlowDocVM.ts
        │   ├── SheetVM.ts
        │   ├── RasterVM.ts
        │   ├── MediaVM.ts
        │   └── SubtitleVM.ts
        ├── renderers/
        │   ├── PdfRenderer.ts
        │   ├── DocRenderer.ts
        │   ├── SlideRenderer.ts
        │   ├── SheetRenderer.ts
        │   ├── TextRenderer.ts
        │   ├── ImageRenderer.ts
        │   ├── MediaRenderer.ts
        │   └── SubtitleRenderer.ts
        ├── edit/
        │   ├── OverlayModel.ts       # 编辑叠加层模型
        │   ├── EditOp.ts             # 统一编辑操作 + 取反（undo）
        │   └── exporters/            # 各格式导出合并
        ├── collab/
        │   ├── CollabDoc.ts          # CRDT(YDoc) 封装 + EditOp 映射
        │   ├── SyncProvider.ts       # WebSocket/WebRTC 同步
        │   ├── Awareness.ts          # 光标/选区/播放头在场感知
        │   └── OfflineStore.ts       # IndexedDB 离线持久化
        ├── workers/
        │   ├── parse.worker.ts       # OOXML/PDF/SRT 解析
        │   ├── codec.worker.ts       # ffmpeg.wasm 转封装/解码
        │   ├── media.worker.ts       # 波形/抽帧/缩略
        │   └── calc.worker.ts        # 表格公式增量重算
        ├── components/
        │   ├── PreviewContainer.tsx  # 统一容器（路由到对应 renderer）
        │   ├── Toolbar.tsx
        │   ├── SidePanel.tsx         # 缩略图/大纲/批注列表/字幕轨
        │   ├── PresenceBar.tsx       # 协同头像 + 跟随
        │   └── PerfHUD.tsx           # FPS/内存/解析耗时
        ├── main.tsx
        └── __tests__/
            ├── FormatProbe.test.ts   # 魔数识别 / 伪造拦截
            ├── CapabilityRouter.test.ts
            ├── ViewportScheduler.test.ts  # 可见集/回收正确性
            ├── PagePool.test.ts      # 内存上限不突破
            ├── SheetVM.test.ts       # 稀疏矩阵/公式重算
            ├── CollabDoc.test.ts     # CRDT 收敛 / 离线合并
            └── EditOp.test.ts        # Op 取反幂等（undo/redo）
```

---

## 14. Demo 演示与验收

### 14.1 验收标准

| 场景 | 验收指标 |
|------|----------|
| 全格式打开 | 56+ 扩展名拖入即开，无白屏；低清可见 < 100ms |
| 大文件 | 1GB 视频 < 300ms 起播；500M/1000 页 PDF 首屏体感 = 单页（< 400ms） |
| 性能 | 滚动稳定 60FPS，常驻 < 256MB，长任务 0，INP < 100ms（PerfHUD 实时可见） |
| 编辑 | PDF 批注 / 表格改值 / 字幕改时间 / 视频打点，预览态无缝切换 |
| 协同 | 双窗口实时同步光标 + 编辑；断网编辑→联网自动合并 |
| 降级 | 关闭 WASM 模拟弱机，自动走 ServerPath 不崩 |
| 安全 | `.exe` 改名 `.jpg` 被拦截 |

### 14.2 演示脚本（10 分钟）

```
0:00-1:30  架构讲解：FormatProbe → CapabilityRouter → ViewModel → 渲染管线
1:30-3:30  全格式秒开：拖入 PDF/DOCX/XLSX/PPTX/大图/1GB 视频，PerfHUD 看首屏+内存
3:30-5:30  性能压测：百万行表格丝滑滚动 / 亿像素图缩放 / 视频边下边播
5:30-7:30  编辑：PDF 高亮批注 → 表格改公式重算 → SRT 拖时间轴 → 视频打点裁剪
7:30-9:00  协同：双窗口光标实时跟随，同时编辑批注/单元格自动合并；断网演示离线编辑
9:00-10:00 Q&A：CRDT 收敛 / 对象池恒定内存 / 能力路由三态决策
```
