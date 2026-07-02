# 多模态 AI 渲染引擎 — 技术设计方案

> 版本：1.0  日期：2026-06-12
> 覆盖场景：翻译双栏对比 / 智检标注 / OCR 通用识别 / OCR 自定义模板

---

## 一、系统总览

### 1.1 核心命题

将 AI 模型输出的坐标+语义信息（翻译段落、错误位置、识别区域）精准叠加到原始内容上，同时保持文本可复制、交互可联动。

### 1.2 四个场景

| 场景 | 输入 | 核心交互 | 输出 |
|------|------|---------|------|
| 翻译双栏 | PDF/DOCX | 段落同步滚动、双侧高亮、可复制 | 左原文 + 右译文 |
| 智检标注 | 纯文本 / 文档 | 波浪线高亮、错误面板联动、接受/忽略 | 原文 + 错误标注层 |
| OCR 通用 | 图片 | 识别框双向联动、全文复制 | 图片 + 文字结果面板 |
| OCR 自定义 | 图片 + 模板 | 画框、配置字段、模板管理 | 字段模板 + 识别结果 |

### 1.3 设计原则

- **渲染与标注解耦**：内容渲染层不感知标注逻辑
- **坐标差异收敛**：三种坐标系统一收敛到 CoordAdapter 一层
- **共用底层，场景独立**：SVGLayer / EventBus / StateMachine 全场景共用
- **渐进可扩展**：插件式结构，后续可接入协作、无障碍、导出

---

## 二、架构设计

### 2.1 层次架构

```
┌─────────────────────────────────────────────────────────┐
│                      Scene Layer                        │
│   翻译双栏  │  智检文本  │  智检文档  │  OCR通用  │ OCR自定义 │
└──────┬──────┴─────┬──────┴─────┬──────┴─────┬─────┴────┬──┘
       │            │            │            │          │
┌──────▼────────────▼────────────▼────────────▼──────────▼──┐
│                     Annotation Kernel                      │
│   AnnotationStore · StateMachine · EventBus · Plugin API  │
└──────────────────────────┬─────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ImageCoordAdapter  DocumentCoordAdapter  TextCoordAdapter
   (固定像素坐标)      (页面+滚动坐标)       (字符偏移量)
          │                │                │
          ▼                ▼                ▼
   Canvas+SVGLayer    Canvas+TextLayer   ProseMirror
   R-Tree HitTest     +SVGLayer          Decoration
```

### 2.2 目录结构

```
src/
├── core/
│   ├── AnnotationKernel.ts      # 核心引擎
│   ├── AnnotationStore.ts       # 标注状态管理
│   ├── StateMachine.ts          # 交互状态机
│   ├── EventBus.ts              # 事件总线
│   └── types.ts                 # 公共类型定义
│
├── adapters/
│   ├── CoordAdapter.ts          # 适配器基类接口
│   ├── ImageCoordAdapter.ts     # 图片场景
│   ├── DocumentCoordAdapter.ts  # 文档场景
│   └── TextCoordAdapter.ts      # 文本场景
│
├── renderers/
│   ├── DocumentRenderer.ts      # pdfium-wasm + Canvas
│   ├── ImageRenderer.ts         # 图片渲染
│   ├── TextLayer.ts             # 透明可复制文字层
│   └── TextRenderer.ts          # ProseMirror 实例
│
├── layers/
│   ├── SVGLayer.ts              # SVG 标注层工厂（波浪线/矩形框）
│   ├── AnnotationLayer.ts       # 标注层挂载管理
│   └── InteractionLayer.ts      # 透明事件接管层
│
├── utils/
│   ├── rtree.ts                 # R-Tree 空间索引
│   ├── coord.ts                 # 坐标变换工具函数
│   ├── svg.ts                   # SVG 元素工厂
│   └── measure.ts               # 文本宽度测量
│
└── scenes/
    ├── translation/
    │   ├── DualColumnLayout.ts  # 双栏容器
    │   ├── ScrollSyncBridge.ts  # 滚动同步
    │   └── ParagraphMapper.ts   # 段落对齐映射
    │
    ├── inspection/
    │   ├── InspectionText.ts    # 文本智检入口
    │   ├── InspectionDocument.ts# 文档智检入口
    │   ├── DecorationPlugin.ts  # ProseMirror decoration 插件
    │   └── ErrorPanel.ts        # 右侧错误面板
    │
    ├── ocr-general/
    │   ├── OCRGeneralView.ts    # 图文对照主视图
    │   └── TextResultPanel.ts   # 文字结果面板
    │
    └── ocr-custom/
        ├── TemplateEditor.ts    # 模板编辑器主视图
        ├── DrawTool.ts          # 矩形画框工具
        ├── ResizeTool.ts        # 控制点缩放工具
        ├── ConfigPanel.ts       # 字段配置面板
        └── TemplateManager.ts   # 模板 CRUD
```

