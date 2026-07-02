# SDD 代码生成提示词集

> 使用顺序：按 Prompt 01 → 09 依次喂给 AI 编码工具
> 技术栈：React 18 + TypeScript 5 + Vite + pdfium-wasm + ProseMirror + rbush

---

## Prompt 01 — 项目基础类型定义

```
你是一名资深前端架构师，正在实现一套多模态 AI 渲染引擎。

请生成 `src/core/types.ts` 文件，包含以下全部类型定义：

【基础几何类型】
- Rect: { x: number; y: number; w: number; h: number }
- Point: { x: number; y: number }
- Size: { width: number; height: number }

【标注位置（三种坐标系）】
- PixelPosition: { kind: 'pixel'; bbox: Rect }
- PagePosition:  { kind: 'page'; page: number; bbox: Rect }
- OffsetPosition:{ kind: 'offset'; from: number; to: number }
- Position = PixelPosition | PagePosition | OffsetPosition

【标注类型枚举】
AnnotationType 包含：
'translation-paragraph' | 'error-spelling' | 'error-grammar' |
'error-punctuation' | 'error-number' | 'error-political' |
'ocr-region' | 'ocr-field'

【Annotation 接口】
- id: string
- type: AnnotationType
- position: Position
- content: { original, suggestion?, translation?, confidence?, fieldConfig? }
- status: 'active' | 'accepted' | 'ignored'
- meta?: Record<string, unknown>

【OCR 字段配置】
- FieldConfig: { id, label, dataType('text'|'number'|'date'|'checkbox'|'select'), required, regex?, description?, order }
- OCRTemplate: { id, name, description?, sampleImageUrl?, fields: FieldConfig[], createdAt, updatedAt }

【文档段落】
- Paragraph: { id, page, bbox: Rect, text, index }
- ParagraphMapping: { sourceId, targetId, confidence }

【交互状态】
InteractionState 联合类型：
- { type: 'idle' }
- { type: 'hover'; annotationId: string }
- { type: 'selected'; annotationId: string }
- { type: 'multiSelected'; annotationIds: string[] }
- { type: 'drawing'; startPt: Point; currentPt: Point }

【事件类型】
KernelEvent 联合类型，包含以下所有事件：
ANNOTATION_HOVER(id: string|null) / ANNOTATION_SELECT(id) /
ANNOTATION_MULTI_SELECT(ids) / ANNOTATION_ACCEPT(id) /
ANNOTATION_IGNORE(id) / ANNOTATIONS_LOADED(annotations) /
SCROLL_TO(annotationId) / DRAW_START(pt) / DRAW_UPDATE(pt) /
DRAW_END(rect) / FIELD_CONFIG_OPEN(fieldId, rect) /
FIELD_SAVED(config) / FIELD_DELETED(fieldId)

要求：
- 全部使用 TypeScript，严格类型，无 any
- 为每个类型添加 JSDoc 注释说明用途
- 导出全部类型
```

---

## Prompt 02 — 核心引擎三件套

```
基于已有的 src/core/types.ts，实现核心引擎三个模块。

【1. src/core/EventBus.ts】
实现发布订阅事件总线：
- emit<T extends KernelEvent>(event: T): void
- on<T extends KernelEvent['type']>(type, handler): () => void  // 返回 unsubscribe
- once<T>(type, handler): void
- clear(): void
使用 Map<string, Set<Function>> 存储订阅，支持同一事件多个订阅者。

【2. src/core/StateMachine.ts】
实现交互状态机：
- state: InteractionState（私有，只读访问通过 getState()）
- hover(id: string | null): void
- select(id: string): void
- multiSelect(ids: string[]): void
- startDraw(pt: Point): void
- updateDraw(pt: Point): void
- endDraw(): Rect | null  // 返回最终矩形，面积<400px²返回null
- reset(): void
- onChange(handler: (state: InteractionState) => void): () => void
状态变化时通过 EventBus 广播，状态转换需记录 prevState。

【3. src/core/AnnotationStore.ts】
实现标注数据状态管理：
- load(annotations: Annotation[]): void      // 批量加载，触发 ANNOTATIONS_LOADED
- add(annotation: Annotation): void
- update(id: string, patch: Partial<Annotation>): void
- remove(id: string): void
- getById(id: string): Annotation | undefined
- getAll(): Annotation[]
- getByType(type: AnnotationType): Annotation[]
- getByStatus(status: Annotation['status']): Annotation[]
- setStatus(id: string, status: Annotation['status']): void  // 触发对应事件
- clear(): void
内部使用 Map<string, Annotation> 存储，所有变更通过 EventBus 广播。

要求：
- 三个类均接收 EventBus 实例作为构造函数参数
- 所有公共方法添加 JSDoc
- 不使用任何外部状态管理库（如 Redux/Zustand）
```

