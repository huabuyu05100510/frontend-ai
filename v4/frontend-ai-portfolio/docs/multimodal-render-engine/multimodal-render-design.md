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
│
├── components/              # 通用 UI 组件（全场景共用）
│   ├── ErrorBoundary.tsx    # 场景级错误边界（降级 UI + 重试）
│   ├── LoadingSkeleton.tsx  # 骨架屏（适配 Canvas/文本/图片三种 loading 态）
│   ├── EmptyState.tsx       # 空状态占位（OCR 未上传、智检无错误等）
│   └── Toast.tsx            # 全局提示（复制成功 / 保存成功 / 操作失败）
│
├── hooks/                   # 通用 Hooks
│   ├── useAnnotationSync.ts # EventBus ↔ React state 双向桥接
│   ├── useKeyboardNav.ts    # 键盘快捷键注册（F8 / Shift+F8 / Escape）
│   └── useAutoSave.ts       # 草稿自动保存（OCR 模板场景，30s 间隔）
│
└── monitoring/              # 性能与异常监控
    ├── performance.ts       # 渲染耗时打点（首屏 P50/P95）
    └── error-tracking.ts    # 异常上报接口（可注入 Sentry/自建）
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

---

## 十、错误处理与降级策略

### 10.1 错误分类

| 类别 | 典型场景 | 处理策略 | 用户感知 |
|------|---------|---------|---------|
| 渲染错误 | pdfium-wasm 加载失败、Canvas 绘制异常 | 降级 UI + 重试 | 错误提示卡片 + [重试] 按钮 |
| API 错误 | 翻译/智检/OCR 接口超时或 5xx | AbortController 取消 + 重试 | Toast 通知 + 自动重试 1 次 |
| 资源加载 | 图片/字体 CDN 超时 | 超时 fallback | 占位图 + 重试 |
| 用户操作 | 画框面积 < 400px²、字段名空 | 前端校验阻止 | 内联错误提示 |

### 10.2 各场景降级行为

**pdfium-wasm 加载失败（翻译双栏 / 文档智检）**

```
GIVEN  pdfium-wasm .wasm CDN 加载超时（>10s）
WHEN  DualColumnLayout 已 mount
THEN  显示骨架屏 "文档引擎加载中..."（≤10s）
      超时后显示 "文档引擎加载失败，请刷新重试" + [重试] 按钮
      不白屏、不崩溃
      [重试] 点击后重新 fetch .wasm（带 cache-bust 参数）
```

**OCR API 部分识别失败（OCR 通用）**

```
GIVEN  OCR API 返回 10 个 region，其中 2 个 confidence < 0.3
WHEN  TextResultPanel 渲染
THEN  低置信度条目字体 opacity: 0.4
      条目旁显示 ⚠️ 图标（title="识别置信度较低"）
      全文复制时仍包含低置信度文本（用户自行判断）
```

**超大文档渲染限制（翻译双栏 / 文档智检）**

```
GIVEN  PDF 页数 > 200
WHEN  PDFWorker 逐页渲染
THEN  虚拟页面池 hard-cap 6 页（可视区 ±2 + 预渲染 2）
      单页 ImageBitmap > 50MB 时降级为 0.5x 分辨率渲染
      内存峰值 ≤ 300MB（超出时 LRU 淘汰最远页面）
      淘汰页面调用 bitmap.close() 释放 GPU 内存
```

**scroll 同步死循环防护（翻译双栏）**

```
GIVEN  左右栏内容高度差距 > 3x
WHEN  滚动到无映射段落的空白区域
THEN  对侧不滚动（保持当前位置，而非跳转到顶部/底部）
      locked 标志位在 500ms 超时后强制解锁（兜底）
      控制台 warn "ScrollSync: no mapping found for paragraph {id}"
```

### 10.3 ErrorBoundary 设计

```typescript
// 场景级错误边界：每个场景组件包裹
// 全局级错误边界：<App> 最外层包裹（兜底）

interface ErrorBoundaryProps {
  fallback?: React.ReactNode   // 自定义降级 UI
  onError?: (error: Error, info: ErrorInfo) => void  // 注入上报
  onRetry?: () => void         // 重试回调
  children: React.ReactNode
}

// 默认 fallback UI：
// ┌──────────────────────────────┐
// │  ⚠️ 渲染异常                   │
// │  抱歉，该模块加载失败。         │
// │  错误详情：{error.message}     │
// │  [重试]  [返回首页]            │
// └──────────────────────────────┘
```

### 10.4 加载状态流转

```
场景组件 mount
       │
       ▼
   [Loading] ───── 骨架屏 / 进度条
       │
       ├── 成功 ──→ [Loaded] ── 正常渲染
       │
       ├── 空数据 ──→ [Empty] ── EmptyState 组件
       │                  │
       │                  └── 用户操作（上传文件等）→ [Loading]
       │
       └── 失败 ──→ [Error] ── ErrorBoundary fallback
                         │
                         └── [重试] → [Loading]
```

每个场景组件必须实现上述 4 态（Loading / Loaded / Empty / Error），不得出现"永久 Loading"或"白屏 Error"。

---

