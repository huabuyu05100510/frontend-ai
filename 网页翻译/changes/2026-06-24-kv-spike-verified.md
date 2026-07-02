# 2026-06-24 — K/V 重构 Spike 验证通过

## 模型
Claude (Sonnet 4.5)

## 改动
- 新增 `docs/depth-strategy-v3.md`（深度策略修正：K/V 重构和 ONNX 图手术是核心不是可选）
- 归档过期 docs 到 `docs/_archive/`
- 新增 `spike/word-alignment/kv-spike.mjs`（K/V 重构验证脚本）
- 新增 `spike/word-alignment/results/kv-spike-result.json`（验证结果）

## Spike 可验证结果
1. ✅ 6 层 cross-attention K 全部提取（`present.{0..5}.encoder.key`）
2. ✅ 每层 shape [1, 8 heads, 11 src tokens, 64 head_dim]（结构正确）
3. ✅ K 非噪声，相似度矩阵显示真实语义结构：
   - `brown ↔ fox` = 0.71（语义相关）
   - `lazy ↔ dog` 邻近 = 0.74
   - 对角线 = 1.00

## 结论
**K/V 重构路径可行**。从 ONNX 缓存节点反推 cross-attention 的核心数据通路打通。

## 下一步
1. W2-W3：production 化（decoder hidden state 提取 + Q 计算）
2. W4：BPE token → char 映射
3. W5：hover 可视化
4. 真正的 attention 计算：`softmax(Q · K^T / √d)`
   - Q 来源：需要从 logits 反推 或 加 Identity 节点暴露 decoder hidden state
   - 已知方案：ONNX graph surgery（与图搜共用技术）