---

## 三、数据模型

### 3.1 基础类型

```typescript
type Rect  = { x: number; y: number; w: number; h: number }
type Point = { x: number; y: number }
type Size  = { width: number; height: number }
```

### 3.2 标注位置（三种坐标系）

```typescript
// 图片场景：固定像素坐标
type PixelPosition = {
  kind: 'pixel'
  bbox: Rect
}

// 文档场景：页码 + 页内坐标
type PagePosition = {
  kind: 'page'
  page: number   // 0-indexed
  bbox: Rect     // 相对页面左上角，单位 pt
}

// 文本场景：字符偏移量
type OffsetPosition = {
  kind: 'offset'
  from: number
  to: number
}

type Position = PixelPosition | PagePosition | OffsetPosition
```

### 3.3 标注类型

```typescript
type AnnotationType =
  | 'translation-paragraph'  // 翻译段落映射
  | 'error-spelling'         // 拼写错误
  | 'error-grammar'          // 语法错误
  | 'error-punctuation'      // 标点错误
  | 'error-number'           // 数字错误
  | 'error-political'        // 涉政词
  | 'ocr-region'             // OCR 识别区域
  | 'ocr-field'              // OCR 自定义字段

interface Annotation {
  id:       string
  type:     AnnotationType
  position: Position
  content: {
    original:     string
    suggestion?:  string       // 纠错建议词
    translation?: string       // 译文
    confidence?:  number       // 置信度 0~1
    fieldConfig?: FieldConfig  // OCR 自定义字段配置
  }
  status: 'active' | 'accepted' | 'ignored'
  meta?:  Record<string, unknown>
}
```

### 3.4 OCR 字段配置

```typescript
interface FieldConfig {
  id:          string
  label:       string
  dataType:    'text' | 'number' | 'date' | 'checkbox' | 'select'
  required:    boolean
  regex?:      string
  description?: string
  order:       number   // 识别结果排序
}

interface OCRTemplate {
  id:              string
  name:            string
  description?:    string
  sampleImageUrl?: string
  fields:          FieldConfig[]
  createdAt:       number
  updatedAt:       number
}
```

### 3.5 文档段落映射

```typescript
interface Paragraph {
  id:    string
  page:  number
  bbox:  Rect
  text:  string
  index: number   // 文档内顺序
}

interface ParagraphMapping {
  sourceId:   string   // 原文段落 id
  targetId:   string   // 译文段落 id
  confidence: number
}
```

### 3.6 交互状态

```typescript
type InteractionState =
  | { type: 'idle' }
  | { type: 'hover';         annotationId: string }
  | { type: 'selected';      annotationId: string }
  | { type: 'multiSelected'; annotationIds: string[] }
  | { type: 'drawing';       startPt: Point; currentPt: Point }
```

---

## 四、核心模块接口

### 4.1 CoordAdapter

```typescript
interface CoordAdapter {
  // 标注位置 → 屏幕 DOMRect（跨行返回多个）
  toScreenRects(pos: Position): DOMRect[]

  // 屏幕点 → 命中的 annotation id（单点 hover 用）
  hitTest(pt: Point): string | null

  // 矩形范围查询 → 命中的 annotation ids（框选用）
  rangeSearch(rect: Rect): string[]

  // 布局变化时通知失效（字体变化 / 窗口 resize / 滚动）
  invalidate(): void

  destroy(): void
}
```

### 4.2 SVGLayer

