# Phase 8: alignment head 微调

> **模型声明**: MiniMax-M3（按 CLAUDE.md 惯例）
> **日期**: 2026-06-27
> **关联文档**: `docs/annotation-feature-tech-plan-V1.md` §6.2 / §6.3 / §6.4
> **关联变更**: `changes/2026-06-27-phase8-mvp.md`

## 目标

基于用户标注微调 NLLB-200-distilled-600M 的 alignment head（默认 L0H15），目标：在 8-case 金标准上 F1 超过 Phase 6 基线 0.851 ≥ 0.02。

## 文件结构

```
spike/phase8/
├─ finetune_align_head.py        # 主入口
├─ model.py                       # NLLB + 冻结/解冻 alignment head
├─ data.py                        # JSONL → DataLoader
├─ majority_vote.py               # 多用户冲突解决（方案 §6.4）
├─ quality_weight.py              # 质量加权（方案 §6.4）
├─ benchmark.py                   # 8-case F1 评估（基线 0.851）
├─ gate.py                        # 准入门槛（500/10/3）
├─ tests/                         # ≥8 个 pytest 测试
├─ fixtures/                      # 测试用 JSONL + 生成器
├─ checkpoints/                   # 模型 checkpoint（dry-run 时为 meta）
├─ benchmark/results/             # benchmark JSON 历史
├─ requirements.txt
├─ pytest.ini
├─ README.md
└─ changes/2026-06-27-phase8-mvp.md
```

## 安装

```bash
pip install -r requirements.txt
```

可选：用 `python -m pytest tests/` 跑测试（不需要 torch/transformers，全 mock 友好）。

## 快速开始

### 1. Dry-run（不下载模型，推荐先跑）

```bash
python finetune_align_head.py \
  --data ./fixtures/annos.jsonl \
  --dry-run \
  --epochs 2 \
  --batch-size 8
```

输出会：
- 加载 JSONL（majority vote + 质量加权）
- 跳过 NLLB 模型加载（mock 模式）
- 走完 epoch 循环 + benchmark
- 输出 `checkpoints/training-log.json` 和 `benchmark/results/phase8-finetune-*.json`

### 2. 真实训练（需要 GPU + 下载 NLLB-600M）

```bash
python finetune_align_head.py \
  --data ./fixtures/annos.jsonl \
  --epochs 5 \
  --batch-size 32 \
  --align-layer 0 \
  --align-head 15
```

> 注：本机未下载模型时，会自动 fallback 到 mock，并打印警告。生产环境需要 GPU + ≥2GB 磁盘。

### 3. Gate 检查（不训练）

```bash
# CLI
python gate.py --samples 499 --urls 12 --lang-pairs 4

# 从 JSON
python gate.py --json ./fixtures/stats.json

# 从后端（NestJS annotation 服务）
python gate.py --export-stats-url http://localhost:3001/v1/annotations/stats
```

未达门槛时 exit code = 1 + 中文友好提示。

### 4. Benchmark 评估

```bash
# Dry-run：用金标准作预测（理论上限 F1=1.0）
python benchmark.py --dry-run --baseline 0.851

# 真评估：从 predictions.json 读 + 算 F1
# （predictions.json 格式: [{case: 0, alignments: [[srcIdx, tgtIdx], ...]}, ...]）
```

## 关键决策

| 决策 | 选择 | 理由 |
|---|---|---|
| alignment head | L0H15 | Phase 6 测得 content-only sharpness 最高，F1=0.851 |
| 冻结范围 | encoder + decoder 全部 | 仅微调 q_proj / k_proj，避免破坏主模型能力 |
| 解冻层 | decoder.layers[0].self_attn.q_proj/k_proj | NLLB cross-attn 通过 self_attn 实现（src 经 encoder 作为 K/V 输入） |
| 优化器 | AdamW lr=1e-5 | 经典小学习率微调方案 |
| 冲突阈值 | 0.30 | 方案 §6.4「冲突 > 30% 弃用」 |
| 质量权重 | heavy(≥50) 2x / new(<10) 0.5x / normal 1.0 | 方案 §6.4 |
| Dry-run | 跳过模型加载 + 用 gold=pred 跑 benchmark | CI 友好 |

## 数据来源

- **生产**: 浏览器扩展通过 IndexedDB → 后端 NestJS `/v1/annotations/export`（NDJSON）
- **测试**: 本目录 `fixtures/annos.jsonl`（85 条合成数据，6 个 case × 3 src token × 5 用户）

`fixtures/gen_fixtures.py` 可重新生成。

## 已知限制

- **小数据量过拟合**: <1000 条时容易把 q_proj/k_proj 权重推到奇异值，建议 ≥500（准入门槛）再触发
- **mock 模式不验证训练效果**: 真训练必须连 GPU + 完整 NLLB
- **不下载模型**: 本机 `python3` 无 GPU 时，自动 fallback 到 mock；生产环境需要 transformers + torch ≥2.0
- **批量训练吞吐**: NLLB-600M 完整 fine-tune 单 batch 显存 ~3GB（fp16），epochs=5 约 30 分钟

## 测试

```bash
python -m pytest tests/ -v
```

36 passed, 1 skipped（fixture 不存在时跳过金标准加载测试）。
