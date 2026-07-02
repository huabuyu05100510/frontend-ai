# 多模态 AI 渲染引擎 — 时序图

> 使用 Mermaid 语法，可在 GitHub / VSCode / Obsidian 等工具渲染

---

## 时序图索引

1. [翻译双栏 — 文档加载与渲染](#1-翻译双栏--文档加载与渲染)
2. [翻译双栏 — 滚动同步与段落联动](#2-翻译双栏--滚动同步与段落联动)
3. [智检 — 纯文本场景](#3-智检--纯文本场景)
4. [智检 — 文档场景](#4-智检--文档场景)
5. [OCR 通用 — 图片识别与双向联动](#5-ocr-通用--图片识别与双向联动)
6. [OCR 自定义 — 创建字段模板](#6-ocr-自定义--创建字段模板)
7. [OCR 自定义 — 编辑与删除字段](#7-ocr-自定义--编辑与删除字段)

---

## 1. 翻译双栏 — 文档加载与渲染

```mermaid
sequenceDiagram
    actor U as 用户
    participant UI as DualColumnLayout
    participant FP as FileParser
    participant W as PDFWorker<br/>(pdfium-wasm)
    participant TL as TextLayer
    participant API as TranslationAPI
    participant PM as ParagraphMapper
    participant AS as AnnotationStore
    participant SVG as SVGLayer

    U->>UI: 上传文档（PDF/DOCX）
    UI->>FP: parse(file)
    FP-->>UI: ArrayBuffer

    UI->>W: renderPages(buffer) [Worker 线程]
    Note over W: pdfium-wasm 逐页渲染<br/>优先首页，其余 IdleCallback
    W-->>UI: page1: ImageBitmap + TextItems[]
    UI->>UI: drawToCanvas(left, page1)
    UI->>TL: buildTextLayer(TextItems, scale)
    TL-->>UI: 透明文字层挂载（左栏）

    UI->>API: translate(paragraphs, srcLang, tgtLang)
    Note over API: 并行请求，不阻塞渲染
    API-->>UI: TranslationResult[]<br/>{srcParagraphId, tgtText, confidence}

    UI->>W: renderTranslatedPages(tgtContent) [右栏]
    W-->>UI: page1: ImageBitmap + TextItems[]
    UI->>UI: drawToCanvas(right, page1)
    UI->>TL: buildTextLayer(TextItems, scale)
    TL-->>UI: 透明文字层挂载（右栏）

    UI->>PM: buildAlignMap(srcParagraphs, tgtParagraphs)
    PM-->>UI: ParagraphMapping[]
    UI->>AS: loadAnnotations(translationAnnotations)
    AS->>SVG: 初始化段落高亮层（默认不可见）

    Note over UI: 双栏就绪，等待用户交互

    W-->>UI: page2~N: ImageBitmap（后台继续渲染）
    UI->>UI: 追加 Canvas 页面（虚拟池管理）
```

---

## 2. 翻译双栏 — 滚动同步与段落联动

```mermaid
sequenceDiagram
    actor U as 用户
    participant LP as LeftPane
    participant SS as ScrollSyncBridge
    participant RP as RightPane
    participant EB as EventBus
    participant SVG as SVGLayer（双侧）
    participant AP as 结果面板（可选）

    Note over LP,RP: 正常滚动同步
    U->>LP: 滚动左栏
    LP->>SS: onScroll('left', scrollTop)
    SS->>SS: findTopVisibleParagraph(scrollTop)
    SS->>SS: lookupAlignMap(paragraphId)
    SS->>RP: scrollTo(targetY, 'instant')
    Note over SS: 锁定标志防止循环触发<br/>rAF 后解锁

    Note over LP,RP: 段落 hover 联动
    U->>LP: hover 某段落区域
    LP->>EB: emit(ANNOTATION_HOVER, paragraphId)
    EB->>SVG: setHighlight(paragraphId, true, 'hover') [左侧]
    EB->>SVG: setHighlight(mappedId, true, 'hover')    [右侧]
    EB->>AP: highlightItem(paragraphId)

    U->>LP: 移开 hover
    LP->>EB: emit(ANNOTATION_HOVER, null)
    EB->>SVG: clearAllHighlights()
    EB->>AP: clearHighlight()

    Note over LP,RP: 文字选中与复制
    U->>LP: 鼠标选中左栏文字
    Note over LP: selectionchange 事件触发
    LP->>LP: textLayer.style.opacity = '0.0001'
    Note over LP: 选区蓝色高亮可见<br/>Canvas 视觉不被遮挡
    U->>U: Ctrl+C 复制
    LP->>LP: 复制完成，opacity 归 0
```

---

## 3. 智检 — 纯文本场景

```mermaid
sequenceDiagram
    actor U as 用户
    participant ED as ProseMirrorEditor
    participant DP as DecorationPlugin
    participant API as InspectionAPI
    participant AS as AnnotationStore
    participant EP as ErrorPanel
    participant EB as EventBus
    participant TT as Tooltip

    U->>ED: 输入 / 粘贴文本
    ED->>API: inspect(text) [防抖 500ms]
    API-->>AS: ErrorAnnotation[]<br/>{type, from, to, suggestion}

    AS->>DP: setAnnotations(annotations)
    DP->>ED: 生成 DecorationSet<br/>（CSS wavy underline，按类型分色）
    ED->>EP: 渲染错误面板<br/>（分类统计 + 错误卡片列表）

    Note over ED: 正常交互

    U->>ED: hover 波浪线文字
    ED->>EB: emit(ANNOTATION_HOVER, errorId)
    EB->>TT: show(errorId, position)<br/>显示：错误类型 + 原文 + 建议词
    EB->>EP: scrollToItem(errorId) + highlight

    U->>TT: click [接受建议]
    TT->>ED: applyTransaction(from, to, suggestion)
    ED->>AS: setStatus(errorId, 'accepted')
    AS->>DP: removeDecoration(errorId)
    AS->>EP: removeItem(errorId)，计数 -1
    TT->>TT: close()

    U->>TT: click [忽略]
    TT->>AS: setStatus(errorId, 'ignored')
    AS->>DP: setDecorationStyle(errorId, 'muted')
    EP->>EP: 该卡片变灰，不移除

    Note over EP: 面板操作
    U->>EP: click 错误卡片
    EP->>EB: emit(SCROLL_TO, errorId)
    EB->>ED: scrollIntoView(from)
    EB->>ED: 激活波浪线高亮（active 状态加深）

    U->>ED: 按 F8
    ED->>AS: getNextError(currentOffset)
    AS-->>ED: nextErrorId
    EB->>ED: emit(SCROLL_TO, nextErrorId)

    Note over ED: 用户手动编辑文字
    U->>ED: 手动修改文本
    ED->>DP: transaction → remap offsets
    Note over DP: ProseMirror 自动 remap<br/>decoration 位置，无需手动维护
```

---

## 4. 智检 — 文档场景

```mermaid
sequenceDiagram
    actor U as 用户
    participant UI as InspectionDocument
    participant W as PDFWorker
    participant CA as DocumentCoordAdapter
    participant HT as HitTestEngine(R-Tree)
    participant API as InspectionAPI
    participant AS as AnnotationStore
    participant SVG as SVGLayer
    participant EP as ErrorPanel
    participant EB as EventBus
    participant TT as Tooltip

    U->>UI: 上传文档
    UI->>W: renderPages(buffer)
    W-->>UI: Canvas pages rendered（含 TextItems 坐标）

    UI->>API: inspect(documentContent)
    API-->>AS: ErrorAnnotation[]<br/>{type, page, bbox, suggestion}

    AS->>CA: registerAnnotations(annotations)
    CA->>HT: rtree.load(annotations)

    loop 每条错误标注
        AS->>CA: toScreenRects(PagePosition)
        CA-->>SVG: DOMRect[]（跨行返回多段）
        SVG->>SVG: 每段 DOMRect 在底部 +2px<br/>绘制 wavyPath（分色）
    end

    AS->>EP: 渲染错误面板（同文本场景）

    Note over UI: 用户交互

    U->>UI: mousemove
    UI->>HT: hitTest(clientPt)
    HT-->>UI: annotationId | null
    UI->>EB: emit(ANNOTATION_HOVER, id)
    EB->>SVG: setHighlight(id, true, 'hover')
    EB->>TT: show(id, mousePos)
    EB->>EP: scrollToItem(id) + highlight

    U->>UI: mouseout
    EB->>SVG: setHighlight(prevId, false)
    EB->>TT: hide()
    EB->>EP: clearHighlight()

    U->>EP: click 错误卡片
    EP->>EB: emit(SCROLL_TO, annotationId)
    EB->>UI: scrollToPage(annotation.page)
    EB->>SVG: setHighlight(id, true, 'selected')

    Note over UI: 文档缩放时重建坐标
    U->>UI: 缩放文档
    UI->>CA: invalidate()
    CA->>CA: 重算所有 PagePosition → DOMRect
    CA->>SVG: 重绘所有 wavyPath 位置
    CA->>HT: rtree.rebuild(newRects)
```

---

## 5. OCR 通用 — 图片识别与双向联动

```mermaid
sequenceDiagram
    actor U as 用户
    participant UI as OCRGeneralView
    participant IM as ImageRenderer
    participant CA as ImageCoordAdapter
    participant HT as HitTestEngine(R-Tree)
    participant API as OCRApi
    participant AS as AnnotationStore
    participant SVG as SVGLayer
    participant TP as TextResultPanel
    participant EB as EventBus
    participant CL as Clipboard

    U->>UI: 上传图片
    UI->>IM: render(imageFile)
    IM-->>UI: <img> 就绪，naturalWidth/Height 可读

    UI->>API: recognize(imageFile)
    Note over API: 调用 OCR 服务<br/>返回文字块 + 坐标
    API-->>AS: OCRRegion[]<br/>{id, text, bbox(归一化/像素), confidence}

    AS->>CA: registerRegions(regions)
    CA->>CA: 构建坐标缩放比<br/>scale = display.w / natural.w
    CA->>HT: rtree.load(scaledBBoxes)

    loop 每个识别区域
        AS->>SVG: addAnnotationBox(id, screenRect, style)
        SVG->>SVG: 绘制矩形框 + 序号标签❶❷❸
    end

    AS->>TP: renderItems(regions)
    Note over TP: 按识别顺序展示文字块<br/>每块显示：序号 + 文字内容 + 置信度

    Note over UI: 双向 hover 联动

    U->>UI: hover 图片识别框
    UI->>HT: hitTest(pt)
    HT-->>UI: regionId
    UI->>EB: emit(ANNOTATION_HOVER, regionId)
    EB->>SVG: setHighlight(regionId, true, 'hover')
    EB->>TP: scrollToItem(regionId) + highlight

    U->>TP: hover 文字结果条目
    TP->>EB: emit(ANNOTATION_HOVER, regionId)
    EB->>SVG: setHighlight(regionId, true, 'hover')
    Note over EB: 图片侧对应框高亮加深

    U->>UI: hover 离开
    EB->>SVG: clearAllHighlights()
    EB->>TP: clearHighlight()

    Note over UI: 复制操作

    U->>TP: click [复制全文]
    TP->>TP: 按 order 拼接所有 region.text
    TP->>CL: navigator.clipboard.writeText(fullText)
    TP-->>U: Toast 提示"已复制"

    U->>TP: click 单条复制图标
    TP->>CL: navigator.clipboard.writeText(region.text)

    Note over UI: 图片缩放/resize 时重建
    U->>UI: 调整预览区宽度
    UI->>CA: invalidate()
    CA->>CA: 重算 scale
    CA->>SVG: 重绘所有矩形框位置
    CA->>HT: rtree.rebuild()
```

---

## 6. OCR 自定义 — 创建字段模板

```mermaid
sequenceDiagram
    actor U as 用户
    participant TB as Toolbar
    participant IM as ImageRenderer
    participant DT as DrawTool
    participant SVG as SVGLayer
    participant CP as ConfigPanel
    participant AS as AnnotationStore
    participant TM as TemplateManager
    participant EB as EventBus

    U->>IM: 上传样本图片
    IM-->>U: 图片渲染显示

    U->>TB: click [画框 +]
    TB->>DT: activate()
    DT->>IM: container.style.cursor = 'crosshair'

    U->>IM: mousedown(pt)
    DT->>DT: startPt = pt
    DT->>SVG: createPreviewRect(pt)（虚线蓝框）

    loop 拖拽中
        U->>IM: mousemove(pt)
        DT->>SVG: updatePreviewRect(startPt, pt)
    end

    U->>IM: mouseup(pt)
    DT->>DT: rect = normalizeRect(startPt, pt)
    alt 面积 < 400px²（误操作）
        DT->>SVG: removePreviewRect()
        DT->>DT: 重置，继续等待
    else 面积合法
        DT->>SVG: solidifyRect(rect)（虚线→实线，暂灰色）
        DT->>EB: emit(FIELD_CONFIG_OPEN, tempId, rect)
        EB->>CP: open(tempId, rect)
    end

    CP-->>U: 显示字段配置面板（右侧）
    U->>CP: 填写字段名、选择类型、勾选必填
    U->>CP: click [保存字段]

    CP->>CP: validate()
    alt 校验失败（字段名为空）
        CP-->>U: 显示错误提示
    else 校验通过
        CP->>EB: emit(FIELD_SAVED, FieldConfig)
        EB->>AS: addAnnotation(ocr-field, rect, config)
        AS->>SVG: setBoxStyle(id, activeStyle)
        AS->>SVG: addTextLabel(id, rect, config.label)
        SVG-->>U: 框内显示字段名标签，蓝色边框
        EB->>TM: addField(FieldConfig)
        CP->>CP: close()
        DT->>DT: reset()，等待下次画框
    end

    alt 用户 ESC 或 click [取消]
        CP->>SVG: removePreviewRect(tempId)
        CP->>CP: close()
        DT->>DT: reset()
    end

    Note over U,TM: 所有字段定义完毕
    U->>TB: click [保存模板]
    TB->>TM: saveTemplate({ name, fields })
    TM-->>U: Toast "模板已保存"
```

---

## 7. OCR 自定义 — 编辑与删除字段

```mermaid
sequenceDiagram
    actor U as 用户
    participant IM as ImageRenderer
    participant HT as HitTestEngine(R-Tree)
    participant SVG as SVGLayer
    participant RT as ResizeTool
    participant CP as ConfigPanel
    participant AS as AnnotationStore
    participant TM as TemplateManager
    participant EB as EventBus

    Note over U,TM: 选中已有字段框

    U->>IM: click 已有标注框
    IM->>HT: hitTest(pt)
    HT-->>IM: fieldId
    IM->>SVG: showResizeHandles(fieldId)
    Note over SVG: 显示 8 个控制点（蓝色圆点）
    IM->>CP: open(fieldId, currentConfig)

    Note over U,TM: 拖拽 resize 控制点

    U->>SVG: mousedown(handleIndex)
    RT->>RT: recordOriginalRect(fieldId)

    loop 拖拽中
        U->>SVG: mousemove(delta)
        RT->>RT: calcNewRect(originalRect, handleIndex, delta)
        RT->>RT: clamp(minSize: 20x20)
        RT->>SVG: updateRect(newRect)（实时预览）
    end

    U->>SVG: mouseup
    RT->>AS: updateAnnotation(fieldId, { bbox: newRect })
    AS->>TM: updateField(fieldId, { bbox: newRect })
    AS->>SVG: repositionLabel(fieldId, newRect)

    Note over U,TM: 拖拽移动整个框

    U->>SVG: mousedown(框体内部)
    RT->>RT: recordOffset(pt, fieldRect)

    loop 移动中
        U->>SVG: mousemove(pt)
        RT->>SVG: moveRect(pt - offset)
    end

    U->>SVG: mouseup
    RT->>AS: updateAnnotation(fieldId, { bbox: newPos })
    AS->>TM: updateField(fieldId, { bbox: newPos })

    Note over U,TM: 修改字段配置

    U->>CP: 修改字段名 / 类型 / 必填
    U->>CP: click [保存字段]
    CP->>AS: updateAnnotation(fieldId, newConfig)
    AS->>SVG: updateTextLabel(fieldId, newConfig.label)
    AS->>TM: updateField(fieldId, newConfig)
    CP-->>U: Toast "已更新"

    Note over U,TM: 删除字段

    U->>CP: click [删除字段]
    CP-->>U: 确认弹窗 "确认删除字段「发票号码」？"
    U->>CP: 确认

    CP->>EB: emit(FIELD_DELETED, fieldId)
    EB->>AS: removeAnnotation(fieldId)
    AS->>SVG: remove(fieldId)
    AS->>TM: removeField(fieldId)
    CP->>CP: close()

    Note over U,TM: 点击空白处取消选中

    U->>IM: click 空白区域
    IM->>HT: hitTest(pt) → null
    SVG->>SVG: hideResizeHandles()
    CP->>CP: close()
```

---

## 附：Actor 说明

| Actor | 说明 |
|-------|------|
| DualColumnLayout | 翻译双栏主容器组件 |
| PDFWorker | pdfium-wasm 运行在 Web Worker 中的渲染器 |
| TextLayer | 透明 DOM 文字层，用于原生文本选择与复制 |
| ScrollSyncBridge | 双栏滚动同步控制器 |
| ParagraphMapper | 原文/译文段落对齐映射构建器 |
| InspectionDocument | 文档智检主视图 |
| DocumentCoordAdapter | 文档场景坐标适配器（页面坐标→屏幕坐标）|
| ImageCoordAdapter | 图片场景坐标适配器（像素坐标→屏幕坐标）|
| HitTestEngine | 基于 R-Tree 的空间索引命中检测引擎 |
| SVGLayer | SVG 标注层工厂（波浪线、矩形框、标签）|
| AnnotationStore | 全局标注数据状态管理 |
| StateMachine | 交互状态机（idle/hover/selected/drawing）|
| EventBus | 跨组件事件总线（双向联动核心）|
| DrawTool | OCR 自定义矩形画框工具 |
| ResizeTool | 矩形控制点缩放/移动工具 |
| ConfigPanel | 字段属性配置面板 |
| TemplateManager | OCR 模板 CRUD 管理器 |
| ErrorPanel | 智检错误列表面板 |
| TextResultPanel | OCR 通用识别文字结果面板 |
| DecorationPlugin | ProseMirror 标注渲染插件 |
