# 多模态 AI 渲染引擎 — 技术设计

面向翻译双栏对比、智检标注、OCR 通用识别、OCR 自定义模板四个场景的前端渲染引擎完整设计方案。

## 文件说明

| 文件 | 内容 |
|------|------|
| `multimodal-render-design.md` | 完整技术设计方案（架构/数据模型/接口/性能/排期）|
| `multimodal-render-sequence.md` | 7 条 Mermaid 时序图（所有核心交互流程）|
| `sdd-prompts.md` | 9 条 SDD 代码生成提示词（可直接喂给 AI 工具生成代码）|

## 技术栈

React 18 · TypeScript 5 · pdfium-wasm · ProseMirror · rbush · SVG · Canvas · Web Worker
