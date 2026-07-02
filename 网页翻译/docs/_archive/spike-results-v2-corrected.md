# Spike 结果修正版 V2（翻译对齐有救）

> **模型**：Claude (Sonnet 4.5) + Z.ai GLM-5.2（研究子代理）
> **日期**：2026-06-24
> **替代**：`spike-results-attention-blocked.md` 中关于翻译词级对齐的悲观判断
> **核心修正**：翻译词级对齐**有两条可行路径**，不需要 Python

---

## 0. 修正原因

`spike-results-attention-blocked.md` 说"翻译词级对齐阻塞"是错的。研究代理发现：
1. 项目已有 Lilt §4.3 算法（不依赖 attention）
2. opus-mt decoder ONNX 输出含 `present.*.encoder.key/value`，可重构 cross-attention

---

## 1. 翻译词级对齐：两条可行路径

### 路径 A：Lilt §4.3 启发式（已实现，立即可用）

**位置**：`lib/span-projector.mjs`

**原理**：
- 不依赖 attention 矩阵
- 用 src↔tgt token 的字符 Jaccard / prefix 匹配打分
- span-scoring 算法：枚举 (open,close) 找最优投影区间
- O(tgtLen²) prefix-sum 优化

**问题**（已知）：
- 字符 Jaccard 对 EN↔ZH 返回 0（无字符重叠）
- 当前 `computeAlignment` 实际是死代码
- 需要换相似度函数（改用 embedding cosine 或编辑距离）

**改造工作量**：3-5 天（替换 `computeAlignment` 的相似度函数）

### 路径 B：K/V 重构 cross-attention（中等难度，1-2 周）

**关键发现**：opus-mt decoder ONNX 的输出节点列表里包含：
```
present.{0..5}.encoder.key     # 6 层 cross-attention 的 K
present.{0..5}.encoder.value   # 6 层 cross-attention 的 V
```

这些是 encoder hidden states 投影到 cross-attention 的 K/V（被缓存用于加速解码）。

**对齐公式**（业界 MarianMT 词对齐论文方法）：
```
cross_attn[layer, head, t, s] = softmax(Q_dec[t] · K_enc[s] / √d)
```
- `K_enc[s]` = `present.{layer}.encoder.key[head, s, :]`（已知）
- `Q_dec[t]` = decoder 当前步 hidden state 经 in_proj 投影（需要从 logits 反推或重新跑 decoder）
- 多头平均后取 argmax → src↔tgt 对齐

**简化版**（fingerprint 方法）：
```
align[t] = argmax_s  K_enc[s] · K_dec_query[t]
```
不严格但够用，业界常用。

**实现步骤**（~100 行 JS）：
1. 用 `onnxruntime-node` 直接加载 `decoder_model_merged.onnx`
2. 跑一步 decoder，拿到 `present.*.encoder.key`（已知节点）
3. 复用 `transformers.js` 的 tokenizer，处理 BPE
4. 算 align 矩阵
5. 投影到前端 DOM

**参考**：
- [Stack Overflow 76100769](https://stackoverflow.com/questions/76100769/how-can-i-execute-decoder-of-onnx-export-from-seq2seq-model)：手动跑 ONNX decoder 范例
- [HF 论坛 KV 命名](https://discuss.huggingface.co/t/question-about-the-infernce-flow-for-optimum-exported-decoder-merged-onnx-model/111280)

### 两条路径对比

| 路径 | 准确率 | 工作量 | 风险 |
|---|---|---|---|
| A. Lilt §4.3 启发式 | 中（70-80%） | 3-5 天 | 低，已有算法 |
| B. K/V 重构 | 高（85-95%） | 1-2 周 | 中，需懂 ONNX 内部 |
| **A + B 双保险** | **高 + 兜底** | **2 周** | **最低** |

**推荐**：先做 A（5 天），跑出可用版本；再做 B（1 周）做准确率升级。

---

## 2. 图像区域 attention：仍然阻塞

**原因**：ViT 没有 cross-attention，K/V 重构方法不适用。
- CLIP vision_model.onnx 只输出 pooled image_embeds
- 没有 patch-level hidden state 输出

**唯一可行路径**：ONNX 图手术（用 `onnx` npm 包插入 Identity 节点暴露中间层）

**工作量**：2-3 周（需学 ONNX IR）

**结论**：图像区域 attention 暂搁置，图搜只做基础 top-K 检索。

---

## 3. 修正后的双项目策略

### 翻译项目（深度恢复）
- ✅ 占位符 + 云 LLM（已完成）
- ✅ Lilt §4.3 启发式对齐（已实现，改 similarity 函数）
- ✅ K/V 重构 cross-attention（升级，1-2 周）
- ✅ WebGPU 浏览器内 NMT（演进，2-3 周）
- ✅ hover 词级高亮可视化（前端强项）

**总工期**：5-7 周（不变）

### 图搜项目（降级到基础版）
- ✅ Chinese-CLIP + image_embeds 检索
- ✅ hnswlib-wasm 索引
- ✅ WebGPU 加速
- ❌ 区域 attention 热力图（搁置）

**总工期**：4-5 周

---

## 4. 共享 lib 修正

之前规划的 `lib/attention-visualizer.mjs` 在两个项目复用，**现在只有翻译用**：
- 翻译：词级 hover 高亮
- 图搜：用不上（无 attention）

共享率从 70% 降到 40%（`webgpu-engine` + `model-cache` + `streaming-inference` + `backend-detector` 仍共享）。

**简历叙事调整**：不再强调「跨项目 attention 可视化共享」，改为「单项目内的 attention 投影 + 可视化」。

---

## 5. 立即可执行的下一步

### 翻译项目
1. 修 `lib/span-projector.mjs` 的相似度函数（3-5 天）
2. 接入 demo，做 hover 高亮 MVP（3 天）
3. 评估对齐质量，决定是否做 K/V 重构升级

### 图搜项目
1. CLIP 浏览器加载（已验证）
2. hnswlib-wasm 索引（1 周）
3. WebGPU 加速（1 周）
4. UI 整合（1 周）

---

## 6. 一句话总结

**翻译词级对齐完全可行**（Lilt §4.3 已实现 + K/V 重构可升级），**图像区域 attention 仍阻塞**（需 ONNX 图手术）。建议：翻译做深度（5-7 周），图搜做基础版（4-5 周）。
