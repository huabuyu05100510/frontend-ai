# PDF 编辑引擎 — 技术规格（顶级行业方案）

> 对标：Adobe Acrobat Web / Foxit Web / PDFTron(Apryse) WebViewer / 福昕 / 腾讯文档 PDF。
> 定位：**不是只读查看器**，而是「渲染 + 非破坏性编辑 + 协同 + 导出烧回」的完整 PDF 编辑引擎。

---

## 0. 边界与立场（诚实的工程取舍）

| 层 | 方案 | 为什么 |
|----|------|--------|
| **渲染内核** | PDF.js（运行时 CDN 动态加载） | 业界共识：前端不重写 PDF 解析器。Acrobat Web/Foxit 均用渲染内核；唯一自研 WASM 核的 PDFTron 是数百人年工程。 |
| **文本层** | PDF.js TextLayer | 真实可选中文本，支撑高亮锚定 |
| **编辑层** | **自研** Overlay 引擎 | 引擎的核心价值，与渲染解耦 |
| **协同层** | **自研** CRDT（复用 CollabDoc） | 多人实时 + 离线 |
| **导出层** | **自研** 注解 → pdf-lib 绘制描述符 | 把批注烧回真实 PDF 字节，产出可下载的新文件 |

> CDN 动态加载（`import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4/+esm')`）解决「npm 离线装不上」且符合生产可替换（接入私有 npm 后改为本地依赖即可）。

---

## 1. 架构

```
┌──────────────────────────────────────────────────────────┐
│                       PdfEditor (UI)                       │
│  Toolbar(select/highlight/ink/text/rect) · PageList · Export│
├──────────────────────────────────────────────────────────┤
│   RenderCore(PDF.js)     │   EditLayer(自研)   │ CollabLayer │
│  page.render→canvas      │  AnnotationStore     │ CollabDoc   │
│  getTextContent→textLayer│  Anchor(坐标无关)    │ (CRDT)      │
├──────────────────────────────────────────────────────────┤
│  ViewportScheduler + PagePool（虚拟分页 + 恒定内存，复用内核） │
├──────────────────────────────────────────────────────────┤
│           ExportEngine：Annotation → pdf-lib → Blob          │
└──────────────────────────────────────────────────────────┘
```

---

## 2. 非破坏性编辑模型

**原 PDF 字节只读**；编辑只产生注解，渲染时叠加，导出时合并。

### 2.1 坐标无关锚点（核心）

注解锚点存 **PDF 页坐标系的归一化比例**（page index + 0~1 的 x/y/w/h），与缩放/DPR/设备无关：

```ts
interface PdfRect {       // 归一化，0~1，原点左上（已统一）
  page: number
  x: number; y: number; w: number; h: number
}
interface Viewport {      // 某页当前渲染视口（px）
  width: number; height: number; scale: number; rotation: 0|90|180|270
}
// 互转（含旋转）：
toScreen(rect: PdfRect, vp: Viewport): ScreenRect
toPdf(screen: ScreenRect, vp: Viewport): PdfRect
```

> 任意缩放后批注位置严格不漂移；协同时不同用户不同屏幕也对齐。

### 2.2 注解类型

```ts
type Annotation =
  | { type:'highlight'; rect:PdfRect; color:string }      // 文本高亮
  | { type:'ink';       page:number; points:Pt[]; color:string; width:number } // 手绘
  | { type:'rect';      rect:PdfRect; color:string }      // 矩形框
  | { type:'note';      rect:PdfRect; text:string }       // 文字便签
  | { type:'redact';    rect:PdfRect }                    // 涂黑遮盖
```

每个注解有 `id`、`author`、`createdAt`，进 `CollabDoc`（CRDT）→ 多人编辑自动合并、可撤销（EditOp 取反）。

---

## 3. 渲染（虚拟分页，复用内核）

- `pdf.getDocument` → `numPages`，每页 `getViewport({scale})` 得尺寸 → 灌入 `CumulativeIndex`。
- `ViewportScheduler` 算可见页；`PagePool<canvas>` 复用画布；离屏页 `page.cleanup()` 释放。
- 每页：`page.render(canvasCtx)` 画底图 + `getTextContent()` 建透明文本层（可选中）+ 注解 Overlay（SVG）。
- 三段式：低清 scale=0.5 先出 → 高清 scale=devicePixelRatio 替换。

---

## 4. 导出（烧回 PDF）

```ts
// 纯函数：注解 → 与渲染库无关的绘制描述符（可单测）
buildDrawOps(annotations: Annotation[], pageSizes: Size[]): PageDrawOp[]
// 适配器：描述符 → pdf-lib 真实绘制 → 新 PDF Blob
exportPdf(srcBytes: ArrayBuffer, annotations): Promise<Blob>
```

- highlight → 半透明矩形；ink → 折线；rect → 描边；note → 文本 + 图标；redact → 实心黑块 + 删除其下文本对象。
- 产出**可下载的新 PDF**，用 Acrobat 打开批注真实存在 → 证明「真编辑」。

---

## 5. 协同

- 注解全部存 `CollabDoc<Annotation>`（已 TDD：LWW、幂等、离线合并）。
- Awareness：他人光标/当前页/选区实时显示。
- 撤销/重做：每次编辑产生 `EditOp`（annot.add/remove，已 TDD 取反）。

---

## 6. TDD 范围（纯逻辑先行）

| 模块 | 测试点 |
|------|--------|
| `pdf/anchor.ts` | toScreen/toPdf 往返一致；含 90/180/270 旋转；缩放无关 |
| `pdf/AnnotationModel.ts` | 创建/序列化；点命中测试；ink 包围盒 |
| `pdf/exportOps.ts` | buildDrawOps：各类型映射、坐标换算、空集 |
| 协同 | 复用 CollabDoc（注解增删合并收敛） |

渲染（PDF.js）、导出落地（pdf-lib）为集成层。

---

## 7. 验收

| 场景 | 验收 |
|------|------|
| 打开真实 PDF | 自渲染逐页（非 iframe），可滚动缩放 |
| 高亮/手绘/框/便签 | 工具栏切换，鼠标绘制，缩放后不漂移 |
| 协同 | 双窗口注解实时同步；离线编辑重连合并 |
| 撤销/重做 | Ctrl+Z/Y 生效 |
| 导出 | 下载新 PDF，外部阅读器可见批注 |
| 升级 | CDN→本地依赖一行切换 |
