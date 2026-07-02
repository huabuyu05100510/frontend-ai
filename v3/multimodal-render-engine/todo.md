# 多模态 AI 渲染引擎 — TDD 任务清单 v3.0

> 规则：每个功能先写测试（RED），再写实现（GREEN），再重构（REFACTOR）
> 格式：`[ ]` 未开始 `[x]` 完成 `[-]` 进行中

---

## Phase 0：代码质量修复

### 0.1 @ts-ignore 修复
- [ ] RED: 确认现有 Inspection 场景所有测试通过（基准）
- [ ] GREEN: 移除 `InspectionText.tsx:318` 的 `@ts-ignore`，改用 `TextSelection.near()`
- [ ] GREEN: import `TextSelection` from `prosemirror-state`
- [ ] VERIFY: 运行 demo，F8 / Shift+F8 导航仍正常

### 0.2 OCR BlockType 映射
- [ ] RED: 新建 `src/__tests__/OcrBlockMapping.test.ts`
- [ ] RED: 测试 `roleToBlockType('title')` → `'heading'`
- [ ] RED: 测试 `roleToBlockType('subtitle')` → `'heading'`
- [ ] RED: 测试 `roleToBlockType('field')` → `'cell'`
- [ ] RED: 测试 `roleToBlockType('body')` → `'paragraph'`
- [ ] RED: 测试 `roleToBlockType('separator')` → `'separator'`
- [ ] RED: 测试 `ocrBlocksToTextBlocks` 输出 TextBlock，confidence 字段保留
- [ ] RED: 测试 `ocrBlocksToTextBlocks` field role 的 label 字段保留
- [ ] GREEN: 新建 `src/scenes/ocr-general/blockTypeMapping.ts`，实现映射函数
- [ ] VERIFY: 所有 OcrBlockMapping 测试通过

---

## Phase 1：PerfCollector + PerfPanel

### 1.1 PerfCollector 单元测试
- [ ] RED: 新建 `src/__tests__/PerfCollector.test.ts`
- [ ] RED: 测试初始 `getSnapshot()` 返回全为 0 的 PerfSnapshot
- [ ] RED: 测试 `recordRender(3.5)` 后 `snapshot.renderTime === 3.5`
- [ ] RED: 测试 `recordHitTest(0.4)` 后 `snapshot.hitTestTime === 0.4`
- [ ] RED: 测试 `setAnnotationCount(127)` 后 `snapshot.annotationCount === 127`
- [ ] RED: 测试 `setPoolStatus(3, 5)` 后 `snapshot.poolSize === 3, poolMax === 5`
- [ ] RED: 测试 `subscribe(fn)` → `recordRender()` 后 fn 被调用
- [ ] RED: 测试 `subscribe` 返回 unsubscribe 函数，调用后不再接收通知

### 1.2 PerfCollector 实现
- [ ] GREEN: 新建 `src/perf/PerfCollector.ts`
- [ ] GREEN: 实现 `PerfSnapshot` 接口
- [ ] GREEN: 实现 `start()` 启动 rAF FPS 循环（1s 滑动窗口）
- [ ] GREEN: 实现 `stop()` 取消 rAF
- [ ] GREEN: 实现 `recordRender(ms)` / `recordHitTest(ms)`
- [ ] GREEN: 实现 `setAnnotationCount(n)` / `setPoolStatus(size, max)`
- [ ] GREEN: 实现 `subscribe(fn)` / `getSnapshot()`
- [ ] GREEN: 500ms 批量通知订阅者（防高频 re-render）
- [ ] VERIFY: 所有 PerfCollector 测试通过

### 1.3 PerfPanel 组件
- [ ] GREEN: 新建 `src/perf/PerfPanel.tsx`
- [ ] GREEN: fixed 定位，右下角，z-index 9999
- [ ] GREEN: 实现 `MetricBar` 子组件（宽度比例 + 阈值颜色）
- [ ] GREEN: FPS 条（满格 60，≥50绿/30-49黄/<30红）
- [ ] GREEN: 渲染时间条（满格 16ms，≤8ms绿/8-16ms黄/>16ms红）
- [ ] GREEN: R-Tree 命中时间条（满格 1ms，≤0.5ms绿/0.5-1ms黄/>1ms红）
- [ ] GREEN: 标注数文本展示
- [ ] GREEN: 内存池展示（poolSize/poolMax 进度条）
- [ ] GREEN: `[×]` 关闭按钮，`onClose` 回调
- [ ] GREEN: collector.subscribe 驱动每 500ms 重渲染

