# 2026-06-24 — kv-aligner production 模块 + 可视化

## 模型
Claude (Sonnet 4.5)

## 改动
- 新增 `lib/kv-aligner.mjs`（K/V 重构核心模块）
- 新增 `test/kv-aligner.test.mjs`（13 个单测全过）
- 新增 `test/kv-aligner.integration.test.mjs`（真实 opus-mt 集成测试）
- 新增 `spike/word-alignment/kv-heatmap.html`（可视化页面）

## 可验证结果

### 单测 13/13 通过
- extractCrossAttentionKeys: 从 ONNX 输出提取 K 节点
- averageHeads: 多头平均
- cosine: 余弦相似度
- similarityMatrix: 相似度矩阵
- alignByFingerprint: 启发式对齐
- fullAttention: 完整 attention softmax（WIP，待 Q）
- evaluateAlignment: P/R/F1

### 集成测试通过
真实 opus-mt 模型，端到端：
- 跑 encoder + decoder forward
- 提取 6 层 cross-attention K
- 多头平均得 src token 向量
- 验证 K 非噪声（norm > 0.1）

### 可视化页面
访问 http://localhost:8788/kv-heatmap.html
- src token K 相似度矩阵热力图
- 对角线均值 ≈ 1.0
- 语义相关对：brown↔fox=0.71, lazy↔dog=0.74

## 模块 API
```javascript
import {
  extractCrossAttentionKeys,
  averageHeads,
  similarityMatrix,
  alignByFingerprint,
  fullAttention,        // WIP，待 decoder Q
  evaluateAlignment,
} from './lib/kv-aligner.mjs'
```

## 下一步
1. 接 decoder hidden state 提取（ONNX graph surgery 或 logits 反推）
2. BPE token → char 映射（处理中文分词）
3. 接入 demo + hover 高亮
4. 评估集（WPT-21 子集）
