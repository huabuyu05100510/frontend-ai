"""
benchmark.py —— 8-case 金标准 F1 评估
- 复用 test/fixtures/nllb-crossattn-gold.json（Phase 6）
- 计算 macro F1 / micro F1 / per-case
- 与基线对比（baseline Phase 6 F1=0.851）

输出:
  - 表格（stdout）
  - JSON → benchmark/results/phase8-finetune-{timestamp}.json

模型: MiniMax-M3
"""
from __future__ import annotations
import json
import os
import time
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import List, Dict, Set, Tuple, Optional, Any

BASELINE_F1 = 0.851  # Phase 6 Route C (NLLB L0H15) — changes/2026-06-24-phase6-nllb.md
AB_GATE_THRESHOLD = 0.02  # 方案 §6.3 A/B 准入门槛

GOLD_FIXTURE_DEFAULT = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "nllb-crossattn-gold.json"


# ─── F1 计算 ────────────────────────────────────────────
def _set_alignments(cases):
    """金标准 alignments → list of set of (srcIdx, tgtIdx)"""
    out = []
    for c in cases:
        s = set()
        for a in c["alignments"]:
            s.add((int(a["srcIdx"]), int(a["tgtIdx"])))
        out.append(s)
    return out


def compute_precision_recall(pred, gold):
    """单 case 的 P / R / F1"""
    if not pred and not gold:
        return 1.0, 1.0, 1.0
    tp = len(pred & gold)
    fp = len(pred - gold)
    fn = len(gold - pred)
    if tp == 0:
        return 0.0, 0.0, 0.0
    p = tp / (tp + fp)
    r = tp / (tp + fn)
    f1 = 2 * p * r / (p + r) if (p + r) > 0 else 0.0
    return p, r, f1


def compute_macro_f1(case_results):
    if not case_results:
        return 0.0
    return sum(c["f1"] for c in case_results) / len(case_results)


def compute_micro_f1(case_results):
    """汇总 tp/fp/fn 后算 F1"""
    tp = sum(c.get("tp", 0) for c in case_results)
    fp = sum(c.get("fp", 0) for c in case_results)
    fn = sum(c.get("fn", 0) for c in case_results)
    if tp == 0:
        return 0.0
    p = tp / (tp + fp)
    r = tp / (tp + fn)
    return 2 * p * r / (p + r) if (p + r) > 0 else 0.0


def evaluate_predictions(predictions, gold, case_names=None):
    """逐 case 评估，返回 per-case + macro + micro"""
    if case_names is None:
        case_names = [f"case_{i}" for i in range(len(predictions))]
    per_case = []
    for i, (pred, g) in enumerate(zip(predictions, gold)):
        p, r, f1 = compute_precision_recall(pred, g)
        tp = len(pred & g)
        fp = len(pred - g)
        fn = len(g - pred)
        per_case.append({
            "case": case_names[i],
            "p": p, "r": r, "f1": f1,
            "tp": tp, "fp": fp, "fn": fn,
        })
    return {
        "per_case": per_case,
        "macro_f1": compute_macro_f1(per_case),
        "micro_f1": compute_micro_f1(per_case),
    }


# ─── 与基线对比 ─────────────────────────────────────────
def compare_to_baseline(new_f1, baseline_f1=BASELINE_F1, threshold=AB_GATE_THRESHOLD):
    delta = new_f1 - baseline_f1
    return {
        "new_f1": new_f1,
        "baseline_f1": baseline_f1,
        "delta": delta,
        "threshold": threshold,
        "improved": delta > threshold,
        "regression": delta < -threshold,
        "neutral": abs(delta) <= threshold,
    }


# ─── 加载金标准 ─────────────────────────────────────────
def load_gold(path=None):
    """读 nllb-crossattn-gold.json，返回 cases 列表"""
    if path is None:
        path = GOLD_FIXTURE_DEFAULT
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data["cases"]


# ─── 主入口：评估 + 输出 ────────────────────────────────
def run_benchmark(predictions=None, gold_path=None, label="phase8-finetune",
                  out_dir=None, baseline_f1=BASELINE_F1):
    """
    跑 benchmark。
    - predictions=None → 模拟 baseline（金标准 = 预测），F1=1.0（dry-run 友好）
    - 返回 {per_case, macro_f1, micro_f1, baseline_compare, json_path}
    """
    cases = load_gold(gold_path)
    gold_sets = _set_alignments(cases)
    case_names = [c["src"] for c in cases]

    if predictions is None:
        predictions = gold_sets
        label = label + "-dryrun-pred=gold"

    if len(predictions) != len(gold_sets):
        raise ValueError(f"predictions {len(predictions)} != gold {len(gold_sets)}")

    result = evaluate_predictions(predictions, gold_sets, case_names)
    result["label"] = label
    result["baseline"] = baseline_f1
    result["compare"] = compare_to_baseline(result["macro_f1"], baseline_f1)
    result["timestamp"] = int(time.time())

    if out_dir is None:
        out_dir = Path(__file__).resolve().parent / "benchmark" / "results"
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y-%m-%dT%H-%M-%S", time.localtime(result["timestamp"]))
    json_path = out_dir / f"phase8-finetune-{ts}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    result["json_path"] = str(json_path)
    return result


# ─── 打印 ────────────────────────────────────────────────
def print_table(result):
    print("─" * 72)
    print(f"{'#':<3}{'case (src)':<40}{'P':>6}{'R':>6}{'F1':>6}{'TP':>4}{'FP':>4}{'FN':>4}")
    print("─" * 72)
    for i, c in enumerate(result["per_case"]):
        name = c["case"][:38]
        print(f"{i:<3}{name:<40}{c['p']:>6.3f}{c['r']:>6.3f}{c['f1']:>6.3f}{c['tp']:>4}{c['fp']:>4}{c['fn']:>4}")
    print("─" * 72)
    print(f"{'macro F1':<46}{'':>9}{result['macro_f1']:>6.3f}")
    print(f"{'micro F1':<46}{'':>9}{result['micro_f1']:>6.3f}")
    print(f"{'baseline (Phase 6 L0H15)':<46}{'':>9}{result['baseline']:>6.3f}")
    cmp_ = result["compare"]
    sign = "+" if cmp_["delta"] >= 0 else ""
    flag = "✓ 改进" if cmp_["improved"] else ("✗ 退化" if cmp_["regression"] else "≈ 持平")
    print(f"{'delta':<46}{'':>9}{sign}{cmp_['delta']:>6.3f}  {flag}")
    print("─" * 72)
    print(f"JSON: {result.get('json_path', '(no json path)')}")


# ─── CLI ────────────────────────────────────────────────
def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="Phase 8 alignment head 微调 8-case 金标准评估")
    parser.add_argument("--gold", type=str, help="金标准 JSON 路径")
    parser.add_argument("--baseline", type=float, default=BASELINE_F1, help="基线 F1（默认 Phase 6=0.851）")
    parser.add_argument("--dry-run", action="store_true", help="用金标准作预测（dry-run 上限检查）")
    parser.add_argument("--out-dir", type=str, help="结果 JSON 输出目录")
    args = parser.parse_args(argv)

    gold_path = Path(args.gold) if args.gold else None
    out_dir = Path(args.out_dir) if args.out_dir else None

    print("[dry-run] 用金标准作预测（理论上限 F1=1.0）" if args.dry_run else
          "[benchmark] predictions=None → dry-run 模式")
    result = run_benchmark(predictions=None, gold_path=gold_path, out_dir=out_dir, baseline_f1=args.baseline)
    print_table(result)
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
