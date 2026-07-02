# 2026-06-24 Phase 5 Route A+C Ensemble

> 模型：Claude (Sonnet 4.5)

## 改动
- **新增** `spike/phase5/extract_labse_on_marian_tokens.py` — LaBSE embedding on MarianMT token space（v1 standalone，最终采用）
- **新增** `spike/phase5/extract_labse_contextual_on_marian_tokens.py` — v2 contextual 聚合（弃用，信号稀释）
- **新增** `test/fixtures/labse-embeddings-marian-tokens.json` — 8 case LaBSE embedding（MarianMT token 空间）
- **新增** `benchmark/ensemble-benchmark.mjs` — 跨路 ensemble benchmark（3 种权重对比）
- **新增** `docs/phase5-ensemble-report.md` — 完整 Phase 5 报告

## 关键挑战 & 解法
两路 tokenization 不同（Route A 用参考译文，Route C 用 model.generate）→ 无法直接 ensemble。
**解法**：让 Route A 在 MarianMT token 空间跑（standalone LaBSE per token），与 Route C 共享索引空间。

## 实测结果

| 配置 | avg F1 |
|---|---|
| Route A only | 0.706 |
| Route C only | 0.704 |
| Ensemble 50/50 | 0.775 |
| **Ensemble 70/30 (A=0.7)** | **0.781** ← 最佳 |
| Ensemble 30/70 | 0.737 |

- **+7.5%** over Route A solo
- **+7.7%** over Route C solo
- **5/8 case 满分**

## 踩坑
- LaBSE contextual 聚合（v2）反而稀释信号，全 cosine 0.78-0.87 无差异 → 弃用回 v1 standalone
- Forward-only Route A 丢多对一能力 → 用双向 argmax 并集
- Ensemble 短 tgt（Case 2 "我爱你"）3 src 抢票 → 双向并集 + 加权投票稀释掉次要 src

## 对标百度
- Phase 5 F1=0.781，百度人感 ~95%
- 差距根因：opus-mt 80M 翻译就错（C1 译"懒懒狗"），对齐算法无能为力
- 下一步 Phase 6：换 NLLB-200-distilled-600M（600M）+ ONNX graph surgery 端侧化，预期 F1 ≥ 0.88
