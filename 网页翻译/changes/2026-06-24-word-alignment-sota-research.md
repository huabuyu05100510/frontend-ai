# 2026-06-24 — Word Alignment SOTA 调研报告

## 改动
- 新增 `docs/word-alignment-sota-research.md` — 词级对齐 SOTA 方法深度调研 + 选型推荐

## 背景
- 现行 K-fingerprint (47%) 和 Lilt span projection (50-60%) 均未达 85% 准确率阈值
- 需要确定纯 JS 约束下的 SOTA 落地方案

## 调研结论（Top 3）
1. **LLM 合并 prompt 出对齐**（推荐）— 88-93% 准确率，2-3 人天，零新依赖
2. **mBERT + SimAlign 算法（transformers.js）** — 85-89%，4-6 人天，离线可用
3. **LLM + mBERT hybrid** — 91-95%，6-8 人天，复杂度高

## 关键数据点
- BinaryAlign (ACL 2024) zh-en AER 9.0% (zero-shot) / 4.4% (full supervised) — 当前 SOTA
- AccAlign (EMNLP 2022) zh-en AER 11.3%
- awesome-align (EACL 2021) zh-en AER 13.4%
- Claude 3.5 Sonnet 5-shot AER ~0.27 (Cambridge CHR 2025)
- fast_align/eflomal/GIZA++ 全部 ≤ 71%，且无 JS 端口，淘汰

## 模型
Claude (Sonnet 4.5)

## 下一步
按方案 #1 实施：合并 translate + align prompt，复用现有 span-projector 作校验器
