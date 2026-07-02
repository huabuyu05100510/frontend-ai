# 2026-06-24 — 本地翻译 + 词级对齐 技术方案 V1

## 模型
Claude (Sonnet 4.5)

## 改动
- 新增 `docs/local-translation-tech-plan-V1.md`
  - 模块 A：词级对齐可视化（attention 投影 → hover 高亮）
  - 模块 B：WebGPU 本地 NMT（transformers.js + 量化模型）
  - 5 阶段实施路线（MVP 5 周 + 进阶 3-4 周）
  - 风险表 + 失败判定（attention 不暴露 / 质量差 / 速度慢）
  - 简历叙事最终版

## 关键决策
1. **不替代现有云 LLM 方案**，是补充（隐私 / 学习模式）
2. **MVP 先用 opus-mt-en-zh 单向**（80MB，质量可控）
3. **transformers.js v3 主选**，Bergamot 备选
4. **失败也算交付**：技术调研 + PoC 可作简历素材

## 下一步
- PoC 验证：浏览器内能否拿到 attention 矩阵（1-2 天）
- 验证通过 → 进 Phase 1
- 验证失败 → 改 Bergamot 或中止本方案，归档为调研
