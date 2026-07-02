# 多模态 AI 渲染引擎 — 技术规格文档 v3.0

> 面向腾讯 / 字节 / 阿里 AI 前端岗位求职演示项目
> 版本：v3.0 | 更新：2026-06

---

## 变更说明（v3.0 vs v2.0）

| 变更点 | 原因 |
|--------|------|
| 补全 PerfPanel 完整实现规格 | v2.0 有规格无代码，面试演示时缺少"数字可见"证明 |
| 补全 OCR 三层架构集成规格 | TextOverlayLayer 已实现但未接入 OCRGeneralView |
| 补全 VirtualPagePool 实现规格 | v2.0 有 TypeScript 接口无实现 |
| 新增 Streaming Markdown SSE Token 流面板 | v2.0 仅渲染结果，缺少"左栏 token 流"教学价值 |
| 新增 Inspection 流式标注动画规格 | v2.0 标注一次性全出现，缺少 AI 逐条返回感 |
| 修正 InspectionText @ts-ignore | 改用 ProseMirror 标准 API `TextSelection.near()` |
| 新增 Generative UI 入场动画规格 | depth=0 组件出现缺少视觉反馈 |

---

## 实现状态快照

| 模块 | 状态 | 备注 |
|------|------|------|
| types.ts | ✅ 完成 | |
| EventBus | ✅ 完成 | |
| AnnotationStore | ✅ 完成 | |
| ImageCoordAdapter (R-Tree) | ✅ 完成 | |
| TextOverlayLayer | ✅ 完成 | 未接入 OCRGeneralView |
| PageDataAPI mock | ✅ 完成 | |
| BracketDepthTracker | ✅ 完成 | 已有测试 |
| useAbortableStream | ✅ 完成 | 已有测试 |
| StreamingParser | ✅ 完成 | 已有测试 |
| StreamingScene（三子场景） | ✅ 完成 | 需补 SSE 面板 + 动画 |
| InspectionText（ProseMirror） | ✅ 完成 | 需修 @ts-ignore + 动画 |
| TemplateEditor（OCR 自定义） | ✅ 完成 | 无需改动 |
| DualColumnLayout（翻译） | ✅ 完成 | 需接入 VirtualPagePool |
| OCRGeneralView | ⚠️ 部分 | 缺三层架构 + 工具栏 + 热力图 |
| **PerfPanel** | ❌ 缺失 | P0，最高 ROI |
| **VirtualPagePool** | ❌ 缺失 | P0 |
| **ConfidenceHeatmap Worker** | ❌ 缺失 | P1 |
| **Inspection 流式动画** | ❌ 缺失 | P1 |
| **Streaming SSE Token 面板** | ❌ 缺失 | P1 |

---

## 1. 系统架构（不变）

```
┌─────────────────────────────────────────────────────┐
│                    Scene Layer（场景层）               │
│  InspectionScene | OCRScene | TranslationScene |      │
│  StreamingScene                                       │
├─────────────────────────────────────────────────────┤
│                  Rendering Pipeline（渲染管线）        │
│  VirtualPagePool → ImageLayer → TextOverlayLayer →   │
│  AnnotationLayer → InteractionLayer                   │
├─────────────────────────────────────────────────────┤
│                   Core Infrastructure                  │
│  PageDataAPI | FormatAdapter | CoordAdapter |          │
│  AnnotationStore | EventBus | SpatialIndex(R-Tree)     │
└─────────────────────────────────────────────────────┘
```

---

## 2. 核心数据模型（不变，见 v2.0 Section 3）

---

## 3. 场景规格

### Scene 1：智检标注（新增：流式标注动画）

**现有能力（保留）**
- ProseMirror + DecorationSet 波浪线，6 类错误颜色区分
- hover tooltip + 右侧 ErrorPanel 双向联动
- F8 / Shift+F8 跳转导航
- 500ms 防抖重新校对

**新增 A：流式标注动画**

