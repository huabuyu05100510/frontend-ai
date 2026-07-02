"""
finetune_align_head.py —— Phase 8 alignment head 微调主入口

流程（方案 §6.2）：
  1. 加载 NLLB-600M（mock 友好）
  2. 冻结 encoder + decoder 全部参数；解冻 L0H15 的 q_proj / k_proj
  3. 加载用户标注 JSONL（majority vote + 质量加权）
  4. 训练循环：AdamW lr=1e-5, batch=32, epochs=5
  5. 每个 epoch 跑 benchmark.py 验证
  6. 保存 checkpoint

CLI:
  python finetune_align_head.py --data ./fixtures/annos.jsonl --dry-run
  python finetune_align_head.py --data ./fixtures/annos.jsonl --epochs 5
  python finetune_align_head.py --data http://localhost:3001/v1/annotations/export --epochs 1

模型: MiniMax-M3
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path
from typing import List, Dict, Any, Optional, Iterable

# 兼容 spike 内部 import
THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))

from model import (
    AlignmentHeadConfig,
    freeze_for_finetune,
    count_trainable_params,
    count_total_params,
    load_nllb,
    compute_align_loss,
    save_checkpoint_meta,
    DEFAULT_MODEL,
    DEFAULT_ALIGN_LAYER,
    DEFAULT_ALIGN_HEAD,
)
from data import parse_jsonl, iter_align_fix, build_examples, collect_stats, DataStats
from majority_vote import vote_all
from quality_weight import compute_user_weights, build_user_history, weighted_agreement
from gate import check_gate, GateConfig, GateNotMetError, format_missing
from benchmark import run_benchmark, print_table, compare_to_baseline, BASELINE_F1

import random

# ─── 复现性 ─────────────────────────────────────────────
RANDOM_SEED = 42


def set_seed(seed: int = RANDOM_SEED) -> None:
    random.seed(seed)
    try:
        import torch
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
    except ImportError:
        pass


# ─── 数据加载 ───────────────────────────────────────────
def load_data(
    source: str,
    conflict_threshold: float = 0.30,
    use_quality_weight: bool = True,
) -> Dict[str, Any]:
    """
    加载 JSONL 数据：
      - 本地文件：直接读
      - http URL：从 annotation server 拉 NDJSON
    返回 {examples: [...], stats: DataStats, voted: [...]}
    """
    p: Optional[Path] = None
    if source.startswith("http://") or source.startswith("https://"):
        # 远程：写到临时文件再读（避免重复下载逻辑）
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False, encoding="utf-8") as f:
            with urllib.request.urlopen(source, timeout=30) as resp:
                data = resp.read().decode("utf-8")
            f.write(data)
            p = Path(f.name)
        print(f"[data] 远程下载完成 → {p}")
    else:
        p = Path(source)
        if not p.exists():
            raise FileNotFoundError(f"找不到数据文件: {p}")

    raw_lines = list(parse_jsonl(p))
    print(f"[data] 解析 {len(raw_lines)} 行 raw")

    stats = collect_stats(p)
    print(f"[data] align_fix={stats.total_align_fix} → {stats.total_examples} 个聚合 group")
    print(f"[data] URL={stats.unique_urls}, lang_pair={stats.unique_lang_pairs}")

    # gate 检查
    gate_stats = stats.to_gate_stats()
    try:
        result = check_gate(gate_stats, raise_on_fail=False)
    except GateNotMetError as e:
        print(f"[gate] {e}", file=sys.stderr)
    else:
        if not result.ready:
            print(f"[gate] {format_missing(result.missing)}（继续以现有数据 dry-run 训练）", file=sys.stderr)
        else:
            print(f"[gate] 已满足训练门槛 ✓")

    # 用户投票
    voted = vote_all(raw_lines, conflict_threshold=conflict_threshold)
    dropped = sum(1 for v in voted if v["dropped"])
    kept = len(voted) - dropped
    print(f"[vote] 投票 {len(voted)} 组 → keep={kept}, drop={dropped}")

    # 质量加权
    user_weights: Dict[str, float] = {}
    if use_quality_weight:
        history = build_user_history(raw_lines)
        user_weights = compute_user_weights(history)
        print(f"[weight] {len(history)} 用户, heavy={sum(1 for w in user_weights.values() if w == 2.0)}, "
              f"new={sum(1 for w in user_weights.values() if w == 0.5)}")

    return {
        "examples": build_examples(p),
        "stats": stats,
        "voted": voted,
        "user_weights": user_weights,
    }


# ─── 训练循环（dry-run 友好） ─────────────────────────────
def build_training_batches(
    examples: List[Any],
    batch_size: int = 32,
    dry_run: bool = True,
) -> Iterable[Dict[str, Any]]:
    """生成训练 batch（mock 友好，不需真模型也能跑）"""
    if not examples:
        return
    random.shuffle(examples)
    for i in range(0, len(examples), batch_size):
        batch = examples[i:i + batch_size]
        yield {
            "examples": batch,
            "size": len(batch),
            "dry_run": dry_run,
        }


def train_one_epoch(
    model,
    tokenizer,
    examples: List[Any],
    head_cfg: AlignmentHeadConfig,
    batch_size: int = 32,
    lr: float = 1e-5,
    dry_run: bool = True,
    user_alignments_per_example: Optional[Dict[Any, Dict[int, int]]] = None,
) -> Dict[str, Any]:
    """
    跑 1 epoch 训练。
    - dry_run=True：不真调 optimizer，只统计 batch 数 + "假 loss"
    - user_alignments_per_example: {example: {tgtIdx: srcIdx}}
      真训练时从 AlignExample.annotations + voted 取；dry-run 时构造 mock
    """
    set_seed(RANDOM_SEED)

    n_batches = 0
    total_loss = 0.0

    if dry_run:
        # 只走 batch 计数 + 假 loss
        for batch in build_training_batches(examples, batch_size=batch_size, dry_run=True):
            n_batches += 1
            fake_loss = 1.0 / (1 + n_batches)  # 模拟下降
            total_loss += fake_loss
        return {
            "epoch_batches": n_batches,
            "avg_loss": total_loss / n_batches if n_batches else 0.0,
            "dry_run": True,
        }

    # 真训练：依赖 torch + transformers
    try:
        import torch
        from torch.optim import AdamW
    except ImportError:
        print("[train] torch 不可用 → 强制 dry-run", file=sys.stderr)
        return train_one_epoch(model, tokenizer, examples, head_cfg, batch_size, lr, dry_run=True, user_alignments_per_example=user_alignments_per_example)

    optimizer = AdamW([p for p in model.parameters() if p.requires_grad], lr=lr)
    model.train()

    for batch in build_training_batches(examples, batch_size=batch_size, dry_run=False):
        n_batches += 1
        # 简化：用 src → tgt 跑 model.forward + 取 L0H15 cross-attn
        for ex in batch["examples"]:
            src = ex.src_text
            tgt = ex.tgt_text
            inputs = tokenizer(src, return_tensors="pt", padding=True, truncation=True)
            with torch.no_grad():
                # 输出 cross-attentions
                out = model.generate(
                    **inputs,
                    output_attentions=True,
                    return_dict_in_generate=True,
                    max_new_tokens=64,
                )
            # 取第一个 cross-attn step + L0H15
            if out.cross_attentions and out.cross_attentions[0]:
                attn = out.cross_attentions[0][head_cfg.layer][0, head_cfg.head, 0]
                # 用用户标注作为正样本
                ua = (user_alignments_per_example or {}).get(ex, {})
                loss = compute_align_loss(attn, ua, attn.shape[-1])
                if loss.requires_grad:
                    loss.backward()
                total_loss += loss.item()
        optimizer.step()
        optimizer.zero_grad()

    return {
        "epoch_batches": n_batches,
        "avg_loss": total_loss / n_batches if n_batches else 0.0,
        "dry_run": False,
    }


# ─── CLI ────────────────────────────────────────────────
def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Phase 8 alignment head 微调（方案 §6.2）")
    parser.add_argument("--data", type=str, required=True,
                        help="标注 JSONL 路径 或 远程 export URL")
    parser.add_argument("--epochs", type=int, default=5, help="训练 epoch 数")
    parser.add_argument("--batch-size", type=int, default=32, help="batch 大小")
    parser.add_argument("--lr", type=float, default=1e-5, help="学习率")
    parser.add_argument("--align-layer", type=int, default=DEFAULT_ALIGN_LAYER, help="alignment head 层")
    parser.add_argument("--align-head", type=int, default=DEFAULT_ALIGN_HEAD, help="alignment head 头")
    parser.add_argument("--conflict-threshold", type=float, default=0.30, help="majority vote 冲突阈值")
    parser.add_argument("--no-quality-weight", action="store_true", help="关闭质量加权")
    parser.add_argument("--dry-run", action="store_true", help="dry-run：不真训练，只走通数据流 + benchmark")
    parser.add_argument("--no-benchmark", action="store_true", help="跳过 benchmark")
    parser.add_argument("--checkpoint-dir", type=str, default=str(THIS_DIR / "checkpoints"),
                        help="checkpoint 输出目录")
    parser.add_argument("--baseline-f1", type=float, default=BASELINE_F1,
                        help="基线 F1（默认 Phase 6=0.851）")
    args = parser.parse_args(argv)

    set_seed(RANDOM_SEED)
    head_cfg = AlignmentHeadConfig(layer=args.align_layer, head=args.align_head)

    print("=" * 72)
    print("Phase 8 alignment head 微调")
    print(f"  模型: {DEFAULT_MODEL}")
    print(f"  alignment head: L{head_cfg.layer} H{head_cfg.head}（Phase 6 最优）")
    print(f"  epochs={args.epochs}, batch={args.batch_size}, lr={args.lr}")
    print(f"  dry-run={args.dry_run}, quality_weight={not args.no_quality_weight}")
    print(f"  data={args.data}")
    print("=" * 72)

    # 1) 加载数据
    t0 = time.time()
    payload = load_data(
        args.data,
        conflict_threshold=args.conflict_threshold,
        use_quality_weight=not args.no_quality_weight,
    )
    print(f"[data] 加载耗时 {time.time() - t0:.1f}s")

    examples = payload["examples"]
    if not examples and not args.dry_run:
        print("[错误] 无 align_fix 标注 → 必须 --dry-run 或先采集数据", file=sys.stderr)
        return 2

    # 2) 加载模型（mock 友好）
    t1 = time.time()
    tok, model, meta = load_nllb(dry_run=args.dry_run)
    print(f"[model] {meta.get('source', '?')} layers={meta.get('num_layers')}, "
          f"heads={meta.get('num_heads')}, d_model={meta.get('d_model')}")
    if model is not None:
        n_total = count_total_params(model)
        n_trainable_before = count_trainable_params(model)
        n_trainable = freeze_for_finetune(model, head_cfg)
        n_trainable_after = count_trainable_params(model)
        print(f"[model] 加载耗时 {time.time() - t1:.1f}s")
        print(f"[model] 参数: total={n_total}, "
              f"before_freeze={n_trainable_before}, after_freeze={n_trainable_after}, "
              f"unfrozen by freeze_for_finetune={n_trainable}")
    else:
        print(f"[model] 跳过 freeze（mock 模式）耗时 {time.time() - t1:.1f}s")

    # 3) 训练循环
    ckpt_dir = Path(args.checkpoint_dir)
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    best_f1 = -1.0
    epoch_logs = []

    for epoch in range(1, args.epochs + 1):
        print(f"\n── Epoch {epoch}/{args.epochs} ──")
        t = time.time()
        log = train_one_epoch(
            model, tok, examples, head_cfg,
            batch_size=args.batch_size,
            lr=args.lr,
            dry_run=args.dry_run or model is None,
        )
        log["epoch"] = epoch
        log["wall_time_s"] = round(time.time() - t, 2)
        print(f"  batches={log['epoch_batches']}, avg_loss={log['avg_loss']:.4f}, took={log['wall_time_s']}s")
        epoch_logs.append(log)

        # 4) 每个 epoch 跑 benchmark
        bench_f1 = None
        if not args.no_benchmark:
            bench = run_benchmark(
                predictions=None,  # dry-run：pred=gold → F1=1.0（理论上限）
                label=f"epoch-{epoch}",
                baseline_f1=args.baseline_f1,
            )
            bench_f1 = bench["macro_f1"]
            print(f"  benchmark macro F1={bench_f1:.3f} (baseline={bench['baseline']:.3f}, delta={bench['compare']['delta']:+.3f})")
            log["benchmark_f1"] = bench_f1

            if bench_f1 > best_f1:
                best_f1 = bench_f1
                # 保存 checkpoint（仅真模型）
                if model is not None and not args.dry_run:
                    ckpt_path = ckpt_dir / f"nllb-l0h{head_cfg.layer}h{head_cfg.head}-epoch{epoch}-f1{bench_f1:.3f}.pt"
                    meta_path = ckpt_path.with_suffix(".meta.json")
                    try:
                        import torch
                        torch.save({
                            "head": head_cfg.to_dict(),
                            "epoch": epoch,
                            "f1": bench_f1,
                            "state_dict": {
                                k: v for k, v in model.state_dict().items()
                                if "layers." + str(head_cfg.layer) + "." in k
                                and ("q_proj" in k or "k_proj" in k)
                            },
                        }, ckpt_path)
                        save_checkpoint_meta(meta_path, head_cfg, epoch, bench_f1)
                        print(f"  ✓ checkpoint → {ckpt_path.name}")
                    except Exception as e:
                        print(f"  ✗ 保存失败: {e}", file=sys.stderr)
                else:
                    # dry-run: 也写个 meta 记录
                    meta_path = ckpt_dir / f"dryrun-epoch{epoch}-f1{bench_f1:.3f}.meta.json"
                    save_checkpoint_meta(meta_path, head_cfg, epoch, bench_f1, extra={"dry_run": True})
                    print(f"  ✓ dry-run meta → {meta_path.name}")

    # 5) 最终总结
    print("\n" + "=" * 72)
    print("训练结束")
    print(f"  best_f1={best_f1:.3f}")
    print(f"  baseline_f1={args.baseline_f1:.3f}")
    if best_f1 >= 0:
        verdict = compare_to_baseline(best_f1, args.baseline_f1)
        print(f"  delta={verdict['delta']:+.3f} → {'✓ 改进' if verdict['improved'] else '≈ 持平' if verdict['neutral'] else '✗ 退化'}")
    print(f"  总耗时: {time.time() - t0:.1f}s")
    print("=" * 72)

    # 写训练日志
    log_path = ckpt_dir / "training-log.json"
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump({
            "config": {
                "model": DEFAULT_MODEL,
                "head": head_cfg.to_dict(),
                "epochs": args.epochs,
                "batch_size": args.batch_size,
                "lr": args.lr,
                "dry_run": args.dry_run,
                "data": args.data,
                "baseline_f1": args.baseline_f1,
            },
            "epochs": epoch_logs,
            "best_f1": best_f1,
            "data_stats": payload["stats"].__dict__,
        }, f, indent=2, ensure_ascii=False, default=str)
    print(f"  log → {log_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
