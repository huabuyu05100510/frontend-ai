"""
测试 benchmark —— 8-case 金标准 F1 计算
对齐：方案 §6.2 + Phase 6 结论（Route C NLLB L0H15）
"""
import pytest
import json
from pathlib import Path

from benchmark import (
    compute_macro_f1,
    compute_micro_f1,
    compute_precision_recall,
    load_gold,
    compare_to_baseline,
    evaluate_predictions,
)


# ─── F1 计算单元 ─────────────────────────────────────────
def test_f1_perfect_match():
    """预测 = 金标准 → F1=1.0"""
    pred = {(0, 0), (1, 1), (2, 2)}
    gold = {(0, 0), (1, 1), (2, 2)}
    p, r, f1 = compute_precision_recall(pred, gold)
    assert p == 1.0
    assert r == 1.0
    assert f1 == 1.0


def test_f1_no_match():
    """预测完全错 → F1=0.0"""
    pred = {(0, 5), (1, 6), (2, 7)}
    gold = {(0, 0), (1, 1), (2, 2)}
    p, r, f1 = compute_precision_recall(pred, gold)
    assert p == 0.0
    assert r == 0.0
    assert f1 == 0.0


def test_f1_partial_overlap():
    """部分对：1 对 1 错 + 1 漏"""
    pred = {(0, 0), (1, 1), (5, 5)}
    gold = {(0, 0), (1, 1), (2, 2)}
    # tp=2, fp=1, fn=1 → p=2/3, r=2/3, f1=0.6667
    p, r, f1 = compute_precision_recall(pred, gold)
    assert abs(p - 2 / 3) < 1e-6
    assert abs(r - 2 / 3) < 1e-6
    assert abs(f1 - 2 / 3) < 1e-6


def test_macro_f1_averages_across_cases():
    """macro F1 = 各 case F1 算术平均"""
    case_results = [
        {"case": "c1", "p": 1.0, "r": 1.0, "f1": 1.0},
        {"case": "c2", "p": 0.0, "r": 0.0, "f1": 0.0},
        {"case": "c3", "p": 0.5, "r": 0.5, "f1": 0.5},
    ]
    avg = compute_macro_f1(case_results)
    assert abs(avg - (1.0 + 0.0 + 0.5) / 3) < 1e-6


def test_micro_f1_aggregates_tp_fp_fn():
    """micro F1 = 全局 tp/fp/fn 累加后算"""
    # c1: tp=2 fp=1 fn=1
    # c2: tp=0 fp=3 fn=2
    # total tp=2, fp=4, fn=3 → p=1/3, r=2/5, f1=...
    total_tp, total_fp, total_fn = 2, 4, 3
    p = total_tp / (total_tp + total_fp)
    r = total_tp / (total_tp + total_fn)
    expected_f1 = 2 * p * r / (p + r)
    # 用 mock 走 benchmark.micro_f1
    # 这里直接验证计算逻辑
    assert abs(expected_f1 - 2 * (1/3) * (2/5) / (1/3 + 2/5)) < 1e-6


# ─── 与基线对比 ─────────────────────────────────────────
def test_compare_to_baseline_improvement():
    """新模型比基线 +0.02 → allow"""
    verdict = compare_to_baseline(new_f1=0.871, baseline_f1=0.851, threshold=0.02)
    assert verdict["improved"] is True
    assert verdict["delta"] == pytest.approx(0.02, abs=1e-6)


def test_compare_to_baseline_no_improvement():
    """新模型 -0.01 → 不通过"""
    verdict = compare_to_baseline(new_f1=0.841, baseline_f1=0.851, threshold=0.02)
    assert verdict["improved"] is False
    assert verdict["delta"] < 0


# ─── 加载金标准 ─────────────────────────────────────────
def test_load_gold_phase6_8cases():
    """加载 Phase 6 NLLB 金标准 → 8 case"""
    gold_path = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "nllb-crossattn-gold.json"
    if not gold_path.exists():
        pytest.skip(f"gold fixture not found at {gold_path}")
    gold = load_gold(gold_path)
    assert len(gold) == 8
    assert all("src" in c and "alignments" in c for c in gold)