```
触发：runInspection() 生成 annotations 列表
行为：
  1. 显示"AI 分析中..."thinking 动画（3 个跳动圆点，1.5s）
  2. 1.5s 后开始逐条加载标注：
     - 每条标注延迟 = index × 80ms
     - 通过 AnnotationStore.add() 逐条写入（而非 load()）
     - 每次 add() 触发 EventBus ANNOTATION_ADD 事件
     - DecorationPlugin 监听事件，增量 patch DecorationSet
  3. 标注淡入：CSS @keyframes fadeInSlide
       from { opacity: 0; transform: translateY(-4px) }
       to   { opacity: 1; transform: translateY(0) }
     不触发布局重排（只使用 opacity + transform）
```

**新增 B：修复 @ts-ignore**

```typescript
// 当前（错误）
// @ts-ignore
viewRef.current.state.selection.constructor.near(...)

// 修复后
import { TextSelection } from 'prosemirror-state'
const tr = view.state.tr
  .setSelection(TextSelection.near(view.state.doc.resolve(from)))
  .scrollIntoView()
view.dispatch(tr)
```

**验收标准**
- [ ] 标注逐条淡入，间隔 80ms，动画不触发 layout thrashing
- [ ] "AI 分析中..." thinking 动画显示 1.5s
- [ ] @ts-ignore 已移除，改为 TextSelection.near()
- [ ] 10 万字文档标注 < 500ms（requestIdleCallback 分片）

---

### Scene 2：OCR 通用识别（核心升级）

#### 2.1 三层渲染架构（升级目标）

```
Layer 1: <img>    原始图像（base layer）
Layer 2: <canvas> 置信度热力图（Web Worker 渲染，可切换）
Layer 3: <svg>    文字覆盖层 + 标注框（TextOverlayLayer，主交互层）
```

**当前问题：**
- OCRGeneralView 未使用 TextOverlayLayer，自行用蓝色 `<rect>` 覆盖
- 所有 block 同色，无置信度差异化渲染
- 无热力图，无工具栏

#### 2.2 OCRGeneralView 改造规格

**步骤 1：适配 OCR Mock 数据到 TextBlock 格式**

```typescript
// OCR_STRUCTURED 中的 OcrBlock 需映射为 TextBlock（TextOverlayLayer 标准输入）
function ocrBlocksToTextBlocks(blocks: OcrBlock[], naturalW: number, naturalH: number): TextBlock[] {
  return blocks.map((b, i) => ({
    id: `ocr-${i}`,
    bbox: {
      x: b.bbox.x * naturalW,
      y: b.bbox.y * naturalH,
      w: b.bbox.w * naturalW,
      h: b.bbox.h * naturalH,
    },
    text: b.text,
    type: roleToBlockType(b.role),  // title→heading, subtitle→heading, field→cell, body→paragraph, separator→separator
    confidence: b.confidence,
    label: b.label,
  }))
}
```

**步骤 2：TextOverlayLayer 渲染到 SVG**

```typescript
// 在 <svg> 元素 ref 可用后初始化 TextOverlayLayer
const layerRef = useRef<TextOverlayLayer | null>(null)

useEffect(() => {
  if (!svgRef.current) return
  layerRef.current = new TextOverlayLayer(svgRef.current)
}, [])

useEffect(() => {
  if (!layerRef.current || !imgRect.width) return
  const scale = imgRect.width / activeItem.naturalWidth
  const textBlocks = ocrBlocksToTextBlocks(blocks, activeItem.naturalWidth, activeItem.naturalHeight)
  layerRef.current.render(textBlocks, scale)
}, [activeItem, blocks, imgRect])
```

**步骤 3：三档工具栏**

```
[ 框模式 ]  仅显示标注框（TextOverlayLayer 中 text 元素隐藏）
[ 文字模式 ] 标注框 + 文字覆盖（默认）
[ 热力图 ]  置信度热力图叠加（canvas layer 显示）
```

