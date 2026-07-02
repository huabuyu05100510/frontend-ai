"""
quality_weight.py —— 方案 §6.4 质量加权
高频标注者（≥50 条）权重 2x；新用户（<10 条）权重 0.5x

模型: MiniMax-M3
"""
from __future__ import annotations
from collections import defaultdict
from typing import Dict, List, Any, Tuple


# ─── 阈值常量 ────────────────────────────────────────────
HEAVY_THRESHOLD = 50  # ≥50 条 → 重度用户
NEW_THRESHOLD = 10    # <10 条 → 新用户

WEIGHT_HEAVY = 2.0
WEIGHT_NORMAL = 1.0
WEIGHT_NEW = 0.5


def classify_user(annotation_count: int) -> str:
    """返回用户类别"""
    if annotation_count >= HEAVY_THRESHOLD:
        return "heavy"
    if annotation_count < NEW_THRESHOLD:
        return "new"
    return "normal"


def compute_user_weights(user_history: Dict[str, int]) -> Dict[str, float]:
    """
    输入: {userId: 累计标注数}
    输出: {userId: 权重}
    """
    weights = {}
    for uid, cnt in user_history.items():
        cat = classify_user(cnt)
        if cat == "heavy":
            weights[uid] = WEIGHT_HEAVY
        elif cat == "new":
            weights[uid] = WEIGHT_NEW
        else:
            weights[uid] = WEIGHT_NORMAL
    return weights


def weighted_agreement(
    annotations: List[Dict[str, Any]],
    user_weights: Dict[str, float],
    default_weight: float = WEIGHT_NORMAL,
) -> Tuple[int, float, float]:
    """
    加权投票决定 tgtIdx。
    返回 (winner_tgtIdx, total_weight, top_weight_fraction)

    平票策略：总权重相同时取首次出现。
    """
    if not annotations:
        return -1, 0.0, 0.0

    weights_by_choice: Dict[int, float] = defaultdict(float)
    order: List[int] = []
    total = 0.0

    for a in annotations:
        uid = a.get("userId", "")
        w = user_weights.get(uid, default_weight)
        idx = a.get("tgtIdx")
        if idx is None:
            idx = -1
        weights_by_choice[idx] += w
        if idx not in order:
            order.append(idx)
        total += w

    top = max(weights_by_choice.values())
    winners = [k for k in order if weights_by_choice[k] == top]
    return winners[0], total, top / total if total > 0 else 0.0


def build_user_history(annotations: List[Dict[str, Any]]) -> Dict[str, int]:
    """从标注列表构建 user → 标注数（用于 compute_user_weights）"""
    history: Dict[str, int] = defaultdict(int)
    for a in annotations:
        uid = a.get("userId", "")
        if uid:
            history[uid] += 1
    return dict(history)
