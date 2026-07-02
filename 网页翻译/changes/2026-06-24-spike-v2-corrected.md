# 2026-06-24 — Spike 修正：翻译对齐有救

## 模型
Claude (Sonnet 4.5) + Z.ai GLM-5.2（研究子代理）

## 改动
- 新增 `docs/spike-results-v2-corrected.md`
- 替代 `spike-results-attention-blocked.md` 中关于翻译词级对齐的悲观判断

## 关键修正
之前判断"翻译词级对齐阻塞"是错的。研究代理发现：

1. **Lilt §4.3 启发式**已实现（`lib/span-projector.mjs`），完全不依赖 attention
   - 当前相似度函数（字符 Jaccard）对 EN↔ZH 返回 0，是死代码
   - 替换为 embedding cosine 或编辑距离即可用，3-5 天

2. **K/V 重构 cross-attention** 可行
   - opus-mt decoder ONNX 输出含 `present.{0..5}.encoder.key/value`
   - 业界 MarianMT 词对齐论文方法
   - ~100 行 JS glue code，1-2 周
   - 不需要 Python

## 修正后的执行路径
- 翻译项目：深度恢复，5-7 周
  - 先做 Lilt §4.3 修复（3-5 天）
  - 再做 K/V 重构升级（1-2 周）
  - 加 WebGPU + hover 可视化
- 图搜项目：仍降级到基础版（4-5 周）
  - 图像区域 attention 仍阻塞（ViT 无 cross-attention）
  - 需 ONNX 图手术才能解锁

## 共享 lib 修正
共享率从 70% 降到 40%（attention-visualizer 不再跨项目复用）