### 1.4 App.tsx 集成
- [ ] GREEN: App.tsx 全局实例化 `PerfCollector`，`useEffect` start/stop
- [ ] GREEN: 右上角 Header 添加"性能面板"切换按钮
- [ ] GREEN: 渲染 `<PerfPanel>` 组件（visible 受 state 控制）
- [ ] VERIFY: 打开面板可看到 FPS 实时跳动

---

## Phase 2：OCR 三层架构升级

### 2.1 TextOverlayLayer 扩展
- [ ] RED: 更新 `src/__tests__/TextOverlayLayer.test.ts`，新增测试
- [ ] RED: 测试 `setTextVisible(false)` 后 text 元素 `display === 'none'`
- [ ] RED: 测试 `setTextVisible(true)` 后 text 元素可见
- [ ] GREEN: `TextOverlayLayer.ts` 新增 `setTextVisible(visible: boolean)` 方法
- [ ] VERIFY: TextOverlayLayer 全量测试通过

### 2.2 OCRGeneralView 三层改造
- [ ] GREEN: 移除 OCRGeneralView 中原有蓝色 `<rect>` SVG 渲染逻辑
- [ ] GREEN: 新增 `svgRef` + `useEffect` 初始化 `TextOverlayLayer` 实例
- [ ] GREEN: 调用 `ocrBlocksToTextBlocks()` 转换数据，传入 `TextOverlayLayer.render()`
- [ ] GREEN: 新增 `DisplayMode` state，默认 `'text'`
- [ ] GREEN: 新增三档工具栏（框/文字/热力图），切换 displayMode
- [ ] GREEN: `box` 模式调用 `layer.setTextVisible(false)`
- [ ] GREEN: `text` 模式调用 `layer.setTextVisible(true)`
- [ ] GREEN: `heatmap` 模式显示 heatmap canvas，SVG 透明度降低
- [ ] GREEN: hover 联动：图上 hover → `layer.setActiveId(id)` + TextResultPanel 高亮
- [ ] VERIFY: 三档切换流畅，文字模式 heading 紫色加粗，field 有 label badge

### 2.3 ConfidenceHeatmap Worker
- [ ] RED: 新建 `src/__tests__/HeatmapWorker.test.ts`
- [ ] RED: 测试 `calcHeatmapAlpha(1.0)` → 接近 0（透明）
- [ ] RED: 测试 `calcHeatmapAlpha(0.0)` → 接近 0.75
- [ ] RED: 测试 `calcHeatmapAlpha(0.85)` → 约 0.11
- [ ] GREEN: 新建 `src/pipeline/ConfidenceHeatmap.worker.ts`
- [ ] GREEN: 导出 `calcHeatmapAlpha(confidence)` 纯函数（便于测试）
- [ ] GREEN: Worker `onmessage`：OffscreenCanvas 渲染各 bbox
- [ ] GREEN: postMessage 返回 `{ type: 'DONE', bitmap: ImageBitmap }`
- [ ] GREEN: OCRGeneralView `useEffect` 初始化 Worker，`onmessage` 绘制 bitmap
- [ ] GREEN: 切换到 heatmap 模式时 postMessage 发送渲染请求
- [ ] GREEN: 组件卸载时 `worker.terminate()`
- [ ] VERIFY: 热力图可见，高置信度区域透明，低置信度区域红色

---

## Phase 3：Streaming 改进

### 3A Streaming Markdown SSE Token 流面板
- [ ] GREEN: `StreamingMarkdownDemo` 改为双栏布局
- [ ] GREEN: 新增 `chunkLog: TokenChunk[]` state，每次 `tick` 追加当前 chunk
- [ ] GREEN: 左栏渲染 token 流，当前 chunk 高亮（`#f38ba8` 背景）
- [ ] GREEN: 左栏自动滚动到底部
- [ ] GREEN: 新增"⏹ 中断"按钮，调用 abort() + clearTimeout + setRunning(false)
- [ ] VERIFY: 双栏同步显示，中断后左栏停止，右栏保留已渲染内容

### 3B Inspection 流式标注动画
- [ ] GREEN: `InspectionText.tsx` 新增 `thinking` state
- [ ] GREEN: 标题区新增 `ThinkingDots` 组件（3 跳动圆点 CSS 动画）
- [ ] GREEN: `runInspection` 改为异步函数，先 `setThinking(true)` + delay(1500)
- [ ] GREEN: 循环逐条调用 `storeRef.current.add(annotation)` + delay(80)
- [ ] GREEN: `DecorationPlugin.ts` 新增 `data-id` span 的 fadeIn CSS 动画
- [ ] VERIFY: 页面加载后先显示"AI 分析中..."，1.5s 后波浪线逐条淡入