```typescript
interface SVGLayerAPI {
  // 在 rects 底部添加波浪线（跨行多段）
  addWavyUnderline(id: string, rects: DOMRect[], color: string): void

  // 添加矩形标注框
  addAnnotationBox(id: string, rect: DOMRect, style: BoxStyle): void

  // 在框内叠加文字标签
  addTextLabel(id: string, rect: DOMRect, text: string): void

  // 控制高亮状态
  setHighlight(id: string, on: boolean, mode?: 'hover' | 'selected'): void

  remove(id: string): void
  clear(): void
}

interface BoxStyle {
  strokeColor:  string
  fillColor:    string   // rgba，半透明
  strokeWidth:  number
  labelColor?:  string
}
```

### 4.3 EventBus

```typescript
type KernelEvent =
  | { type: 'ANNOTATION_HOVER';         id: string | null }
  | { type: 'ANNOTATION_SELECT';        id: string }
  | { type: 'ANNOTATION_MULTI_SELECT';  ids: string[] }
  | { type: 'ANNOTATION_ACCEPT';        id: string }
  | { type: 'ANNOTATION_IGNORE';        id: string }
  | { type: 'ANNOTATIONS_LOADED';       annotations: Annotation[] }
  | { type: 'SCROLL_TO';               annotationId: string }
  | { type: 'DRAW_START';              pt: Point }
  | { type: 'DRAW_UPDATE';             pt: Point }
  | { type: 'DRAW_END';                rect: Rect }
  | { type: 'FIELD_CONFIG_OPEN';       fieldId: string; rect: Rect }
  | { type: 'FIELD_SAVED';             config: FieldConfig }
  | { type: 'FIELD_DELETED';           fieldId: string }

interface EventBus {
  emit<T extends KernelEvent>(event: T): void
  on<T extends KernelEvent['type']>(
    type: T,
    handler: (event: Extract<KernelEvent, { type: T }>) => void
  ): () => void  // 返回 unsubscribe
}
```

### 4.4 StateMachine

```typescript
class AnnotationStateMachine {
  getState(): InteractionState

  hover(id: string | null): void
  select(id: string): void
  multiSelect(ids: string[]): void
  startDraw(pt: Point): void
  updateDraw(pt: Point): void
  endDraw(): Rect | null
  reset(): void

  // 状态变化订阅
  onChange(handler: (state: InteractionState) => void): () => void
}
```

---

## 五、场景模块设计

### 5.1 翻译双栏

#### 布局结构
```
┌─────────────────────────────────────────────────────────┐
│  Header（工具栏：语种切换、视图模式）                    │
├──────────────────────┬──────────────────────────────────┤
│  Left Pane（原文）   │  Right Pane（译文）               │
│  Canvas              │  Canvas                          │
│  TextLayer（透明）   │  TextLayer（透明）                │
│  SVG 段落高亮层      │  SVG 段落高亮层                   │
├──────────────────────┴──────────────────────────────────┤
│  底部状态栏：页码 / 缩放                                 │
└─────────────────────────────────────────────────────────┘
```

#### 关键逻辑

**段落对齐（非像素对齐）**
```typescript
// 滚动时找到视口顶部段落 → 对侧跳转到对应段落
class ScrollSyncBridge {
  private locked = false

  buildAlignMap(
    srcParagraphs: Paragraph[],
    tgtParagraphs: Paragraph[],
    mappings:      ParagraphMapping[]
  ): Map<string, { leftY: number; rightY: number }>

  onScroll(side: 'left' | 'right', scrollTop: number): void {
    if (this.locked) return
    this.locked = true
    const topParagraph = this.findTopVisible(side, scrollTop)
    const mapped       = this.alignMap.get(topParagraph.id)
    const targetY      = side === 'left' ? mapped.rightY : mapped.leftY
    this.getOpposite(side).scrollTo({ top: targetY, behavior: 'instant' })
    requestAnimationFrame(() => { this.locked = false })
  }
}
```

