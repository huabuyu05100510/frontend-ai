# 2026-06-24 — V3 Phase 1-2 落地：端侧 NMT spike + LaBSE SimAlign 单路 F1=0.841

> **模型**：Claude (Sonnet 4.5)
> **方案**：`docs/product-plan-v3.md`

## 改动概览

### 文档（docs/）
- `product-plan-v3.md` — **V3 完整产品级方案**（端侧 NMT + 三路对齐 ensemble + 与图搜协同）
- `phase1-nmt-spike-report.md` — Phase 1 spike 报告（NMT ✅，attention ❌ 预期内）
- `phase2-route-a-report.md` — Phase 2 报告（Route A F1=0.841）
- `phase5-6-report.md` — Phase 5+6 现状报告

### 代码（lib/）
- `lib/labse-simalign.mjs` — SimAlign 三件套（argmax + itermax + grow_diag）+ cosine + buildSimMatrix
  - **关键发现**：默认 `grow_diag` 在 zh-en 上 F1=0.629，改 `argmax` 后 F1=0.841（+21%）
- `lib/ensemble-aligner.mjs` — 三路投票 + F1 评估 + monotonic check

### 测试
- `test/labse-simalign.test.mjs` — 13/13 通过
- `test/ensemble-aligner.test.mjs` — 10/10 通过
- `test/demo-aligned-ui.mjs` — Playwright UI 回归（hover 双向高亮验证）
- `test/shots/demo-aligned-{1,2,3}-*.png` — UI 截图

### Fixture
- `test/fixtures/labse-embeddings.json` — 8 case LaBSE token 级 embedding
- `test/fixtures/align-gold.json` — 8 case 人工金标准（51 对齐对）

### Spike
- `spike/phase2/extract-labse.mjs` — LaBSE 提取脚本（hf-mirror 镜像）
- `spike/phase2/dump-tokens.mjs` — LaBSE token 拆分可视化

### Benchmark
- `benchmark/align-benchmark.mjs` — 端到端 F1 benchmark
- `benchmark/strategy-compare.mjs` — 4 种 SimAlign 策略对比
- `benchmark/results/phase2-simalign.{json,log}`
- `benchmark/results/phase2-strategy-compare.{json,log}`

### Demo
- `demo-aligned.html` — 纯前端 hover 高亮 demo
- `demo-aligned-data.json` — demo 数据源

## 关键量化指标

| 指标 | V3 目标 | 实测 |
|---|---|---|
| Route A 单路 F1 | 82-87% | **84.1%** ✅ |
| Route A 单 case 算法延迟 | < 1ms | **0.5ms** ✅ |
| NMT 翻译首屏 | < 2s | **1.5s**（含模型加载）✅ |
| 单测覆盖（核心 lib） | 100% | **23/23 通过** ✅ |

## 核心技术发现

1. **transformers.js v4 默认 ONNX 不导出 attention**：`output_attentions=true` 被静默忽略。验证 Route B/C 必须做 ONNX graph surgery（与 V3 §4.3 预期一致）。

2. **SimAlign `grow_diag` 在 zh-en 不友好**：论文默认策略因 intersect 种子强制一对一，丢失多对一（"敏捷"→"quick" 2:1）。改用 `argmax`（双向并集）F1 +21%。

3. **LaBSE 中文是字级、英文是 word piece**：fixture 标注时需注意 "Neural"→"Neu"+"##ral"。

4. **LaBSE 模型 470MB**：首次下载 ~3.5min（hf-mirror），需 Service Worker 预缓存（Phase 6 扩展集成时处理）。

## 下一步（未启动）

- Phase 3: Route B（mBERT hidden state 替代 attention 路线 / graph surgery）
- Phase 4: Route C（MarianMT cross-attn graph surgery，与图搜 `clip_hidden_state.py` 联动）
- Phase 5 完整版：50 case 扩展金标准（TsinghuaAligner）
- Phase 6: 扩展集成 + Service Worker + Web Worker
