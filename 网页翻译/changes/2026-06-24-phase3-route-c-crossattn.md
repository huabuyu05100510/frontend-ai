# 2026-06-24 Phase 3 Route C：MarianMT Cross-Attention 词对齐

> 模型：Claude (Sonnet 4.5)

## 改动
- **新增** `spike/phase3/export_crossattn.py` — PyTorch MarianMT 提取 cross-attn（L3 H0 alignment head）
- **新增** `spike/phase3/analyze_layers.py` — 6×8 layer/head 集中度分析，定位 L3 H0
- **新增** `test/fixtures/marian-crossattn.json` — 8 case cross-attn 矩阵
- **新增** `test/fixtures/marian-crossattn-gold.json` — 8 case 金标准（基于 model.generate 真值）
- **新增** `benchmark/route-c-benchmark.mjs` — Route C benchmark + 信号集中度指标
- **改** `lib/marian-crossattn-aligner.mjs` — 新增 `attnAlign()`（单向 argmax + 阈值，不复用 simAlign）
- **新增** `docs/phase3-route-c-report.md` — 完整 Phase 3 报告

## 关键发现
1. **alignment head**：多头平均会稀释信号（F1=0.283）。awesome-align 论文思路：单选 alignment head（L3 H0 集中度 0.91），F1 → 0.674
2. **attention 不能套 embedding 的双向 argmax**：cross-attn 已 softmax，反向 argmax 是噪声。改 forward + threshold=0.3，F1 → 0.704
3. **5/8 case 满分**；剩 3 case 是模型翻译本身错误（C1 多译"懒"），算法无能为力

## 结果
| 指标 | 值 |
|---|---|
| avg F1 | 0.704 |
| avg max attention（信号集中度） | 0.873 |
| 满分 case | 5/8 |
| vs Route A | -0.137 |

## V3 §6 修正
- ❌ 多头平均 → ✅ alignment head 单选
- ❌ 复用 simAlign 双向 argmax → ✅ attention 专用 attnAlign（单向 + 阈值）

## 下一步
Phase 5 ensemble 需要 Route A 重跑 LaBSE 用 model.generate 的 tgt token 序列（两路 tokenization 必须一致才能投票）。
