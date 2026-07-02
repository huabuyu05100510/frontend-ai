# 多模态 AI 渲染引擎 — 技术设计

面向翻译双栏对比、智检标注、OCR 通用识别、OCR 自定义模板四个场景的前端渲染引擎完整设计方案。

> 版本：1.1  日期：2026-06-12
> 采用 SDD（Specification-Driven Development）方法：Spec 先行，Prompt 引用 Spec，代码生成后验收

## 文件说明

| 文件 | 内容 |
|------|------|
| `multimodal-render-design.md` | 完整技术设计方案（架构/数据模型/接口/性能/排期/错误处理/可访问性/性能SLA）|
| `multimodal-render-sequence.md` | 10 条 Mermaid 时序图（核心交互 + 错误降级 + 键盘导航）|
| `sdd-prompts.md` | 12 条 SDD 代码生成提示词（含 Spec 引用 + 验收 Gate，可直接喂给 AI 工具生成代码）|

## 技术栈

React 18 · TypeScript 5 · pdfium-wasm · ProseMirror · rbush · SVG · Canvas · Web Worker · Vitest · Testing Library