工具栏 state：`type DisplayMode = 'box' | 'text' | 'heatmap'`

#### 2.3 置信度热力图 Web Worker

**Worker 文件：** `src/pipeline/ConfidenceHeatmap.worker.ts`

```typescript
// 主线程 → Worker 消息
interface HeatmapRequest {
  type: 'RENDER'
  blocks: Array<{ bbox: BboxNormalized; confidence: number }>  // bbox 0-1 归一化
  width: number
  height: number
}

// Worker → 主线程消息
interface HeatmapResponse {
  type: 'DONE'
  bitmap: ImageBitmap
}

// Worker 内部渲染逻辑
self.onmessage = (e: MessageEvent<HeatmapRequest>) => {
  const { blocks, width, height } = e.data
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!

  blocks.forEach(({ bbox, confidence }) => {
    // confidence=1 → 完全透明；confidence=0 → 深红色
    const alpha = (1 - confidence) * 0.75
    ctx.fillStyle = `hsla(0, 100%, 50%, ${alpha})`
    ctx.fillRect(
      bbox.x * width,
      bbox.y * height,
      bbox.w * width,
      bbox.h * height,
    )
  })

  canvas.transferToImageBitmap().then(bitmap => {
    self.postMessage({ type: 'DONE', bitmap }, [bitmap])
  })
}
```

**主线程集成：**

```typescript
const workerRef = useRef<Worker | null>(null)
const heatmapCanvasRef = useRef<HTMLCanvasElement>(null)

useEffect(() => {
  workerRef.current = new Worker(
    new URL('../pipeline/ConfidenceHeatmap.worker.ts', import.meta.url),
    { type: 'module' }
  )
  workerRef.current.onmessage = (e) => {
    if (e.data.type === 'DONE' && heatmapCanvasRef.current) {
      const ctx = heatmapCanvasRef.current.getContext('2d')!
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      ctx.drawImage(e.data.bitmap, 0, 0)
    }
  }
  return () => workerRef.current?.terminate()
}, [])

// 当模式切换到 heatmap 时触发渲染
useEffect(() => {
  if (displayMode !== 'heatmap' || !workerRef.current) return
  workerRef.current.postMessage({
    type: 'RENDER',
    blocks: normalizedBlocks,
    width: imgRect.width,
    height: imgRect.height,
  })
}, [displayMode, normalizedBlocks, imgRect])
```

**验收标准**
- [ ] 三档工具栏切换流畅
- [ ] 文字模式：heading 加粗紫色，field 有 label badge，低置信度有橙/红边框
- [ ] 热力图在 Web Worker 渲染，切换时主线程 FPS 不下降
- [ ] hover 时图上 block 与右侧 TextResultPanel 双向联动

---

### Scene 3：OCR 自定义模板（不变）

---

### Scene 4：翻译双栏（接入 VirtualPagePool）

**新增：文档模式**

```
模式切换按钮：[ 文本模式 | 文档模式 ]
文档模式：
  左栏 → VirtualPagePool 渲染的页面 canvas（含 TextBlock hover 框）
  右栏 → 与左栏等高对齐的译文卡片列表
```

见 Section 5 VirtualPagePool 规格。

**验收标准**
- [ ] 文本/文档模式切换动画 300ms
- [ ] 30 页文档快速滚动帧率 ≥ 60fps
- [ ] 内存面板（PerfPanel）可见池占用 ≤ 5 页

---

### Scene 5：AI 流式渲染（子场景升级）

#### 5A：Streaming Markdown — 加 SSE Token 流面板

**新布局（双栏 + 底部）：**

```
┌─────────────────────┬──────────────────────┐
│  SSE TOKEN STREAM   │   RENDERED OUTPUT    │
│  (左栏)             │   (右栏)              │
│  实时滚动            │   增量 Markdown 渲染  │
│  当前 chunk 高亮     │                      │
├─────────────────────┴──────────────────────┤
│  进度条 + 控制按钮（▶开始 | ⏹中断 | 重置）    │
└─────────────────────────────────────────────┘
```