---

## Prompt 03 — 坐标适配器（三种实现）

```
基于 src/core/types.ts，实现坐标适配器体系。

【1. src/adapters/CoordAdapter.ts】
定义抽象接口：
interface CoordAdapter {
  toScreenRects(pos: Position): DOMRect[]
  hitTest(pt: Point): string | null    // 返回 annotation id
  rangeSearch(rect: Rect): string[]    // 框选用，返回 ids 数组
  invalidate(): void
  destroy(): void
}

【2. src/adapters/ImageCoordAdapter.ts】
实现图片场景适配器：
- 构造函数接收 imgElement: HTMLImageElement, containerEl: HTMLElement
- scale = container.offsetWidth / img.naturalWidth
- toScreenRects: bbox * scale + containerBCR offset
- hitTest: 使用 rbush 空间索引，点击容差 ±2px
- rangeSearch: rbush.search(rect)
- invalidate: 重算 scale，重建 rbush
- ResizeObserver 监听 container 自动 invalidate
- 注意 devicePixelRatio 不影响 CSS 坐标计算

【3. src/adapters/DocumentCoordAdapter.ts】
实现文档场景适配器：
- 构造函数接收 pageRefs: Map<number, HTMLElement>, pageWidthPt: number
- toScreenRects(PagePosition):
    pageEl = pageRefs.get(page)
    bcr = pageEl.getBoundingClientRect()
    scale = bcr.width / pageWidthPt
    return [new DOMRect(bcr.x + bbox.x*scale, bcr.y + bbox.y*scale, bbox.w*scale, bbox.h*scale)]
- 跨行标注：外部已拆分，一次调用返回一个 rect
- hitTest: rbush 查询，考虑当前滚动偏移
- invalidate: 页面缩放/滚动后调用，重算所有屏幕坐标，重建 rbush

【4. src/adapters/TextCoordAdapter.ts】
实现文本场景适配器：
- 构造函数接收 editorEl: HTMLElement, getNodeAt: (offset: number) => { node: Text; offset: number }
- toScreenRects(OffsetPosition):
    range = document.createRange()
    range.setStart(node, localOffset)
    range.setEnd(node, localOffset)
    return Array.from(range.getClientRects())  // 跨行返回多个
- hitTest: document.caretPositionFromPoint → offset → findAnnotationAtOffset
- invalidate: 双 rAF 等 layout 稳定后重算
- 监听 ResizeObserver + MutationObserver(attributeFilter:['style','class']) + document.fonts.ready 自动 invalidate

所有适配器：
- registerAnnotations(annotations: Annotation[]): void  // 构建空间索引
- 使用 rbush 库（npm i rbush @types/rbush）
```

---

## Prompt 04 — SVG 标注层工厂

