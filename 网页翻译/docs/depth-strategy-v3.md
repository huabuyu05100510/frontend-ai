# 深度策略 V3：自己造 attention

> **模型**：Claude (Sonnet 4.5)
> **替代**：V2 系列里把「K/V 重构」和「ONNX 图手术」当可选升级的框架
> **核心修正**：那两条路径不是「升级」，**就是深度本身**

---

## 0. V2 → V3 的核心修正

V2 把方案分成「基础版（CRUD）」和「深度增强（可选）」。这个框架错了。

**真深度不是"调 API 拿 attention"，是"模型不给你 attention 时自己造出来"。**

| 方案 | 真深度？ | 原因 |
|---|---|---|
| Lilt §4.3 启发式 | ❌ | 字符匹配，本科作业级，已实现 |
| 调 `output_attentions=true` | ❌ | 一行 API（且这条堵死） |
| **K/V 重构 attention** | ✅ | 懂 transformer Q/K/V 数学 + ONNX 节点 + 手动跑 decoder |
| **ONNX graph surgery** | ✅ | 纯 JS 改 ONNX 图，会的前端极少 |

---

## 1. 深度的本质

**稀缺性来源**：不是「能拿到 attention」，是「当模型不给你时，自己造出来」。

```
方式 A（堵死）：模型 → API → attention → 可视化（任何人都会）
方式 B（深度）：模型不给 → 懂内部 → 反推重构 → 可视化（10 年专家）
```

方式 B 要求：
1. 懂 transformer 的 Q/K/V 数学
2. 懂 ONNX graph 节点命名
3. 手动跑 ONNX decoder，绕过 transformers.js 高层封装
4. 处理 BPE tokenization 边界

---

## 2. 修正后的项目核心

### 翻译项目核心 = K/V 重构
- 不是 Lilt §4.3（启发式兜底，不是亮点）
- 不是 WebGPU（演进路径，不阻塞）
- **核心是从 `present.*.encoder.key/value` 反推 attention**

### 图搜项目核心 = ONNX graph surgery
- 不是 top-K 检索（CRUD）
- **核心是用 onnx npm 包改 vision_model.onnx，插入 Identity 节点暴露 patch hidden state**

---

## 3. 简历叙事（修正版）

> "transformers.js 默认 ONNX 不导出 attention。我从 decoder 缓存节点（`present.*.encoder.key/value`）反推重构 cross-attention 矩阵，绕过 PyTorch optimum export 依赖，纯 JS 实现。同样技术用于图搜：用 `onnx` npm 包对 CLIP vision_model.onnx 做 graph surgery，插入 Identity 节点暴露 patch-level hidden state。"

→ 面试官反应：「等等，你怎么在 JS 里改 ONNX 图的？」（主动追问 = 稀缺性证据）

---

## 4. 执行顺序（深度优先）

### 翻译（W1-W6）
- W1: K/V 重构 spike（验证公式）
- W2-W3: production 化 + BPE
- W4: hover 可视化
- W5: WebGPU 演进（可选）
- W6: 评估 + 开源

### 图搜（W7-W12）
- W7: ONNX graph surgery spike
- W8-W9: patch embedding 抽取 production 化
- W10: 区域热力图
- W11: top-K 检索（最后做）
- W12: 开源

**每个项目的 W1 都是深度 spike，先验证最难的部分。**
