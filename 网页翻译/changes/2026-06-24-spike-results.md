# 2026-06-24 — Spike 结果：attention 提取被阻塞

## 模型
Claude (Sonnet 4.5)

## 改动
- 新增 `spike/word-alignment/`（3 个 spike 脚本）
- 新增 `spike/clip-alignment/`（4 个 spike 脚本）
- 新增 `docs/spike-results-attention-blocked.md`

## 核心发现
1. ✅ transformers.js 翻译/分类基础功能可用（opus-mt、CLIP 都跑通）
2. ✅ 图搜 top-K 检索基础功能可用（image_embeds 512-d）
3. ❌ **词级对齐**阻塞：ONNX 不导出 attention，transformers.js 静默忽略 `output_attentions`
4. ❌ **图像区域 attention**阻塞：vision_model.onnx 只输出 pooled image_embeds，无 last_hidden_state
5. **根因**：HF 默认 ONNX 导出为推理服务，丢弃中间层输出（这是通用模式）

## 影响范围
- 翻译 + 词级对齐：MVP 路径 B（后端 PyTorch）也不可行（PyTorch 是另一回事，但用户不会 Python）
- 图搜基础版：完全可行（top-K 检索 + WebGPU + 隐私卖点）
- 图搜深度（区域 attention）：阻塞，需 ONNX 图手术或 Python 导出

## 推荐路径
1. 基础版图搜（4-5 周）— top-K 检索 + WebGPU 加速
2. ONNX 图手术（2-3 周，可选）— 用 onnx npm 包暴露中间层
3. 翻译词级对齐暂搁置

## 待决策
- 是否同意降级策略
- 是否做 ONNX 图手术
- 翻译词级对齐是否搁置