```
实现 src/layers/SVGLayer.ts，负责在 SVG 元素上绘制所有标注视觉元素。

接口定义：
interface BoxStyle {
  strokeColor: string
  fillColor: string    // rgba 半透明
  strokeWidth: number
  borderRadius?: number
}

class SVGLayer {
  constructor(svgEl: SVGSVGElement)

  // 在 rects 列表的每个 rect 底部 +2px 绘制波浪线
  // 振幅 1.5px，波长 5px，线宽 1.5px
  addWavyUnderline(id: string, rects: DOMRect[], color: string): void

  // 添加矩形标注框
  addAnnotationBox(id: string, rect: DOMRect, style: BoxStyle): void

  // 在矩形框左上角添加文字标签（序号或字段名）
  addTextLabel(id: string, rect: DOMRect, text: string, color: string): void

  // 控制高亮状态：hover 加深 fill，selected 加深 stroke
  setHighlight(id: string, on: boolean, mode?: 'hover' | 'selected'): void

  // 显示/隐藏 resize 控制点（8个方向）
  showResizeHandles(id: string): void
  hideResizeHandles(): void

  // 绘制拖拽预览矩形（虚线蓝框）
  showPreviewRect(rect: Rect): void
  updatePreviewRect(rect: Rect): void
  hidePreviewRect(): void

  remove(id: string): void
  clear(): void
}

波浪线生成算法：
function wavyPath(x: number, y: number, width: number): string {
  // y = rect.bottom + 2
  // 使用 SVG q 命令绘制正弦近似曲线
  // 每个周期：q ${λ/4} ${-amp} ${λ/2} 0  q ${λ/4} ${amp} ${λ/2} 0
}

分类颜色常量（导出）：
export const CATEGORY_COLOR: Record<AnnotationType, string> = {
  'error-spelling':    '#ff4d4f',
  'error-grammar':     '#fa8c16',
  'error-punctuation': '#1890ff',
  'error-number':      '#52c41a',
  'error-political':   '#722ed1',
  'ocr-region':        '#13c2c2',
  'ocr-field':         '#1890ff',
  'translation-paragraph': '#d9d9d9',
}

要求：
- 所有 SVG 元素挂在 g[data-id] 容器下，便于整组管理
- resize 控制点为 8 个 circle，半径 5px，cursor 分别设置正确方向
- highlight 通过 CSS class 切换实现，非 JS 直接改 style
- 波浪线 path 和矩形框 rect 均设 pointer-events: none（事件由上层接管）
```

---

## Prompt 05 — 翻译双栏场景

```
基于已实现的 Core + Adapters + SVGLayer，实现翻译双栏对比场景。

【文件结构】
src/scenes/translation/
  DualColumnLayout.tsx    // React 主容器组件
  ScrollSyncBridge.ts     // 滚动同步控制器
  ParagraphMapper.ts      // 段落对齐映射构建
  TextLayer.ts            // 透明可复制文字层

【1. TextLayer.ts】
export function buildTextLayer(items: TextItem[], scale: number): HTMLDivElement
- 创建 div，position:absolute;inset:0;opacity:0;user-select:text;pointer-events:all
- 每个 item 创建 span：
    position:absolute
    left: item.bbox.x * scale
    top:  item.bbox.y * scale
    font-size: item.fontSize * scale
    transform: scaleX(domWidth / targetWidth)  // 修正字宽差异
    transform-origin: 0 0
    white-space: pre
- measureTextWidth(text, fontSize): 用 OffscreenCanvas measureText 计算
- 监听 selectionchange：有选区时 opacity=0.0001，无选区时 opacity=0

【2. ParagraphMapper.ts】
export class ParagraphMapper
- buildAlignMap(src: Paragraph[], tgt: Paragraph[], mappings: ParagraphMapping[])
  返回 Map<string, { leftY: number; rightY: number }>
- lookupByScrollTop(side: 'left'|'right', scrollTop: number): { leftY: number; rightY: number }
  二分查找最近段落

【3. ScrollSyncBridge.ts】
export class ScrollSyncBridge
- constructor(leftEl: HTMLElement, rightEl: HTMLElement, mapper: ParagraphMapper)
- attach(): void   // 绑定 scroll 事件
- detach(): void   // 解绑
- 核心逻辑：
    scroll 事件 → locked 判断 → findTopParagraph → lookup → 对侧 scrollTo
    使用 requestAnimationFrame 解锁，防止循环触发
    scroll 事件 passive: true

【4. DualColumnLayout.tsx】
React 组件，Props：
- file: File
- onLoad?: () => void

内部流程（参考时序图 Seq-01 Seq-02）：
1. 上传文件 → Worker 渲染首页 → 显示左栏 Canvas + TextLayer
2. 并行调用翻译 API → 获取 TranslationResult
3. Worker 渲染译文页面 → 显示右栏
4. 构建 ParagraphMapper → 初始化 ScrollSyncBridge
5. 段落 hover → EventBus 双侧高亮

组件 DOM 结构：
<div class="dual-column-layout">
  <div class="pane pane-left">
    <canvas />
    <div class="text-layer" />   // TextLayer
    <svg class="svg-layer" />    // 段落高亮
    <div class="interaction-layer" />  // 透明事件层
  </div>
  <div class="pane pane-right">
    // 同左侧结构
  </div>
</div>

要求：
- 左右栏各占 50% 宽，flex 布局
- Canvas 渲染用 pdfium-wasm（在 Web Worker 中，通过 postMessage 通信）
- 虚拟页面池：仅维护可视区 ±2 页（LRU，超出 release ImageBitmap）
- IntersectionObserver rootMargin:'200px' 提前预渲染
- mousemove 节流到 rAF
```