## 十一、StateMachine 扩展

### 11.1 补充状态

原设计有 5 个状态（idle / hover / selected / multiSelected / drawing），OCR 自定义场景需要新增 3 个：

```typescript
type InteractionState =
  | { type: 'idle' }
  | { type: 'hover';         annotationId: string }
  | { type: 'selected';      annotationId: string }
  | { type: 'multiSelected'; annotationIds: string[] }
  | { type: 'drawing';       startPt: Point; currentPt: Point }
  // ↓ 新增
  | { type: 'resizing';      fieldId: string; handleIndex: number; originalRect: Rect }
  | { type: 'moving';        fieldId: string; offset: Point; originalRect: Rect }
  | { type: 'configuring';   fieldId: string }
```

### 11.2 状态转换表

| 当前状态 ↓ / 动作 → | hover(id) | select(id) | startDraw | endDraw | startResize | startMove |
|---------------------|-----------|------------|-----------|---------|-------------|-----------|
| **idle** | → hover | → selected | → drawing | warn | warn | warn |
| **hover** | → hover | → selected | → drawing | warn | → resizing | → moving |
| **selected** | → hover | → selected | → drawing | warn | → resizing | → moving |
| **drawing** | warn | warn | warn | → idle / configuring | warn | warn |
| **resizing** | warn | → selected | warn | → idle | warn | warn |
| **moving** | warn | → selected | warn | → idle | warn | warn |
| **configuring** | warn | → selected | warn | → idle | → resizing | → moving |

**非法转换规则**：所有非法转换不抛异常，只 `console.warn('[StateMachine] illegal transition: {from} → {action}')`，状态不变。

### 11.3 新增方法

```typescript
class AnnotationStateMachine {
  // ... 原有方法

  // 进入 resize 模式
  startResize(fieldId: string, handleIndex: number, originalRect: Rect): void

  // 进入 move 模式
  startMove(fieldId: string, offset: Point, originalRect: Rect): void

  // resize/move 过程中更新
  // （复用 updateDraw 逻辑，或新增 updateResize/updateMove）

  // 结束 resize/move，返回最终矩形
  endResize(): Rect | null
  endMove(): Rect | null

  // 进入字段配置模式
  startConfiguring(fieldId: string): void

  // 退出配置模式
  endConfiguring(): void
}
```

---

## 十二、AnnotationStore 扩展

当前 store 缺少批量操作、置信度过滤、页面范围查询、撤销能力。补充以下方法：

```typescript
interface AnnotationStore {
  // === 原有方法 ===
  load(annotations: Annotation[]): void
  add(annotation: Annotation): void
  update(id: string, patch: Partial<Annotation>): void
  remove(id: string): void
  getById(id: string): Annotation | undefined
  getAll(): Annotation[]
  getByType(type: AnnotationType): Annotation[]
  getByStatus(status: Annotation['status']): Annotation[]
  setStatus(id: string, status: Annotation['status']): void
  clear(): void

  // === 新增方法 ===

  // 批量状态操作（智检"全部接受"）
  // 触发 ANNOTATION_ACCEPT × N 事件，不触发 ANNOTATIONS_LOADED
  setStatusBatch(ids: string[], status: Annotation['status']): void

  // 按置信度过滤（OCR 低置信度标记）
  // 返回 confidence ≤ threshold 的标注
  getByConfidence(threshold: number): Annotation[]

  // 按页面范围查询（文档场景虚拟页面池）
  // 只返回 page 在 [start, end] 范围内的标注
  getByPageRange(startPage: number, endPage: number): Annotation[]

  // 撤销上一次 setStatus 操作
  // 内部维护操作栈（最多 20 步），accept/ignore 可撤销
  undo(): boolean  // 返回 false 表示无历史可撤销

  // 变更历史（供 UI 展示操作记录）
  getHistory(): Array<{
    action: 'accept' | 'ignore' | 'batch_accept' | 'batch_ignore'
    annotationId: string
    prevStatus: Annotation['status']
    timestamp: number
  }>
}
```

**undo 实现约束**：
- 操作栈最大深度 20，超出时 shift 最旧记录
- 仅记录 `setStatus` / `setStatusBatch` 产生的状态变更
- `add` / `remove` / `update` 不可撤销（复杂度可控）
- `clear()` 时清空历史栈

---

## 十三、可访问性规范

### 13.1 键盘导航

| 快捷键 | 作用域 | 行为 |
|--------|--------|------|
| Tab | 全局 | 按 Tab 序在可交互元素间移动焦点 |
| Enter | 聚焦元素 | 激活当前焦点元素（错误卡片跳转、按钮点击） |
| Escape | 全局 | 关闭 tooltip / 退出画框模式 / 关闭 ConfigPanel |
| F8 | 智检场景 | 跳转到下一个错误标注 |
| Shift+F8 | 智检场景 | 跳转到上一个错误标注 |
| ↑↓←→ | OCR 自定义移动模式 | 微调选中框位置（每次 1px） |
| Shift+↑↓←→ | OCR 自定义移动模式 | 微调选中框位置（每次 10px） |

### 13.2 ARIA 标注规范