**TextLayer 构建（透明可复制）**
```typescript
// 每个 TextItem 对应一个绝对定位 span
// scaleX 修正 DOM 字宽 vs Canvas 字宽差异
function buildTextLayer(items: TextItem[], scale: number): HTMLElement {
  const layer = document.createElement('div')
  layer.style.cssText = 'position:absolute;inset:0;opacity:0;user-select:text;pointer-events:all'

  items.forEach(item => {
    const domWidth    = measureTextWidth(item.text, item.fontSize)
    const targetWidth = item.bbox.w * scale
    const span        = document.createElement('span')

    span.textContent  = item.text
    span.style.cssText = `
      position:absolute;
      left:${item.bbox.x * scale}px;
      top:${item.bbox.y * scale}px;
      font-size:${item.fontSize * scale}px;
      white-space:pre;
      transform:scaleX(${targetWidth / domWidth});
      transform-origin:0 0;
    `
    layer.appendChild(span)
  })
  return layer
}
```

**selectionchange 处理（选中时短暂显示文字层）**
```typescript
document.addEventListener('selectionchange', () => {
  const hasSelection = !window.getSelection()?.isCollapsed
  // 0.0001 而非 1：选区高亮正常但文字不遮挡 Canvas 视觉
  textLayer.style.opacity = hasSelection ? '0.0001' : '0'
})
```

---

### 5.2 智检标注

#### 布局结构
```
┌────────────────────────────────────┬──────────────────┐
│  文档 / 文本区域（主区，全宽）       │  错误面板（280px）│
│                                    │  错误统计 badge  │
│  [错误波浪线在文字正下方]            │  分类筛选        │
│                                    │  错误卡片列表    │
│                                    │  （接受/忽略）    │
└────────────────────────────────────┴──────────────────┘
```

#### 波浪线位置规范
- 位置：文字 bbox 底部 + 2px 间距
- 振幅：1.5px；波长：5px；线宽：1.5px
- 颜色：拼写 #ff4d4f / 语法 #fa8c16 / 标点 #1890ff / 数字 #52c41a / 涉政 #722ed1

#### 文本场景（ProseMirror Decoration）
```typescript
// CSS 原生 wavy，字体变化自动跟随，无需坐标维护
const WAVY_CLASSES: Record<string, string> = {
  'error-spelling':    'wavy-red',
  'error-grammar':     'wavy-orange',
  'error-punctuation': 'wavy-blue',
  'error-number':      'wavy-green',
  'error-political':   'wavy-purple',
}

// CSS
// .wavy-red    { text-decoration: underline wavy #ff4d4f 1.5px; }
// .wavy-orange { text-decoration: underline wavy #fa8c16 1.5px; }

function buildDecorations(annotations: Annotation[], doc: Node): DecorationSet {
  const decos = annotations.map(ann =>
    Decoration.inline(ann.position.from, ann.position.to, {
      class:      WAVY_CLASSES[ann.type],
      'data-id':  ann.id,
    })
  )
  return DecorationSet.create(doc, decos)
}
```

#### 文档场景（Canvas + SVG 波浪线）
```typescript
// 文字已渲染到 Canvas，在 SVG 浮层绘制波浪线
function applyDocumentErrors(
  annotations: Annotation[],
  adapter:     DocumentCoordAdapter,
  svgLayer:    SVGLayerAPI
) {
  annotations.forEach(ann => {
    const rects = adapter.toScreenRects(ann.position)  // 跨行返回多段
    svgLayer.addWavyUnderline(ann.id, rects, CATEGORY_COLOR[ann.type])
  })
}
```

#### 错误面板交互
```
错误卡片信息：错误原文 + 类型标签 + 建议词 + [接受] [忽略]
接受：→ EventBus ANNOTATION_ACCEPT → Editor 替换文本 → 标注移除 → 计数-1
忽略：→ EventBus ANNOTATION_IGNORE → 标注变灰 → 不影响文本
点击卡片：→ EventBus SCROLL_TO → 文档滚动到该错误 + SVG 高亮激活
快捷键：F8 下一个 / Shift+F8 上一个
```

---

### 5.3 OCR 通用识别

#### 布局结构
```
┌─── 上传区 / 工具栏 ─────────────────────────────────────┐
│  [上传图片]  [示例]                   [复制全文] [导出]  │
└─────────────────────────────────────────────────────────┘
┌────────────────────────────┬────────────────────────────┐
│  图片 + 识别框              │  文字结果面板               │
│  （SVG 矩形框 + 序号标签）  │  按识别顺序排列文字块       │
│                            │  每块可单独复制             │
│  ❶ ┌──────────┐           │  ❶  发票号码...            │
│    │识别文字   │           │  ❷  购买方...              │
│    └──────────┘           │  ❸  金额...                │
└────────────────────────────┴────────────────────────────┘
```