---

## Prompt 06 — 智检场景（文本 + 文档）

```
实现智检标注场景，分文本和文档两种模式。

【文件结构】
src/scenes/inspection/
  InspectionText.tsx      // 文本智检组件
  InspectionDocument.tsx  // 文档智检组件
  DecorationPlugin.ts     // ProseMirror decoration 插件
  ErrorPanel.tsx          // 右侧错误面板组件
  useInspection.ts        // 共用业务逻辑 Hook

【1. DecorationPlugin.ts】
基于 ProseMirror：
- 实现 Plugin，管理 DecorationSet
- setAnnotations(annotations: Annotation[]): Transaction
  每条错误生成 Decoration.inline(from, to, { class: wavyClass, 'data-id': id })
- removeDecoration(id: string): Transaction
- setDecorationMuted(id: string): Transaction  // 忽略状态变灰

CSS class 映射：
'error-spelling' → 'wavy-red'
'error-grammar'  → 'wavy-orange'
以此类推（5种颜色）

CSS 需同步生成（或在注释中提供）：
.wavy-red    { text-decoration: underline wavy #ff4d4f 1.5px; }
.wavy-orange { text-decoration: underline wavy #fa8c16 1.5px; }
.wavy-blue   { text-decoration: underline wavy #1890ff 1.5px; }
.wavy-green  { text-decoration: underline wavy #52c41a 1.5px; }
.wavy-purple { text-decoration: underline wavy #722ed1 1.5px; }
.wavy-muted  { text-decoration: underline wavy #d9d9d9 1.5px; opacity: 0.5; }

【2. ErrorPanel.tsx】
Props：
- annotations: Annotation[]
- onAccept: (id: string) => void
- onIgnore: (id: string) => void
- onFocus:  (id: string) => void  // 点击跳转到文档位置
- activeId?: string

UI 结构：
- 顶部统计栏：各类型错误数量 badge（颜色对应）
- 分类筛选 Tab（全部/拼写/语法/标点/数字/涉政）
- 错误卡片列表：
    错误原文（高亮显示）+ 类型标签
    建议词（如有）
    [接受] [忽略] 按钮
- 接受后卡片消失，忽略后卡片变灰
- activeId 对应卡片高亮边框 + 自动滚动到可视区

【3. useInspection.ts】
共用 Hook，返回：
- annotations: Annotation[]
- activeId: string | null
- accept(id): void
- ignore(id): void
- focusNext(): void   // F8
- focusPrev(): void   // Shift+F8
内部用 AnnotationStore + EventBus

【4. InspectionText.tsx】
- 集成 ProseMirror Editor + DecorationPlugin
- 文本变化防抖 500ms 后调用 InspectionAPI
- 键盘事件：F8/Shift+F8 导航
- 布局：左侧编辑器（flex:1）+ 右侧 ErrorPanel（280px fixed）

【5. InspectionDocument.tsx】
- 复用 DocumentRenderer（pdfium-wasm，与翻译场景共用）
- 文档加载后调用 InspectionAPI 获取错误列表
- 通过 DocumentCoordAdapter.toScreenRects 获取每条错误的屏幕坐标
- SVGLayer.addWavyUnderline 绘制波浪线
- mousemove + R-Tree hitTest → hover 联动
- 布局：左侧文档（flex:1）+ 右侧 ErrorPanel（280px fixed）

错误 Tooltip（两种模式共用）：
- 内容：错误类型标签 + 原文 + 建议词 + [接受] [忽略]
- 位置：鼠标位置右下方，超出视口自动翻转
- 用 floating-ui 或手动计算位置
```