**左栏 SSE Token 流规格：**

```typescript
interface TokenChunk {
  text: string
  isCurrent: boolean  // 最新一条高亮
  timestamp: number
}

// 渲染：每个 chunk 一个 <span>
// 当前 chunk：background #f38ba8，其余 #cdd6f4
// 自动滚动到底部（scrollTop = scrollHeight）
```

**新增"中断"按钮：**

```typescript
// 已有 useAbortableStream，直接复用
const { start, abort } = useAbortableStream()

// 点击"中断"：abort() → setRunning(false) → 停止 tick
```

**验收标准**
- [ ] 左栏实时显示 SSE chunk，当前 chunk 高亮
- [ ] 右栏增量渲染，每帧只 patch 新增 token
- [ ] 中断按钮可在流式过程中立即停止

#### 5B：Generative UI — 入场动画

```css
/* depth 归零时组件以 scale+fade 出现 */
@keyframes genui-enter {
  from { opacity: 0; transform: scale(0.90) translateY(8px); }
  to   { opacity: 1; transform: scale(1)    translateY(0);   }
}

.genui-card {
  animation: genui-enter 280ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

depth 计数器变化时加 CSS `transition: color 0.15s`，depth=0 时颜色从蓝变绿（✓）。

**验收标准**
- [ ] 组件入场有 scale+fade 动画
- [ ] depth=0 时计数器颜色变绿，有 "✓ 完成" 标记

---

## 4. 性能可视化面板（PerfPanel）— 全新实现

### 4.1 数据采集层：PerfCollector

```typescript
// src/perf/PerfCollector.ts

interface PerfSnapshot {
  fps: number           // 1s 滑动窗口均值
  renderTime: number    // ms，最近一次 annotation render 耗时
  hitTestTime: number   // ms，最近一次 R-Tree hitTest 耗时
  annotationCount: number
  poolSize: number      // VirtualPagePool 当前 canvas 页数
  poolMax: number       // maxPoolSize 配置值
}

class PerfCollector {
  private frameTimestamps: number[] = []   // rAF 时间戳队列（1s 窗口）
  private rafHandle = 0
  private snapshot: PerfSnapshot = { fps: 0, renderTime: 0, hitTestTime: 0, annotationCount: 0, poolSize: 0, poolMax: 5 }
  private listeners = new Set<(s: PerfSnapshot) => void>()

  start(): void          // 启动 rAF FPS 统计循环
  stop(): void           // 停止
  recordRender(ms: number): void    // 记录标注渲染耗时
  recordHitTest(ms: number): void   // 记录 R-Tree 命中耗时
  setAnnotationCount(n: number): void
  setPoolStatus(size: number, max: number): void
  subscribe(fn: (s: PerfSnapshot) => void): () => void  // 返回 unsubscribe
  getSnapshot(): PerfSnapshot
}
```

**FPS 计算：**

```typescript
private tick = (now: number) => {
  this.frameTimestamps.push(now)
  // 移除 1s 前的帧
  const cutoff = now - 1000
  while (this.frameTimestamps[0] < cutoff) this.frameTimestamps.shift()
  this.snapshot.fps = this.frameTimestamps.length

  // 每 500ms setState 一次（避免高频 re-render）
  this.rafHandle = requestAnimationFrame(this.tick)
}
```

### 4.2 展示层：PerfPanel

**外观规格：**

```
位置：fixed，右下角，z-index: 9999
尺寸：宽 220px，自适应高度
背景：rgba(0, 0, 0, 0.82)，backdrop-filter: blur(6px)
字体：monospace 11px
```

**渲染示意：**

```
┌─────────────────────────┐
│  PERF MONITOR      [×]  │
│─────────────────────────│
│  FPS    ██████████  60  │
│  渲染   ████░░░░  3.2ms │
│  命中   ▌ 0.4ms         │
│  标注数  127             │
│  内存池  ██░░░  3/5 页  │
└─────────────────────────┘
```

**条形图渲染规格：**

| 指标 | 满格值 | 颜色阈值 |
|------|--------|---------|
| FPS | 60fps | ≥50 绿，30-49 黄，<30 红 |
| 渲染时间 | 16ms | ≤8ms 绿，8-16ms 黄，>16ms 红 |
| 命中时间 | 1ms | ≤0.5ms 绿，0.5-1ms 黄，>1ms 红 |

**组件接口：**

```typescript
// src/perf/PerfPanel.tsx

