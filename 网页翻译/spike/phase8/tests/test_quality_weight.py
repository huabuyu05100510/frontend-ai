"""
测试 quality weight —— 方案 §6.4
高频标注者（≥50 条）权重 2x；新用户（<10 条）权重 0.5x
"""
import pytest
from quality_weight import compute_user_weights, weighted_agreement


def _mk_user_history(name, count):
    return {name: count}


def test_heavy_user_weight_2x():
    """标注者标 50 条以上 → 权重 2.0"""
    history = _mk_user_history("power_user", 50)
    weights = compute_user_weights(history)
    assert weights["power_user"] == 2.0


def test_new_user_weight_half():
    """标注者 <10 条 → 权重 0.5"""
    history = _mk_user_history("new_user", 5)
    weights = compute_user_weights(history)
    assert weights["new_user"] == 0.5


def test_normal_user_weight_one():
    """中等活跃（10-49 条）→ 权重 1.0"""
    history = _mk_user_history("regular", 25)
    weights = compute_user_weights(history)
    assert weights["regular"] == 1.0


def test_mixed_user_weights():
    """混合多用户：边界判断正确"""
    history = {
        "veteran": 200,   # 2.0
        "regular": 25,    # 1.0
        "newbie": 3,      # 0.5
        "edge_50": 50,    # ≥50 → 2.0
        "edge_10": 10,    # =10 → 1.0（非 <10）
    }
    weights = compute_user_weights(history)
    assert weights["veteran"] == 2.0
    assert weights["regular"] == 1.0
    assert weights["newbie"] == 0.5
    assert weights["edge_50"] == 2.0
    assert weights["edge_10"] == 1.0


def test_weighted_agreement_majority_wins_despite_weight():
    """加权后少数但高权重可以翻盘：2 power(2x) vs 3 newbie(0.5x)
       score = 4 vs 1.5 → power 胜"""
    annotations = [
        {"tgtIdx": 1, "userId": "p1"},
        {"tgtIdx": 1, "userId": "p2"},
        {"tgtIdx": 2, "userId": "n1"},
        {"tgtIdx": 2, "userId": "n2"},
        {"tgtIdx": 2, "userId": "n3"},
    ]
    user_history = {"p1": 100, "p2": 100, "n1": 2, "n2": 2, "n3": 2}
    weights = compute_user_weights(user_history)
    winner, total_weight, agreement = weighted_agreement(annotations, weights)
    assert winner == 1
    # tgt=1 weight = 2+2 = 4; tgt=2 weight = 0.5*3 = 1.5
    assert total_weight == 5.5
    assert agreement == 4 / 5.5


def test_weighted_agreement_handles_unknown_user():
    """未在 history 中的用户 → 默认权重 1.0"""
    annotations = [
        {"tgtIdx": 1, "userId": "unknown"},
        {"tgtIdx": 2, "userId": "unknown2"},
    ]
    weights = {}  # 空 history
    winner, total, agreement = weighted_agreement(annotations, weights)
    # 都是 1.0 → 平票 → 取先出现的 1
    assert winner == 1
    assert total == 2.0