---

## Prompt 07 — OCR 通用识别场景

```
实现 OCR 通用识别场景，参考合合 OCR（TextIn）设计风格。

【文件结构】
src/scenes/ocr-general/
  OCRGeneralView.tsx      // 主视图组件
  ImageRenderer.ts        // 图片渲染器
  TextResultPanel.tsx     // 右侧文字结果面板

【1. ImageRenderer.ts】
class ImageRenderer
- constructor(container: HTMLElement)
- load(file: File): Promise<void>
  创建 <img>，设置 object-fit: contain，监听 load 获取 naturalSize
- getDisplayScale(): number   // container.offsetWidth / img.naturalWidth
- getNaturalSize(): Size
- getContainerBCR(): DOMRect
- onResize(cb: () => void): () => void  // ResizeObserver

【2. TextResultPanel.tsx】
Props：
- regions: Annotation[]  // type: 'ocr-region'
- activeId: string | null
- onHover: (id: string | null) => void
- onCopyAll: () => void

UI：
- 顶部：识别结果标题 + [复制全文] 按钮
- 结果列表：每行显示 序号❶ + 文字内容 + 置信度（可选，低置信度字体变浅）
- activeId 对应行高亮背景
- 每行右侧有单行复制小图标（hover 时显示）

【3. OCRGeneralView.tsx】
Props：
- onRecognize?: (file: File) => Promise<OCRResult[]>  // 可注入，便于测试

内部流程（参考时序图 Seq-05）：
1. 上传区（拖拽 or 点击）→ 选择图片文件
2. ImageRenderer 渲染图片
3. 调用 onRecognize(file) → 获取 OCRRegion[]
4. AnnotationStore.load(regions)
5. ImageCoordAdapter.registerAnnotations(regions)
6. SVGLayer 绘制识别框（含序号标签）
7. TextResultPanel 渲染文字列表
8. 双向 hover 联动（通过 EventBus）

DOM 结构：
<div class="ocr-general-view">
  <div class="toolbar">
    <UploadButton />
    <CopyAllButton />
  </div>
  <div class="content">
    <div class="image-pane">
      <img />
      <svg class="svg-layer" />
      <div class="interaction-layer" />  // 透明事件层，接管 hover/click
    </div>
    <div class="result-pane">
      <TextResultPanel />
    </div>
  </div>
</div>

交互细节：
- interaction-layer mousemove → rAF 节流 → hitTest → EventBus ANNOTATION_HOVER
- EventBus ANNOTATION_HOVER → SVGLayer.setHighlight + TextResultPanel activeId 更新
- 图片加载前显示上传引导区，加载后隐藏
- 图片 pane 与 result pane 左右各 50%，result pane minWidth: 280px

OCRResult 接口：
interface OCRResult {
  id: string
  text: string
  bbox: Rect        // 相对图片原始尺寸的像素坐标
  confidence: number
  order: number
}
```

---

## Prompt 08 — OCR 自定义模板场景

