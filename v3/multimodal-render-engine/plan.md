# 多模态 AI 渲染引擎 — TDD 实施计划 v3.0

> 基于 spec.md v3.0，补全面试演示关键缺口
> 预计工时：~7 工作天

---

## 总览

| Phase | 内容 | 工时 | 优先级 |
|-------|------|------|--------|
| Phase 0 | 代码质量修复（@ts-ignore + OCR BlockType映射） | 0.5d | P0 |
| Phase 1 | PerfCollector + PerfPanel | 1.5d | P0 |
| Phase 2 | OCR 三层架构升级 + ConfidenceHeatmap Worker | 2d | P0 |
| Phase 3 | Streaming 改进（SSE面板 + Inspection动画 + GenUI动画） | 1d | P1 |
| Phase 4 | VirtualPagePool + 翻译文档模式 | 2d | P1 |
| Phase 5 | 集成测试 + Demo脚本验收 | 0.5d | P2 |

每个 Phase 遵循：**RED（写失败测试）→ GREEN（最小实现通过）→ REFACTOR（整理代码）**

---

## Phase 0：代码质量修复（0.5天）

### 0.1 修复 InspectionText @ts-ignore

**文件：** `src/scenes/inspection/InspectionText.tsx:318`

```typescript
// 移除 @ts-ignore，改用标准 API
import { TextSelection } from 'prosemirror-state'

const tr = view.state.tr
  .setSelection(TextSelection.near(view.state.doc.resolve(from)))
  .scrollIntoView()
view.dispatch(tr)
```

测试：验证现有 Inspection 场景功能不变即可（无需新增）。

### 0.2 统一 OCR role → BlockType 映射

**新文件：** `src/scenes/ocr-general/blockTypeMapping.ts`

```typescript
export function roleToBlockType(role: OcrBlock['role']): BlockType
export function ocrBlocksToTextBlocks(blocks: OcrBlock[], nW: number, nH: number): TextBlock[]
```

**测试：** `src/__tests__/OcrBlockMapping.test.ts`

---

## Phase 1：PerfCollector + PerfPanel（1.5天）

### 架构决策

- `PerfCollector`：纯 TS 类，无 React 依赖，便于单元测试
- `PerfPanel`：受控 React 组件，接受 `collector` prop
- App.tsx：全局唯一 collector 实例 + 右上角切换按钮

### RED

**文件：** `src/__tests__/PerfCollector.test.ts`

```typescript
describe('PerfCollector', () => {
  test('初始 snapshot 全为 0')
  test('recordRender 更新 renderTime')
  test('recordHitTest 更新 hitTestTime')
  test('setAnnotationCount 更新 annotationCount')
  test('setPoolStatus 更新 poolSize 和 poolMax')
  test('subscribe 在 snapshot 变化时回调')
  test('stop 后 rAF 不再触发')
})
```

### GREEN

- `src/perf/PerfCollector.ts`：rAF loop + 1s 滑动窗口 + 500ms 批量通知
- `src/perf/PerfPanel.tsx`：固定 fixed，右下角，条形图 + 阈值色

### 集成

`App.tsx` 右上角加"性能面板"按钮，全局实例化 PerfCollector。

---

## Phase 2：OCR 三层架构升级（2天）

### Day 1：TextOverlayLayer 集成 + 工具栏

**RED：** `src/__tests__/OcrBlockMapping.test.ts`

- title → heading，subtitle → heading，field → cell，body → paragraph，separator → separator
- confidence < 0.7 的 block 保留 confidence 字段
- field role 保留 label 字段

**GREEN：**

1. OCRGeneralView 移除蓝色 `<rect>` 渲染，接入 TextOverlayLayer
2. 增加 `DisplayMode` state + 三档工具栏（框/文字/热力图）
3. TextOverlayLayer 新增 `setTextVisible(boolean)` 方法

### Day 2：ConfidenceHeatmap Web Worker

**RED：** `src/__tests__/HeatmapWorker.test.ts`

```typescript
// 直接测试渲染逻辑函数（跳过 Worker 通信层）
test('置信度 1.0 → alpha 接近 0（透明）')
test('置信度 0.0 → alpha 接近 0.75（不透明红）')
test('bbox 坐标正确映射到 canvas 像素')
```

**GREEN：**

- `src/pipeline/ConfidenceHeatmap.worker.ts`：OffscreenCanvas 渲染
- OCRGeneralView 集成 Worker，热力图模式触发渲染，`DONE` 消息绘制 ImageBitmap

---

## Phase 3：Streaming 改进（1天）

### 3A：Streaming Markdown SSE Token 流面板（0.5天）

`StreamingMarkdownDemo` 由单栏改为双栏：左栏 token 流（当前 chunk 高亮），右栏渲染结果；新增"中断"按钮复用 `useAbortableStream`。

### 3B：Inspection 流式标注动画（0.3天）

`runInspection` 改为异步：thinking 动画 1.5s → 逐条 add（80ms 间隔）。

### 3C：Generative UI 入场动画（0.2天）

`DynamicComponent` 外包 `genui-enter` 动画容器，scale+fade 280ms。

---

## Phase 4：VirtualPagePool（2天）

### Day 1：核心状态机 + LRU

**RED：** `src/__tests__/VirtualPagePool.test.ts`

```typescript
test('初始化后所有页为 UNLOADED 状态')
test('preload() 后页面转为 RENDERED，canvas 不为 null')
test('超过 maxPoolSize 时自动触发 LRU 淘汰')
test('LRU 淘汰最旧访问的页面（lastAccessTime 最小）')
test('淘汰后 canvas.width === 0')
test('getCanvas() 访问已淘汰页返回 null')
test('onPoolSizeChange 在 size 变化时触发')
```

**GREEN：** `src/pipeline/VirtualPagePool.ts`，纯状态机，无 IntersectionObserver。

### Day 2：IO 集成 + 翻译 Tab 对接

- `observePage(pageNum, el)` 接 IntersectionObserver
- 翻译 Tab 新增"文档模式"切换，渲染 VirtualPagePool 管理的页面列表
- `onPoolSizeChange` 回调驱动 `PerfCollector.setPoolStatus()`

---

## Phase 5：集成测试 + Demo 演练（0.5天）

1. `npm test` 全量运行，无回归
2. 按 spec.md 演示脚本完整演练一遍
3. 验收所有 P0/P1 标准清单

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Web Worker + OffscreenCanvas 在 jsdom 不可用 | 测试渲染逻辑纯函数，跳过 Worker 通信层 |
| IndexedDB 在测试环境不可用 | VirtualPagePool 抽离 storage 接口，测试用 in-memory 实现 |
| IntersectionObserver 测试难 | 测试核心状态机，IO 部分 mock observer |
| ProseMirror TextSelection.near() API | 已验证 prosemirror-state 包含此 API |
