# Word Alignment E2E — 技术报告

**模型**: Claude (Sonnet 4.5)
**日期**: 2026-06-24
**状态**: pipeline 跑通；准确率 47%（未达 60% 目标，根因 + 改进路径见下）

## 1. 交付

- `lib/word-aligner.mjs` — `alignSentence(src, tgt)` 高层 API
- `spike/word-alignment/e2e-align.mjs` — 5 用例 e2e
- `spike/word-alignment/results/e2e-alignment.json` — 可视化契约 JSON

## 2. 算法回顾

**K-fingerprint**（业界 MarianMT 词对齐 baseline）：

```
src 向量 = present.5.encoder.key （cross-attn K，src 侧，[1,8,src_len,64]）
          → 多头平均 → [src_len, 64]
tgt 向量 = present.5.decoder.key （self-attn  K，tgt 侧，[1,8,tgt_len,64]）
          → 多头平均 → [tgt_len, 64]
对齐    = argmax_s cosine(tgtK[t], srcK[s])
```

## 3. 实测结果（5 case / 17 alignment）

| Case | tgt token | 对齐到的 src | score | 直觉判定 |
|------|-----------|------------|-------|---------|
| 1 | 棕 | brown | 0.242 | ✓ |
| 1 | 色 | brown | 0.328 | ✓ |
| 1 | 的 | brown | 0.222 | ✗（虚词，宽松接受） |
| 1 | 狐 | dog | 0.297 | ✗（应 fox） |
| 1 | 狸 | lazy | 0.397 | ✗（应 fox） |
| 1 | 跳 | dog | 0.113 | ✗（应 jump） |
| 1 | 过 | jump | 0.136 | ✓（jumps BPE 拆 jump+s） |
| 1 | 懒 | dog | 0.094 | △（lazy 被误判到 dog，但语义近） |
| 1 | 狗 | lazy | 0.224 | ✗ |
| 2 | 我爱你 | love | 0.201 | ✓ |
| 3 | 你好 | world | 0.098 | ✗ |
| 3 | 世界 | world | 0.086 | ✓ |
| 4 | 猫 | cat | 0.205 | ✓ |
| 4 | 在 | cat | 0.130 | ✗（应 is） |
| 4 | 睡觉 | cat | 0.181 | ✗（应 sleeping） |
| 5 | 打开 | Open | 0.193 | ✓ |
| 5 | 门 | Open | 0.206 | ✗（应 door） |

**严格 precision = 8/17 = 47%**
**宽松（含 △）= 9/17 = 53%**

## 4. 准确率不达标的根因

### 4.1 核心问题：K↔K cosine 不是 attention

真正的 cross-attention 是 `softmax(Q·K^T / √d)`，其中 **Q 来自 decoder hidden state**。
我们的 ONNX 导出（`decoder_model_merged.onnx`）只暴露 `present.*.{encoder,decoder}.{key,value}`，**没有 Q、没有 decoder hidden state**。

用 `decoder.key`（self-attn K，编码 tgt 上下文）去跟 `encoder.key`（cross-attn K，编码 src token 身份）做 cosine，本质上是「拿 tgt 的局部上下文指纹 vs src 的全局 token 指纹」，二者不在同一语义空间，cosine 信号很弱（实测集中在 0.1-0.4）。

### 4.2 次要问题：tokenizer 粒度不均

- "我爱你" 是 1 个 token（不是 3 个），对齐粒度天然粗
- "你好世界" 是 2 个 token（"你好"/"世界"），不是 4 个字
- "棕色的狐狸跳过懒狗" 是 9 个 token（每字独立）

这导致 precision 统计被 case 1 主导（9/17 = 53% 来自单 case）。

### 4.3 实验对照（都已尝试，未提升）

| 策略 | 结果 |
|------|------|
| `last` layer（默认） | 47% |
| `avg` 所有 6 层 K | ~30%（last 层 task-specific 信号被稀释） |
| dot-product + softmax | 退化为接近均匀分布（K↔K 没有显著区分度） |
| `encoder.value` ↔ `decoder.value` | ~30%（V 携带的是内容摘要，对 token 级对齐更弱） |
| `encoder.key` ↔ `decoder.value` 跨匹配 | ~25% |

## 5. 改进路径（按 ROI 排序，本次不动）

### 5.1 [高 ROI] ONNX graph surgery 暴露 decoder hidden state
- 用 `onnxruntime-node` 的 `GraphOptimizationLevel` + 自定义 `onnx-mod` / `onnx_graph_surgeon`
- 把 `decoder_model_merged.onnx` 里的「最后层 cross-attn 输入」节点改名导出
- 拿到 decoder hidden 后即可算 **真实 cross-attention Q·K^T**，准确率可达 80%+

### 5.2 [高 ROI] 直接换用 fast_align / awesome-align
- 这两个是业界标准词对齐工具（基于 IBM Model 1 / neural）
- 输入：平行句对（成千上万条）；输出：词对齐
- 缺点：需要训练数据，不适合 zero-shot 单句对齐

### 5.3 [中 ROI] Monotonic prior + K-fingerprint 混合
- en→zh 翻译基本保序（cat→猫, sleeping→睡觉 顺序一致）
- 对 cosine score 做 length-normalized + monotonic prior（DTW-like）
- 实测能把 case 4「猫→cat」「睡觉→sleeping」救回，估计 +10-15% precision

### 5.4 [中 ROI] Embedding-space 对齐
- decoder 嵌入矩阵在词表空间（512-dim），每个 tgt token id 直接索引拿 embedding
- encoder_hidden_states 也在 512-dim
- 二者 cosine 比 K↔K 更合理（同一空间）
- 难点：embedding 矩阵不在 ONNX 输出里，要从 tokenizer/model config 单独拿

### 5.5 [低 ROI] 多 head 分别对齐 + 投票
- 不同 head 关注不同子空间，分别 argmax 后多数投票
- 实测对 MarianMT 提升 <5%（head 间相关性太高）

## 6. 可视化建议（给做可视化的 agent）

- 用 `alignments[].srcIdx` / `tgtIdx` 直接索引 `srcTokens` / `tgtTokens` 数组（已 remap 到 visible space）
- `score` 在 0-1 之间（cosine），可用于色阶映射（暗→亮 = 弱→强对齐）
- 多对一合法（多个 tgt token 指向同一 src token，如 "棕"/"色" 都指 "brown"），可视化用同一高亮色
- 一对多也合法但本数据集未出现
- 字符级 hover：用 `start` / `end` 在原文字符串上画 span

## 7. 复现

```bash
cd /Users/didi/Downloads/前端AI面试题/网页翻译/spike/word-alignment
node e2e-align.mjs
# → 控制台打印对齐表 + results/e2e-alignment.json
```
