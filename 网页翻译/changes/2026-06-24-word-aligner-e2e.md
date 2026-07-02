# 2026-06-24 · word-aligner 端到端 pipeline 落地

**模型**: Claude (Sonnet 4.5)
**任务**: 基于 K/V 重构 spike 的成果，交付端到端 src↔tgt 词级对齐高层 API + 5 用例 e2e。

## 改动
- 新增 `lib/word-aligner.mjs`：
  - 高层 API `alignSentence(srcText, tgtText, opts)` → `{ srcTokens, tgtTokens, alignments, method }`
  - 单例 ONNX sessions（多次调用复用，避免重复加载 ~700MB 模型）
  - 复用 `lib/kv-aligner.mjs` 的 `averageHeads` / `cosine`
  - 字符 offset 扫描（贪心 indexOf），处理 BPE 子词 + CJK 多字符 token
  - 跳过特殊 token (`</s>`/`<pad>`) 与语言标签 token（`>>zho<<` decode 为空）
  - `layerStrategy: 'last' | 'avg'`（实测 `'last'` 在 MarianMT en-zh 上更准）
- 新增 `spike/word-alignment/e2e-align.mjs`：5 个用例 + 控制台肉眼校验 + JSON 写入
- 新增 `package.json` + `node_modules/` 软链到 spike 依赖（解决 ESM 解析从 lib/ 找不到 @huggingface/transformers 的问题）
- 输出 `spike/word-alignment/results/e2e-alignment.json`（严格契约）

## JSON 契约
```json
{
  "meta": { "model": "Xenova/opus-mt-en-zh", "method": "...", "timestamp": "..." },
  "cases": [{
    "src": "...", "tgt": "...",
    "srcTokens": [{ "text": "...", "start": 0, "end": 3 }, ...],
    "tgtTokens": [{ "text": "...", "start": 0, "end": 1 }, ...],
    "alignments": [{ "tgtIdx": 0, "srcIdx": 0, "score": 0.24 }, ...],
    "method": "fingerprint-v1-lastlayer"
  }]
}
```
alignments 中的 `tgtIdx`/`srcIdx` 已 remap 到「可见 token 数组」下标（剔除 special/lang-tag），
可视化层直接 `srcTokens[a.srcIdx]` 索引即可。

## 算法（K-fingerprint）
1. tokenize src → encoder forward → encoder_hidden_states
2. tokenize tgt（teacher-forcing）→ decoder forward 喂 src_hidden + tgt_ids
3. 提取最后一层 cross-attn K（`present.5.encoder.key`）→ 多头平均 → src 向量 [src_len, 64]
4. 提取最后一层 self-attn  K（`present.5.decoder.key`）→ 多头平均 → tgt 向量 [tgt_len, 64]
5. 每个 tgt token cosine 与所有 src 向量，argmax → srcIdx

## 实测准确率（5 用例 / 17 个对齐）
| case | src | tgt | 对齐总数 | 直觉正确 | precision |
|------|-----|-----|---------|---------|-----------|
| 1 | The quick brown fox jumps over the lazy dog | 棕色的狐狸跳过懒狗 | 9 | 4 | 44% |
| 2 | I love you | 我爱你 | 1 | 1 | 100% |
| 3 | Hello world | 你好世界 | 2 | 1 | 50% |
| 4 | The cat is sleeping | 猫在睡觉 | 3 | 1 | 33% |
| 5 | Open the door | 打开门 | 2 | 1 | 50% |
| **总计** | | | **17** | **8** | **47%** |

**结论**：未达 60% 目标，但符合业界 K-fingerprint baseline 区间（30-60%）。
原因 + 改进路径见 `docs/word-alignment-e2e-report.md`。

## 性能
- 首次 case：~1.0s（含 tokenizer + sessions 加载）
- 后续 case：~15-20ms（sessions 复用）

## 验收
- [x] 5/5 case 跑通，无报错
- [x] JSON 严格符合契约（contract check 通过）
- [x] 控制台输出肉眼可见对齐
- [ ] 60% 直觉准确率（实测 47%，见报告）

## 风险 / TODO
- 准确率受限于 ONNX 导出未暴露 decoder hidden states / Q（详见报告）
- MarianMT en-zh 中文 token 粒度不均（"我爱你" 是 1 token，"棕色的狐狸" 是 9 token）→ 影响 precision 统计
- 多 token tgt（如 "我爱你"）的对齐粒度天然粗，应改用「字符级」输出供可视化（已通过 start/end offset 间接支持）