interface PerfPanelProps {
  collector: PerfCollector
  visible: boolean
  onClose: () => void
}

export function PerfPanel({ collector, visible, onClose }: PerfPanelProps): JSX.Element | null
```

**在 App.tsx 中集成：**

```typescript
// 右上角添加"性能面板"切换按钮
const [perfVisible, setPerfVisible] = useState(false)
const collectorRef = useRef(new PerfCollector())

useEffect(() => {
  collectorRef.current.start()
  return () => collectorRef.current.stop()
}, [])
```

**验收标准**
- [ ] FPS 指标误差 < 2fps（与 Chrome DevTools 对比）
- [ ] 渲染时间通过 performance.mark/measure 采集，非估算
- [ ] R-Tree 命中时间可见（1000 标注框场景 < 1ms）
- [ ] 面板本身对被测场景无明显影响（< 0.5ms 开销）
- [ ] 右上角按钮可切换显示/隐藏

---

## 5. 虚拟页面池（VirtualPagePool）— 基础实现

### 5.1 实现目标（基础版）

- 支持最大 5 个 canvas 同时渲染（maxPoolSize=5）
- IntersectionObserver 触发加载/卸载
- LRU 淘汰：`canvas.width = 0` 释放 GPU 纹理 + `URL.revokeObjectURL`
- IndexedDB 二级缓存（idb-keyval）
- 提供 poolSize/poolMax 给 PerfCollector

### 5.2 状态机

```
UNLOADED ─→ LOADING ─→ RENDERED ─→ EVICTED ─→ UNLOADED
              ↑                        ↑
      IntersectionObserver         LRU 淘汰
```

### 5.3 核心接口

```typescript
// src/pipeline/VirtualPagePool.ts

interface PoolPageState {
  pageNum: number
  status: 'unloaded' | 'loading' | 'rendered' | 'evicted'
  canvas: HTMLCanvasElement | null
  blobUrl: string | null
  naturalWidth: number
  naturalHeight: number
  lastAccessTime: number
}

interface VirtualPagePoolConfig {
  maxPoolSize?: number      // default: 5
  preloadBuffer?: number    // default: 2（视口外预加载页数）
  onStateChange?: (pageNum: number, state: PoolPageState) => void
  onPoolSizeChange?: (size: number, max: number) => void
}

class VirtualPagePool {
  constructor(config?: VirtualPagePoolConfig)

  // 初始化：告知总页数和每页尺寸
  init(pages: Array<{ pageNum: number; naturalWidth: number; naturalHeight: number; imageUrl: string }>): void

  // 注册页面容器 DOM（IntersectionObserver 观察）
  observePage(pageNum: number, containerEl: HTMLElement): void
  unobservePage(pageNum: number): void

  // 手动预加载（如文档刚加载时预载前 2 页）
  preload(pageNum: number): Promise<void>

  // 获取页面 canvas（如果未渲染返回 null）
  getCanvas(pageNum: number): HTMLCanvasElement | null

  // 获取当前 pool 状态（给 PerfPanel）
  getPoolStatus(): { size: number; max: number; pages: PoolPageState[] }