### 3C Generative UI 入场动画
- [ ] GREEN: 在 `GenerativeUIDemo` 中 `DynamicComponent` 外加 `key={result.name}` + 动画 div
- [ ] GREEN: 添加 CSS `@keyframes genui-enter`（scale 0.9→1 + opacity 0→1 + translateY 8→0）
- [ ] GREEN: depth 计数器添加 `transition: color 0.15s`
- [ ] GREEN: depth=0 时计数器颜色从蓝变绿 + "✓ 完成"标记
- [ ] VERIFY: 三种组件类型均有入场动画

---

## Phase 4：VirtualPagePool

### 4.1 VirtualPagePool 单元测试
- [ ] RED: 新建 `src/__tests__/VirtualPagePool.test.ts`
- [ ] RED: 测试 `init()` 后所有页状态为 `'unloaded'`
- [ ] RED: 测试 `preload(1)` 后第 1 页状态为 `'rendered'`，canvas 不为 null
- [ ] RED: 测试 `preload(1)` 更新 `lastAccessTime`
- [ ] RED: 测试加载 6 页（maxPoolSize=5）时自动淘汰最旧一页
- [ ] RED: 测试 LRU：先访问 p1，后访问 p2，再触发淘汰 → p1 被淘汰
- [ ] RED: 测试淘汰后目标页 `canvas.width === 0`
- [ ] RED: 测试 `getCanvas(evictedPage)` 返回 null
- [ ] RED: 测试 `onPoolSizeChange` 在 load 和 evict 时分别触发

### 4.2 VirtualPagePool 实现
- [ ] GREEN: 新建 `src/pipeline/VirtualPagePool.ts`
- [ ] GREEN: 实现 `PoolPageState` 接口和状态机
- [ ] GREEN: 实现 `init(pages)` 初始化 pool Map
- [ ] GREEN: 实现 `preload(pageNum)` 加载页面（mock：创建 canvas + drawPage）
- [ ] GREEN: 实现 `evictLRU()`：canvas.width=0 + revokeObjectURL
- [ ] GREEN: 实现 `getCanvas(pageNum)` 访问并更新 lastAccessTime
- [ ] GREEN: 实现 `getPoolStatus()` 返回 size/max/pages
- [ ] GREEN: 实现 `observePage(pageNum, el)` 接 IntersectionObserver
- [ ] GREEN: 实现 `destroy()` 清理所有资源
- [ ] VERIFY: 所有 VirtualPagePool 测试通过

### 4.3 翻译 Tab 文档模式
- [ ] GREEN: `DualColumnLayout.tsx` 新增 `DocMode/TextMode` 切换按钮
- [ ] GREEN: 文档模式：实例化 VirtualPagePool，加载 PageDataAPI mock 数据
- [ ] GREEN: 渲染每页 canvas（从 pool.getCanvas()）+ 高度占位
- [ ] GREEN: `onPoolSizeChange` → `perfCollector.setPoolStatus()`
- [ ] VERIFY: 切换到文档模式，可见 canvas 页面，PerfPanel pool 数字更新

---

## Phase 5：集成验收

- [ ] `npm test` 全量通过，无回归
- [ ] Scene 1 Inspection：@ts-ignore 已移除，流式动画正常
- [ ] Scene 2 OCR：三档工具栏，文字模式有差异化渲染，热力图可见
- [ ] Scene 4 Translation：文档模式可用，PerfPanel pool 实时
- [ ] Scene 5 Streaming：SSE token 流面板，中断按钮，GenUI 入场动画
- [ ] PerfPanel：所有 5 个指标实时显示，阈值颜色正确
- [ ] Demo 脚本：15 分钟完整演练一遍，无卡顿

---

## 已完成（勿改动）

- [x] types.ts
- [x] EventBus.ts
- [x] AnnotationStore.ts
- [x] ImageCoordAdapter.ts（R-Tree）
- [x] TextOverlayLayer.ts（基础版）
- [x] PageDataAPI.ts（mock）
- [x] BracketDepthTracker.ts + 测试
- [x] useAbortableStream.ts + 测试
- [x] StreamingParser.ts + 测试
- [x] StreamingScene（RaceCondition + GenerativeUI 逻辑）
- [x] InspectionText（ProseMirror 基础版）
- [x] TemplateEditor（OCR 自定义）
- [x] DualColumnLayout（文本模式）