```
实现 OCR 自定义模板场景，参考百度 OCR 自定义模板设计。

【文件结构】
src/scenes/ocr-custom/
  TemplateEditor.tsx    // 主编辑器组件
  DrawTool.ts           // 矩形画框工具
  ResizeTool.ts         // 控制点缩放/移动工具
  ConfigPanel.tsx       // 字段配置面板
  TemplateManager.ts    // 模板 CRUD

【1. DrawTool.ts】
class DrawTool
- constructor(container: HTMLElement, svgLayer: SVGLayer, stateMachine: StateMachine)
- activate(): void   // 光标变十字，监听事件
- deactivate(): void // 恢复光标，移除监听

内部状态机（参考时序图 Seq-06）：
idle → drawing_ready → drawing → config_open → idle

事件处理：
- pointerdown：记录 startPt，开始绘制预览框
- pointermove：更新预览框（实时虚线矩形）
- pointerup：
    计算 rect = normalizeRect(start, end)
    面积 < 400px² → 取消，reset
    面积合法 → emit FIELD_CONFIG_OPEN(tempId, rect)
- ESC键：取消当前绘制，回到 idle

normalizeRect(p1, p2): Rect
  确保 x/y 为左上角（处理从右往左拖拽的情况）

【2. ResizeTool.ts】
class ResizeTool
- constructor(svgLayer: SVGLayer, store: AnnotationStore)
- activate(fieldId: string): void   // 显示 8 个控制点
- deactivate(): void                // 隐藏控制点

控制点索引：0=NW 1=N 2=NE 3=E 4=SE 5=S 6=SW 7=W

拖拽逻辑（参考时序图 Seq-07）：
- 控制点 pointerdown：记录 handleIndex + originalRect
- pointermove：calcResizedRect(originalRect, handleIndex, delta)
  各方向只改变对应边，最小尺寸 20x20px
- pointerup：store.update(fieldId, { position: { bbox: newRect } })

移动整个框：
- 框体内 pointerdown（非控制点）：记录 offset
- pointermove：移动框到新位置
- pointerup：store.update

【3. ConfigPanel.tsx】
Props：
- fieldId: string | null   // null 时隐藏
- initialRect: Rect | null
- initialConfig: Partial<FieldConfig> | null
- onSave: (config: FieldConfig) => void
- onDelete: (fieldId: string) => void
- onClose: () => void

表单字段：
- 字段名（text input，必填，placeholder: "如：发票号码"）
- 数据类型（select：文本/数字/日期/复选框/下拉）
- 是否必填（checkbox）
- 校验规则（text input，placeholder: "正则表达式，选填"）
- 备注（textarea，选填）

底部按钮：[保存字段] [删除字段]
- 保存：表单校验通过后调用 onSave
- 删除：确认 window.confirm 后调用 onDelete
- 字段名为空时 [保存字段] 禁用

【4. TemplateManager.ts】
class TemplateManager
- addField(config: FieldConfig): void
- updateField(id: string, patch: Partial<FieldConfig>): void
- removeField(id: string): void
- getFields(): FieldConfig[]
- saveTemplate(name: string, description?: string): OCRTemplate
- loadTemplate(template: OCRTemplate): void
- exportJSON(): string
- importJSON(json: string): void
内部用 localStorage 持久化（key: 'ocr-templates'）

【5. TemplateEditor.tsx】
主组件，整合以上所有模块。

DOM 结构：
<div class="template-editor">
  <Toolbar>
    <ToolButton icon="cursor" label="选择" onClick={deactivateDrawTool} />
    <ToolButton icon="plus" label="画框" onClick={activateDrawTool} />
    <ToolButton icon="delete" label="删除" onClick={deleteSelected} disabled={!selectedId} />
    <div class="spacer" />
    <Button onClick={saveTemplate}>保存模板</Button>
    <Button onClick={previewTemplate}>预览</Button>
  </Toolbar>
  <div class="editor-body">
    <div class="image-pane">
      <img />
      <svg class="svg-layer" />
      <div class="interaction-layer" />
    </div>
    <ConfigPanel
      fieldId={selectedFieldId}
      onSave={handleSave}
      onDelete={handleDelete}
      onClose={() => setSelectedFieldId(null)}
    />
  </div>
</div>

交互流程（完整，参考时序图 Seq-06 Seq-07）：
1. 上传样本图片 → ImageRenderer 渲染
2. EventBus 监听 FIELD_CONFIG_OPEN → setSelectedFieldId(tempId)
3. EventBus 监听 FIELD_SAVED → store.add + svgLayer 更新 + templateManager.addField
4. EventBus 监听 FIELD_DELETED → store.remove + svgLayer.remove + templateManager.removeField
5. interaction-layer click → hitTest → 激活 ResizeTool + 打开 ConfigPanel
6. interaction-layer click 空白 → deactivate + 关闭 ConfigPanel
```

---

## Prompt 09 — 整合入口 + 工具函数