```html
<!-- OCR 识别框 -->
<g role="img"
   aria-label="识别区域：发票号码 12345678"
   aria-describedby="result-item-1">
  <rect ... />
  <text>❶</text>
</g>

<!-- 智检波浪线 -->
<span class="wavy-red"
      role="mark"
      aria-label="拼写错误：recieve"
      data-suggestion="receive">
  recieve
</span>

<!-- 错误面板 -->
<div role="complementary" aria-label="错误列表面板">
  <div role="status" aria-live="polite" aria-atomic="true">
    共检测到 5 个错误
  </div>
  <ul role="list">
    <li role="listitem" tabindex="0" aria-label="拼写错误：recieve，建议替换为 receive">
      ...
    </li>
  </ul>
</div>
```

### 13.3 色彩无障碍

当前 5 种错误颜色对红绿色盲不友好（红/绿/橙难以区分）。补充**图案区分**：

| 错误类型 | 颜色 | 图案（波浪线纹理） | CSS |
|---------|------|-------------------|-----|
| 拼写 | #ff4d4f | 实线波浪 | `text-decoration-style: wavy` (默认) |
| 语法 | #fa8c16 | 虚线波浪 | `text-decoration-style: wavy; text-decoration-skip-ink: none` |
| 标点 | #1890ff | 点线波浪 | 用 SVG pattern 实现 dotted wavy |
| 数字 | #52c41a | 双波浪线 | 两条 offset 差 1px 的 wavy underline |
| 涉政 | #722ed1 | 粗波浪线 | `text-decoration-thickness: 3px` |

**prefers-reduced-motion 支持**：

```css
@media (prefers-reduced-motion: reduce) {
  .annotation-box {
    transition: none;
    animation: none;
  }
  .annotation-box:hover {
    transform: none;  /* 取消 scale 动画 */
  }
}
```

### 13.4 屏幕阅读器播报时序

```
用户操作                →  aria-live 播报
─────────────────────────────────────────────
hover 标注框            →  "区域 {序号}：{文字内容}"
click 接受建议          →  "已接受建议，{错误类型} 已修正"
click 忽略              →  "已忽略，{错误类型} 保留"
OCR 识别完成            →  "识别完成，共 {N} 个区域"
模板保存               →  "模板已保存，{模板名}"
API 错误               →  "识别失败，请重试"（role="alert"）
```

---

## 十四、性能 SLA 量化

### 14.1 渲染指标

| 指标 | 目标值 | 测量方式 | 达标条件 |
|------|--------|---------|---------|
| 首屏渲染（PDF 首页） | P50 ≤ 2s, P95 ≤ 5s | `performance.mark('first-page-rendered')` | 10 次取 P50/P95 |
| 标注 hover 响应 | ≤ 16ms（单帧） | `hitTest` 耗时采样 | P99 ≤ 16ms |
| scroll 同步延迟 | ≤ 1 帧（~16ms） | 对侧 `scrollTo` 调用到实际渲染 | 肉眼无感知 |
| OCR 图片加载 + 标注 | ≤ 3s（10MB 图片） | `performance.measure('ocr-load-to-annotated')` | P50 ≤ 3s |
| 模板编辑器画框延迟 | ≤ 16ms（预览框） | `pointermove → previewRect` 延迟 | 不丢帧 |

### 14.2 内存指标

| 指标 | 上限 | 测量方式 | 超限处理 |
|------|------|---------|---------|
| 虚拟页面池 | ≤ 6 页 | `pagePool.size` | LRU 淘汰最远页 + `bitmap.close()` |
| 单页 ImageBitmap | ≤ 50MB | `bitmap.width × bitmap.height × 4` | 降级 0.5x 分辨率 |
| 总 JS Heap | ≤ 300MB | `performance.memory.usedJSHeapSize` | 触发告警日志 |
| 标注数上限 | ≤ 5000 条 | `AnnotationStore.getAll().length` | 超过时切换 OffscreenCanvas 渲染 |

### 14.3 网络超时

| 操作 | 超时 | 重试策略 |
|------|------|---------|
| pdfium-wasm 加载 | 10s | 手动重试（用户点击） |
| 翻译 API | 30s | 自动重试 1 次（间隔 2s），失败后手动 |
| 智检 API | 15s | 自动重试 1 次，失败显示部分结果 |
| OCR API | 20s | 自动重试 1 次，失败后 AbortController 取消 |
| 图片上传 | 60s | 不重试，提示"图片过大，请压缩后重试" |

### 14.4 性能监控埋点

```typescript
// 埋点命名规范：{模块}:{操作}:{状态}
// 示例：
performance.mark('pdf:first-page:start')
performance.mark('pdf:first-page:end')
performance.measure('pdf:first-page', 'pdf:first-page:start', 'pdf:first-page:end')

performance.mark('ocr:recognize:start')
performance.mark('ocr:recognize:end')
performance.measure('ocr:recognize', 'ocr:recognize:start', 'ocr:recognize:end')

performance.mark('annotation:hitTest:start')
performance.mark('annotation:hitTest:end')
performance.measure('annotation:hitTest', 'annotation:hitTest:start', 'annotation:hitTest:end')
```
