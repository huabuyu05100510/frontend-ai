# Phase 5 + 6 报告 — Ensemble 现状 + Demo + 扩展集成准备

> **模型**：Claude (Sonnet 4.5)
> **日期**：2026-06-24
> **方案**：V3 §10-12

---

## 1. Phase 5：Ensemble 现状

Route A 单路已实现 avg F1 = **0.841**，距 V3 目标 85% 仅差 1%。

### 5.1 已完成

- `lib/ensemble-aligner.mjs` 三路投票框架（单路退化 + 多路加权 + disagreement 检测）
- `evaluateF1` 评估器
- 8 case 金标准 fixture（`test/fixtures/align-gold.json`）
- 8 case LaBSE embedding fixture（`test/fixtures/labse-embeddings.json`）
- 单测 10/10 通过

### 5.2 待 Phase 3-4 解锁

- **Route B**（mBERT self-attention）：Phase 1 已证 attention 拿不到，需 graph surgery
- **Route C**（MarianMT cross-attn）：同上，且与 NMT encoder 共用
- Phase 3-4 完成 → 重跑 ensemble benchmark，目标 F1 ≥ 0.87

### 5.3 50 case 扩展（金标准工作量）

当前 8 case 是手工标注。扩到 50 case 的路径：
- 从 **TsinghuaAligner**（zh-en 450 句公开数据集）抽 50 句 → 已有金标准
- 写脚本把 TsinghuaAligner 格式转成 `align-gold.json` schema
- 用同样 pipeline 跑 LaBSE → benchmark

工作量预估：1 人天（脚本 + 跑 + 落报告）。

---

## 2. Phase 6：Demo 与扩展集成准备

### 2.1 已交付 demo

**`demo-aligned.html`** — 纯前端可视化（自包含，无模型推理）

| 特性 | 实现 |
|---|---|
| 数据源 | `demo-aligned-data.json`（benchmark 产物） |
| 渲染 | 8 case 卡片，token 级 span |
| 交互 | hover 任一词 → 双向高亮 |
| 金标准反馈 | 预测命中金标准的 token 加黄框 |
| 指标卡 | avg F1 / 目标对比 / 延迟 |
| 路线图进度条 | Phase 1-6 状态可视化 |

访问：
```bash
python3 -m http.server 8789
# http://localhost:8789/demo-aligned.html
```

### 2.2 UI 回归（Playwright）

`test/demo-aligned-ui.mjs` — 自动化 UI 验证：
- ✅ 8 cases 渲染正确
- ✅ avg F1 = 84.1% 显示正确
- ✅ hover tgt → 双向高亮（Case 2 触发 2 个高亮）
- ✅ hover src → 多对一高亮（Case 1 触发 8 个高亮）
- ✅ 截图落 `test/shots/demo-aligned-{1,2,3}-*.png`

### 2.3 扩展集成准备（未启动，下一阶段）

V3 §5 架构在 demo 中已部分验证。扩展集成需要：
- content script 复用 `lib/labse-simalign.mjs` + `lib/dom-renderer.mjs`
- service worker 加 LaBSE 模型（transformers.js v3 + Service Worker 模型缓存）
- Web Worker 隔离 embedding 推理
- popup 接 `lib/ensemble-aligner.mjs` 显示 trace

技术栈全部就绪，关键阻塞是 Phase 3-4 的 graph surgery（否则只能用 Route A 单路）。

---

## 3. 当前完成度

| Phase | V3 目标 | 实际 | 状态 |
|---|---|---|---|
| 1. NMT spike | 跑通 + attention 验证 | ✅ 翻译 1.5s；attention 不可获取（预期内） | ✅ 完成 |
| 2. Route A | F1 82-87% | **F1 0.841** | ✅ 完成 |
| 3. Route B | mBERT self-attention | ⏸ 需 graph surgery | 待启动 |
| 4. Route C | MarianMT cross-attn | ⏸ 需 graph surgery | 待启动 |
| 5. Ensemble | F1 ≥ 85% | 单路已 84.1%，三路融合预期 ≥ 87% | ⏳ 部分（待 3-4） |
| 6. 扩展集成 | hover 高亮 + 可观测 | demo 验证通过；扩展未集成 | ⏳ 部分（demo 完成） |

---

## 4. 下次启动建议

**最优先**：Phase 3 — Route B mBERT
- 方案 A（推荐）：先不上 graph surgery，用 mBERT **encoder hidden state**（默认导出）+ cosine，与 LaBSE 形成差异化（不同模型空间），看 ensemble 能否冲过 85%
- 方案 B（兜底）：写 `surgery/mbert_attention.py`（onnx_graph_surgeon Python 脚本），暴露 attention 张量

**次优先**：50 case 扩展金标准（接 TsinghuaAligner）

**长期**：扩展集成（Phase 6 完整版）+ 图搜联动 graph surgery