```
实现工具函数库和整合入口。

【1. src/utils/coord.ts】
export function normalizeRect(p1: Point, p2: Point): Rect
  // 确保 x,y 为左上角，w,h 为正数

export function rectArea(rect: Rect): number

export function scaleRect(rect: Rect, scale: number): Rect

export function rectToClientRect(rect: Rect, origin: DOMRect): DOMRect
  // 相对坐标转绝对屏幕坐标

export function clientPointToRelative(pt: Point, origin: DOMRect): Point
  // 屏幕坐标转相对坐标

export function rectsOverlap(a: Rect, b: Rect): boolean

【2. src/utils/svg.ts】
export function makeSVGElement<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number>
): SVGElementTagNameMap[K]

export function wavyPathD(x: number, y: number, width: number): string
  // 生成波浪线 SVG path d 属性
  // y = rect.bottom + 2，振幅1.5，波长5

export function setAttrs(el: Element, attrs: Record<string, string | number>): void

【3. src/utils/measure.ts】
// 用 OffscreenCanvas 测量文字宽度（Worker 安全）
const measureCanvas = new OffscreenCanvas(1, 1)
const ctx = measureCanvas.getContext('2d')!

export function measureTextWidth(text: string, fontSize: number, fontFamily = 'sans-serif'): number

【4. src/utils/rtree.ts】
// rbush 封装，提供语义化 API
import RBush from 'rbush'

interface IndexItem {
  minX: number; minY: number; maxX: number; maxY: number
  id: string
}

export class SpatialIndex {
  private tree = new RBush<IndexItem>()

  load(items: Array<{ id: string; rect: DOMRect }>): void
  rebuild(items: Array<{ id: string; rect: DOMRect }>): void
  hitTest(pt: Point, tolerance = 2): string | null   // 返回面积最小的命中项
  rangeSearch(rect: Rect): string[]
  clear(): void
}

【5. src/index.ts 整合导出】
导出四个场景的主组件：
export { DualColumnLayout }   from './scenes/translation/DualColumnLayout'
export { InspectionText }     from './scenes/inspection/InspectionText'
export { InspectionDocument } from './scenes/inspection/InspectionDocument'
export { OCRGeneralView }     from './scenes/ocr-general/OCRGeneralView'
export { TemplateEditor }     from './scenes/ocr-custom/TemplateEditor'

导出核心类型：
export type { Annotation, AnnotationType, Position, FieldConfig, OCRTemplate } from './core/types'

【6. 全局 CSS（src/styles/annotations.css）】
生成以下样式：
- .wavy-red/orange/blue/green/purple/muted（波浪线 decoration）
- .annotation-box（基础标注框样式）
- .annotation-box.highlight-hover（hover 高亮）
- .annotation-box.highlight-selected（selected 高亮）
- .resize-handle（控制点圆点）
- .resize-handle[data-dir="nw"] { cursor: nw-resize } 等8个方向
- .preview-rect（虚线预览框：stroke-dasharray: 4 4）
- .text-label（框内字段名标签：font-size 11px，背景色半透明）
- 所有 annotation 相关元素：will-change: transform,opacity; contain: layout style paint

要求：
- coord.ts 和 svg.ts 无副作用，纯函数
- rtree.ts 的 hitTest 当多框重叠时返回面积最小的（最精准匹配）
- 全部有 JSDoc + 参数说明
```

---

## 使用说明

### 推荐喂给 AI 工具的顺序

```
Prompt 01  →  建立类型系统（其余所有 Prompt 依赖此）
Prompt 02  →  核心引擎（EventBus / StateMachine / Store）
Prompt 09  →  工具函数（其他场景依赖）
Prompt 03  →  三种坐标适配器
Prompt 04  →  SVGLayer 标注渲染
Prompt 05  →  翻译双栏场景
Prompt 06  →  智检场景
Prompt 07  →  OCR 通用场景
Prompt 08  →  OCR 自定义场景
```

### 每次喂提示词时附加的上下文说明

```
在每条 Prompt 前附加：
"请严格按照以下规范实现，不要引入未声明的第三方库（rbush / prosemirror-* / pdfium-wasm 除外）。
已有文件：src/core/types.ts（Prompt01生成）、src/core/EventBus.ts 等。
当前要实现的文件见下方 Prompt："
```

### 验收标准（每个 Prompt 生成后检查）

```
□ TypeScript 严格模式无报错（tsconfig strict: true）
□ 无 any 类型
□ 所有公共方法有 JSDoc
□ 组件有对应的 Props 类型定义
□ 事件监听均有对应的 cleanup（组件 unmount / destroy() 时移除）
□ 没有内存泄漏（WeakRef / revokeObjectURL 在适当位置调用）
```