  destroy(): void
}
```

### 5.4 LRU 淘汰实现

```typescript
private evictLRU(): void {
  const rendered = [...this.pool.values()]
    .filter(p => p.status === 'rendered')
    .sort((a, b) => a.lastAccessTime - b.lastAccessTime)

  const target = rendered[0]
  if (!target) return

  if (target.canvas) {
    target.canvas.width = 0  // 显式释放 GPU 纹理
    target.canvas = null
  }
  if (target.blobUrl) {
    URL.revokeObjectURL(target.blobUrl)
    target.blobUrl = null
  }
  target.status = 'evicted'
  this.config.onStateChange?.(target.pageNum, target)
}
```

### 5.5 验收标准

- [ ] 5 页文档，pool 中 canvas 数量始终 ≤ maxPoolSize
- [ ] 快速滚动，无 OOM，无白屏 > 300ms
- [ ] canvas.width=0 后，chrome://task-manager 内存下降可见
- [ ] IndexedDB 缓存命中率：重复访问同一页 100%
- [ ] PerfPanel 显示 pool 占用比

---

## 6. 文件结构（目标）

```
src/
├── core/
│   ├── types.ts              ✅
│   ├── EventBus.ts           ✅
│   └── AnnotationStore.ts    ✅
├── adapters/
│   └── ImageCoordAdapter.ts  ✅
├── layers/
│   ├── TextOverlayLayer.ts   ✅（需接入 OCRGeneralView）
│   └── SVGLayer.ts           ✅
├── pipeline/
│   ├── PageDataAPI.ts        ✅
│   ├── VirtualPagePool.ts    ❌ 新增
│   └── ConfidenceHeatmap.worker.ts  ❌ 新增
├── perf/
│   ├── PerfCollector.ts      ❌ 新增
│   └── PerfPanel.tsx         ❌ 新增
├── scenes/
│   ├── inspection/           ⚠️ 需加流式动画 + 修 @ts-ignore
│   ├── ocr-general/          ⚠️ 需接入三层架构
│   ├── ocr-custom/           ✅
│   ├── translation/          ⚠️ 需接入 VirtualPagePool
│   └── streaming/            ⚠️ 需加 SSE 面板 + 动画
└── __tests__/
    ├── PerfCollector.test.ts  ❌ 新增
    ├── VirtualPagePool.test.ts ❌ 新增
    ├── HeatmapWorker.test.ts  ❌ 新增
    ├── BracketDepth.test.ts  ✅
    ├── StreamingParser.test.ts ✅
    ├── RaceCondition.test.ts ✅
    ├── TextOverlayLayer.test.ts ✅
    ├── CoordTransform.test.ts ✅
    └── PageDataAPI.test.ts   ✅
```

---

## 7. 技术栈

| 层 | 技术选型 | 理由 |
|----|---------|------|
| 框架 | React 18 + TypeScript | 不变 |
| 文本编辑 | ProseMirror | 不变 |
| 空间索引 | rbush | 不变 |
| 测试 | Vitest + @testing-library/react | 不变 |
| 样式 | inline style | 不变 |
| Worker | 原生 Web Worker API | 置信度热力图 |
| 缓存 | idb-keyval | IndexedDB 轻量封装 |

---

## 8. 面试演示脚本（15 分钟）

```
0:00 - 2:00  架构图（3层：Scene → Pipeline → Core），打开 PerfPanel
2:00 - 4:30  Scene 5 Streaming Markdown：观察 SSE token 流 → 增量渲染
4:30 - 6:00  Scene 5 Generative UI：JSON depth → 组件实例化入场动画
6:00 - 7:30  Scene 5 Race Condition：跑竞态，读 EVENT LOG
7:30 - 9:00  Scene 1 Inspection：ProseMirror 波浪线，AI 分析动画，双向联动
9:00 -11:00  Scene 2 OCR：三档切换，置信度红框，热力图 Web Worker
11:00-13:00  Scene 4 Translation：文档模式，滚动，PerfPanel 看 pool 占用
13:00-15:00  Q&A：讲坐标系设计 or BracketDepthTracker 算法细节
```
