# Spike 结果：attention 提取可行性

> **模型**：Claude (Sonnet 4.5)
> **日期**：2026-06-24
> **结论**：transformers.js **结构性阻塞** attention 提取，但基础图搜仍可行

---

## 1. 验证矩阵

| Probe | 模型 | 结果 | 备注 |
|---|---|---|---|
| 基础翻译 | Xenova/opus-mt-en-zh | ✅ 174s 首次，1.7s 缓存 | 译文：「棕色的狐狸跳过懒狗」 |
| NMT attention 提取 | 同上 | ❌ | ONNX 输出仅 logits + KV cache |
| NMT `output_attentions=true` | transformers.js | ❌ | **静默忽略**，输出无变化 |
| CLIP 基础分类 | Xenova/clip-vit-base-patch16 | ✅ dog 0.999 | zero-shot 正常 |
| CLIP `model.vision_model()` | combined CLIPModel | ❌ | 强制要 input_ids，不能 vision-only forward |
| CLIP vision_model.onnx 直接加载 | onnxruntime-node | ✅ 加载成功 | 但输出仅 `image_embeds (512-d)`，**无 last_hidden_state** |
| CLIP `output_hidden_states` | combined | ❌ | **静默忽略** |

## 2. 根因

transformers.js 默认 ONNX 导出**只保留最终预测输出**（logits / pooled embeds），**丢弃所有中间层**：
- NMT：只输出 logits + KV cache（KV cache 用于加速，非 attention 本身）
- CLIP：vision_model 只输出 image_embeds（CLS pooled），text_model 只输出 text_embeds

这是**通用模式**：HuggingFace 默认导出是为推理服务，**不为可解释性 / 对齐服务**。

## 3. 影响范围

| 计划功能 | 可行性 | 原因 |
|---|---|---|
| 图搜 top-K 检索（基础） | ✅ 可行 | image_embeds (512-d) 足够做向量检索 |
| 浏览器内 WebGPU 加速 | ✅ 可行 | transformers.js v3 支持 |
| 隐私 / 离线翻译 | ✅ 可行 | 全本地推理 |
| **词级对齐 hover 高亮** | ❌ 阻塞 | 无 attention |
| **图像区域 attention 热力图** | ❌ 阻塞 | 无 patch hidden state |

**两个"深度功能"被同一个架构问题阻塞**。

---

## 4. 可行路径

### 路径 1：接受现实，做基础版图搜（推荐 MVP）
- 图搜 top-K 检索（已验证可行）
- WebGPU 加速 + Service Worker 缓存
- 隐私卖点（图片不上传）
- **简历价值**：3/5（工程完整，但缺稀缺性）

### 路径 2：ONNX 图手术（中等难度，2-3 周）
用 `onnx` npm 包修改 ONNX 计算图，**插入 Identity 节点暴露中间层输出**：
```javascript
import onnx from 'onnxruntime-node'  // 或 onnx 包
// 加载 vision_model.onnx → 找到 patch embedding 节点 → 加 Identity 暴露 → 保存
```
- ✅ 纯 JS 路径，绕过 Python
- ✅ 这本身就是**深度工程**（懂 ONNX graph 的前端极少）
- ⚠️ 需要学 ONNX IR
- 简历价值：4/5

### 路径 3：Bergamot（不同栈）
- 据说暴露 attention，但 API 弱
- 编译复杂

### 路径 4：自己用 Python 导出（用户不会）
- optimum-export 带 `--attentions` flag
- 需要学 Python

---

## 5. 我的判断

**先做路径 1（基础版图搜），路径 2 作为可选增强。**

理由：
1. 路径 1 完全可行，**1-2 周能跑出可演示的产品**
2. 路径 2 即使做了，也只是锦上添花（基础版已有卖点）
3. 路径 2 的「ONNX 图手术」本身可以单独写成博客 / 简历亮点
4. 翻译词级对齐**暂时放弃**，等路径 2 在图搜上验证后再迁移

## 6. 修正后的双项目策略

| 项目 | 范围 | 工期 |
|---|---|---|
| 翻译扩展 | 现有功能 + 工程化收尾 | 2-3 周 |
| 图搜 MVP | top-K 检索 + WebGPU + 隐私 | 4-5 周 |
| 图搜增强（可选） | ONNX 图手术 → 区域热力图 | +2-3 周 |

**总工期**：6-8 周（不含 ONNX 手术）/ 8-11 周（含）

## 7. 待用户决策

- [ ] 是否同意降级到「基础版图搜」+ 翻译收尾？
- [ ] 是否要追加「ONNX 图手术」作为深度增强？
- [ ] 翻译词级对齐是否暂时搁置？