#### 双向联动
```typescript
// 图片侧 hover → 右侧面板
imageInteractionLayer.addEventListener('mousemove', throttle((e) => {
  const id = rtree.hitTest({ x: e.clientX, y: e.clientY })
  eventBus.emit({ type: 'ANNOTATION_HOVER', id })
}, 16))

// 右侧面板 hover → 图片侧
textPanel.addEventListener('mouseover', (e) => {
  const id = (e.target as HTMLElement).closest('[data-id]')?.dataset.id
  if (id) eventBus.emit({ type: 'ANNOTATION_HOVER', id })
})

// EventBus 统一驱动双侧高亮
eventBus.on('ANNOTATION_HOVER', ({ id }) => {
  svgLayer.setHighlight(prevId, false)
  if (id) {
    svgLayer.setHighlight(id, true, 'hover')
    textPanel.highlightItem(id)
  }
  prevId = id
})
```

---

### 5.4 OCR 自定义模板

#### 布局结构
```
┌─── Toolbar ─────────────────────────────────────────────┐
│  [选择 ▶]  [画框 +]  [删除 🗑]            [保存] [预览]  │
└─────────────────────────────────────────────────────────┘
┌────────────────────────────┬────────────────────────────┐
│  图片 + 字段标注框          │  字段配置面板               │
│                            │                            │
│  ❶ ┌──────────┐           │  字段名  [__________]      │
│    │ 发票号码  │ ← 当前选中 │  类型    [文本      ▼]     │
│    └──────────┘           │  必填    [✓]               │
│  ❷ ┌──────┐               │  校验    [__________]      │
│    │ 金额  │               │                            │
│    └──────┘               │  [保存字段]  [删除字段]      │
└────────────────────────────┴────────────────────────────┘
```

#### 画框工具状态机
```
idle
 │ 点击[画框+]
 ▼
drawing_ready（光标变十字）
 │ mousedown
 ▼
drawing（实时绘制虚线预览框）
 │ mouseup（面积 > 最小阈值 400px²）
 ▼
config_open（配置面板打开，等待用户填写）
 │ 点击[保存字段]
 ▼
idle（矩形固定，显示字段名标签）

 │ 点击[取消] 或 ESC
 ▼
idle（矩形销毁）
```

#### 矩形控制点（8个）
```
NW ── N ── NE
│           │
W           E
│           │
SW ── S ── SE

拖拽对角（NW/NE/SW/SE）：自由缩放
拖拽边中点（N/S/E/W）：单轴缩放
拖拽框体内部：移动
最小尺寸限制：20×20px（防止误操作）
```

#### 字段配置项
```typescript
interface FieldFormValues {
  label:       string               // 必填，显示在框左上角
  dataType:    FieldConfig['dataType']
  required:    boolean
  regex?:      string               // 可选，如 /^\d{4}-\d{2}-\d{2}$/
  description?: string
}
```

---

## 六、坐标变换管线

### 6.1 完整变换链

```
模型输出坐标（归一化 0~1 或像素）
      ↓  × imageNaturalSize
图像物理像素坐标
      ↓  × (canvasDisplaySize / imageNaturalSize)
Canvas CSS 坐标
      ↓  getBoundingClientRect() + scrollOffset
Viewport 坐标（用于 SVG 浮层定位）
      ↓  × devicePixelRatio
物理像素（Canvas 绘制用）
```

### 6.2 三种适配器实现要点

**ImageCoordAdapter**
- 缩放比 = canvas.offsetWidth / image.naturalWidth
- R-Tree 在图片加载完成后构建，窗口 resize 后重建
- hitTest 精度：点击区域扩展 2px 容差

**DocumentCoordAdapter**
- 每页 Canvas 独立，需加上页面在滚动容器内的 offsetTop
- 页面缩放时重新计算 scale，invalidate 所有 SVG 元素
- 使用 IntersectionObserver 感知哪些页在视口内

