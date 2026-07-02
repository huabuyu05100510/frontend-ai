## Why

AI 模型输出的坐标+语义信息（翻译段落映射、错误标注位置、OCR 识别区域）需要精准叠加到原始内容上，同时保持文本可复制、交互可联动。当前缺少统一的渲染引擎，四个场景（翻译双栏对比、智检标注、OCR 通用识别、OCR 自定义模板）各自为战，坐标系统、事件机制、标注渲染逻辑重复。需要一套共用底层 + 场景独立的前端渲染引擎。

## What Changes

- 新增 **坐标变换系统**：统一三种坐标系（像素/页面/偏移量）的转换逻辑，通过 CoordAdapter 解耦
- 新增 **标注核心引擎**：EventBus 事件总线、StateMachine 交互状态机、AnnotationStore 状态管理、SVGLayer 标注渲染层
- 新增 **翻译双栏对比场景**：pdfium-wasm 文档渲染、段落对齐同步滚动、透明可复制文字层
- 新增 **智检标注场景**：文本（ProseMirror Decoration）+ 文档（Canvas+SVG）两种模式、错误面板联动
- 新增 **OCR 通用识别场景**：图片识别框双向联动、文字结果面板
- 新增 **OCR 自定义模板场景**：画框工具、控制点缩放、字段配置、模板 CRUD
- 新增 **错误处理与降级**：所有场景的 ErrorBoundary、加载状态流转、超时/部分失败处理
- 新增 **可访问性支持**：键盘导航、ARIA 标注、色彩无障碍、prefers-reduced-motion

## Capabilities

### New Capabilities

- `coordinate-transform`: 三种坐标适配器（Image/Document/Text），坐标变换管线，R-Tree 空间索引命中
- `annotation-core`: EventBus 发布订阅、StateMachine 交互状态机、AnnotationStore 标注状态管理、SVGLayer 标注渲染
- `translation-dual-column`: 双栏布局、段落对齐同步滚动、透明可复制文字层、虚拟页面池
- `inspection-annotation`: 文本/文档两种智检模式、ProseMirror 波浪线 Decoration、错误面板联动
- `ocr-general`: 图片识别框渲染、双向 hover 联动、文字结果面板、全文复制
- `ocr-custom-template`: 画框工具、控制点缩放/移动、字段配置面板、模板 CRUD、草稿自动保存
- `error-degradation`: 引擎加载失败降级、API 超时/部分失败处理、超大文档内存限制、ErrorBoundary
- `accessibility`: 键盘导航、ARIA 标注、色彩无障碍（红绿色盲）、prefers-reduced-motion

### Modified Capabilities

<!-- None - this is a new engine, no existing capabilities are modified -->

## Impact

- **Affected code**: 新增 `src/core/`、`src/adapters/`、`src/renderers/`、`src/layers/`、`src/utils/`、`src/scenes/`、`src/components/`、`src/hooks/`、`src/monitoring/` 目录
- **Dependencies**: pdfium-wasm（文档渲染）、ProseMirror（文本编辑器）、rbush（空间索引）
- **Systems**: 独立引擎，不修改现有项目代码，通过 npm 包或直接引入使用
- **Breaking changes**: 无