# 真实文件预览 — 实现规格（real-preview）

> 在 `spec.md` 内核之上，落地「真实文件 → 真实渲染」的端到端链路。
> 约束：**零新增运行时依赖**，全部基于浏览器原生能力，保证任意环境链路必然跑通。
> 输入来源：用户从本机（如「下载」目录）拖拽 / 选择真实文件。

---

## 1. 目标与范围

打通：`真实 File → SourceHandle(流式字节) → probeFile(魔数探测) → CapabilityRouter(路由) → RendererRegistry → 真实渲染器绘制可见内容`。

### 1.1 真实渲染覆盖（零依赖）

| 类别 | 格式 | 渲染方式（原生 API） | 真实程度 |
|------|------|---------------------|----------|
| 图片 | png/jpg/jpeg/bmp/gif/webp | `createImageBitmap` → Canvas，fit/缩放/拖拽 | 完全真实 |
| 音频 | mp3/wav/m4a/aac | `<audio>` 播放 + `AudioContext.decodeAudioData` 真实波形 | 完全真实 |
| 视频 | mp4/m4v/mov/webm | `<video>` 原生播放 + 时间轴 | 完全真实 |
| 文本 | txt/json/html/md/svg/csv/log | `Blob.text()` 解码（BOM/编码探测）+ 行虚拟化 | 完全真实 |
| 版式 | pdf | 浏览器内置 PDF 查看器（`blob:` + `<iframe>`） | 完全真实（原生渲染） |

### 1.2 降级（无新增 WASM 库时，遵循 spec 三态路由）

| 类别 | 格式 | 处理 |
|------|------|------|
| OOXML | docx/xlsx/pptx | 路由判定为 WASM/Server，UI 明确提示「需解析器/服务端转换」，展示探测+决策信息（链路仍走通，只是渲染器为占位） |
| 老格式 | doc/xls/ppt | 路由 Server，同上 |

> 这是诚实的工程降级：链路全程跑通，渲染层按能力可插拔。后续 `npm i pdfjs-dist mammoth xlsx` 即可把对应渲染器从「占位」升级为「客户端解析」。

---

## 2. 架构落点（复用内核）

```
File ──→ BlobSource(SourceHandle)
            │ readHead(4KB)
            ▼
       probeFile() ──→ ProbeResult ──→ route(device) ──→ RouteDecision
            │                                               │
            ▼                                               ▼
       RendererRegistry.resolve(probe) ───────────→ RealRenderer.mount(source, container)
                                                          ├─ ImageRenderer
                                                          ├─ MediaRenderer (+ Waveform)
                                                          ├─ TextRenderer (行虚拟化)
                                                          ├─ PdfRenderer (native iframe)
                                                          └─ FallbackRenderer (占位+决策信息)
```

- `FormatProbe` / `CapabilityRouter` / `RendererRegistry` / `CumulativeIndex` / `PagePool` / `ProgressiveLoader` 全部复用，不重写。
- 新增的是「真实数据源」与「真实渲染器适配层」。

---

## 3. 新增模块（TDD）

### 3.1 SourceHandle（`src/kernel/SourceHandle.ts`）
统一的惰性字节读取抽象，避免一次性读整文件。

```ts
interface SourceHandle {
  readonly size: number
  readonly name: string
  readHead(n: number): Promise<Uint8Array>     // 前 n 字节（探测用）
  slice(start: number, end: number): Promise<Uint8Array>
  blob(): Blob                                   // 给原生标签/createObjectURL
  text(): Promise<string>
}
class BlobSource implements SourceHandle { constructor(file: File | Blob, name?: string) }
```
**测试**：readHead 截断、slice 边界、size/name、空文件。

### 3.2 probeFile（`src/kernel/probeFile.ts`）
```ts
async function probeFile(source: SourceHandle): Promise<ProbeResult>
```
读 4KB → 调 `probe(head, extFromName)`。
**测试**：用构造的 Blob（含 PDF/PNG/zip-ooxml 魔数）验证识别与伪造拦截。

### 3.3 TextModel（`src/renderers/text/TextModel.ts`）
纯逻辑：解码 + 行偏移索引 + 按区间取行（配合 `CumulativeIndex` 行虚拟化）。
```ts
class TextModel {
  static decode(bytes: Uint8Array): string      // BOM 去除 + UTF-8
  constructor(text: string)
  lineCount: number
  getLines(start: number, end: number): string[]
}
```
**测试**：BOM 去除、CRLF/LF、空行、末行无换行、行区间。

### 3.4 waveformPeaks（`src/renderers/media/waveform.ts`）
纯逻辑：PCM Float32 → 分桶 min/max 峰值（真实波形数据）。
```ts
function computePeaks(samples: Float32Array, buckets: number): Array<[number, number]>
```
**测试**：桶数、min/max 正确、samples 少于桶数、空输入。

### 3.5 imageFit（`src/renderers/image/fit.ts`）
纯逻辑：fit-to-viewport 缩放与缩放钳制、居中偏移。
```ts
function fitScale(img: Size, viewport: Size): number
function clampScale(scale: number, min: number, max: number): number
```
**测试**：宽/高约束、放大/缩小钳制、等比。

### 3.6 真实渲染器适配层（集成，DOM）
`ImageRenderer / MediaRenderer / TextRenderer / PdfRenderer / FallbackRenderer`，实现 `RealRenderer { mount(source, el): dispose }`。在 `FilePreview` 组件中由 `RendererRegistry` 路由挂载。属集成层（e2e），不在单测内。

---

## 4. UI（FilePreview）

- 拖拽区 + 文件选择按钮（支持多选，左侧文件列表，右侧预览）。
- 顶部信息条：真实类型 / 类别 / 可信 / 渲染路径 + reason / 三段式首屏耗时。
- 预览区按路由挂载对应真实渲染器。

---

## 5. 验收

| 场景 | 验收 |
|------|------|
| 拖入 png/jpg | 真实显示图片，可缩放拖拽 |
| 拖入 mp3/wav | 可播放 + 显示真实波形 |
| 拖入 mp4 | 可播放 |
| 拖入 txt/json | 真实文本，万行流畅滚动 |
| 拖入 pdf | 浏览器原生渲染真实页面 |
| 拖入 docx/xlsx | 显示探测+路由信息 + 明确降级提示（链路通） |
| 伪造 exe→jpg | 拦截提示 |
| 全部 | 单元测试全绿；`vite build` 通过 |