**TextCoordAdapter**
- `document.createRange()` + `setStart/End` → `getClientRects()`
- 字体/窗口变化后双 rAF 等 layout 稳定再重算
- 缓存 offset→node 映射，避免每次 TreeWalker 遍历

---

## 七、性能策略

### 7.1 文档渲染

```
Worker 线程     pdfium-wasm 渲染，主线程零压力
虚拟页面池      仅维护可视区 ±2 页（LRU 淘汰，revokeObjectURL 释放）
优先首屏        第一页优先渲染，其余页 requestIdleCallback 队列
预渲染          IntersectionObserver rootMargin: '200px' 提前加载
```

### 7.2 标注渲染

```
< 100 个    SVG 元素（支持 CSS 动画和 :hover）
100~500 个  Canvas 2D overlay
500+ 个     OffscreenCanvas（Worker 内渲染）
视口裁剪     仅渲染可视页/可视区标注，离屏标注 display:none
```

### 7.3 事件处理

```typescript
// mousemove 节流到 rAF（≈16ms）
let pendingPt: Point | null = null
container.addEventListener('mousemove', (e) => {
  pendingPt = { x: e.clientX, y: e.clientY }
})

function loop() {
  if (pendingPt) {
    const hit = hitEngine.hitTest(pendingPt)
    stateMachine.hover(hit)
    pendingPt = null
  }
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
```

### 7.4 文本标注失效处理

```typescript
// 字体/尺寸变化时批量 invalidate，双 rAF 等 layout 稳定
class LayoutWatcher {
  constructor(adapter: TextCoordAdapter, container: HTMLElement) {
    new MutationObserver(() => this.schedule())
      .observe(container, { attributes: true, subtree: true,
        attributeFilter: ['style', 'class'] })
    new ResizeObserver(() => this.schedule()).observe(container)
    document.fonts.ready.then(() => this.schedule())
  }

  private schedule() {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => this.adapter.invalidate())
    )
  }
}
```

### 7.5 动画：全部 GPU 合成

```css
.annotation-box, .wavy-path-group {
  will-change: transform, opacity;
  contain: layout style paint;
}
/* hover 只改 transform/opacity，不触发 layout */
.annotation-box:hover {
  transform: scaleX(1.01);
  opacity: 1;
}
```

---

## 八、共用 vs 独占模块汇总

| 模块 | 翻译双栏 | 智检文本 | 智检文档 | OCR通用 | OCR自定义 |
|------|---------|---------|---------|---------|---------|
| AnnotationStore | ✅ | ✅ | ✅ | ✅ | ✅ |
| EventBus | ✅ | ✅ | ✅ | ✅ | ✅ |
| StateMachine | ✅ | ✅ | ✅ | ✅ | ✅ |
| SVGLayer | ✅ | — | ✅ | ✅ | ✅ |
| Canvas+TextLayer | ✅ | — | ✅ | — | — |
| DocumentCoordAdapter | ✅ | — | ✅ | — | — |
| ImageCoordAdapter | — | — | — | ✅ | ✅ |
| TextCoordAdapter | — | ✅ | — | — | — |
| R-Tree HitTest | — | — | ✅ | ✅ | ✅ |
| ProseMirror Decoration | — | ✅ | — | — | — |
| ScrollSyncBridge | ✅ | — | — | — | — |
| DrawTool / ResizeTool | — | — | — | — | ✅ |
| ErrorPanel | — | ✅ | ✅ | — | — |
| TextResultPanel | — | — | — | ✅ | — |
| ConfigPanel | — | — | — | — | ✅ |

---

## 九、开发排期

```
Week 1      核心底层：AnnotationStore + StateMachine + EventBus + SVGLayer
Week 2-3    翻译双栏：DocumentRenderer(pdfium-wasm) + TextLayer + ScrollSync
Week 4      智检文本：ProseMirror Decoration + ErrorPanel
Week 5      智检文档：复用 DocumentRenderer + SVG 波浪线（成本最低）
Week 6-7    OCR 通用：ImageRenderer + 双向联动 + TextResultPanel
Week 8-9    OCR 自定义：DrawTool + ResizeTool + ConfigPanel + TemplateManager
Week 10     联调 + AI 接口对接 + 性能压测 + 交互细节打磨

预计总工期：2 ~ 2.5 个月（1人）
```
