# 变更记录 — 保结构流式翻译引擎方案 A

> **日期**：2026-06-22
> **模型**：GLM-5.2
> **类型**：技术方案（无代码改动）
> **作者**：Claude Code 协助

## 背景

用户反馈现有翻译方案（TreeWalker + textContent 替换）「没难度、不值得写简历」。
经对标研究（DeepL / Lilt / 沉浸式翻译），定位行业深水区为「保结构流式翻译」。
用户在两路线中选 A：在 LLM 时代重新实现 Lilt 的 span-scoring tag projection。

## 新增文件

- `docs/aligned-translation-tech-plan-V1.md` — 主技术方案

## 核心决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 算法 | span-scoring (Lilt 论文 §4.3) | 对 attention 噪声鲁棒，学术标杆 |
| LLM 对齐路径 | P1 占位符约束 + 嵌入对齐 | API 不开放 attention，需替代方案 |
| 嵌入模型 | multilingual-e5-small | 多语种、小体积、ONNX 可跑 |
| DOM 隔离 | Shadow DOM | 解决宿主 CSS 污染（沉浸式翻译未做） |
| 质量回归 | COMET + Tag Accuracy 双门槛 | 行业首家接入翻译质量 CI |

## 未决

1. e5-small 部署位置（WASM vs 后端）
2. 200 case 测试集的标注方案
3. 占位符失败 fallback 策略

## 下一步

待用户拍板未决事项后，启动 Phase 0（span-projector 纯算法 + TDD）。
