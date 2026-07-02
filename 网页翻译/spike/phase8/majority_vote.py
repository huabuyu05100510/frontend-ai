"""
majority_vote.py —— 方案 §6.4 冲突解决
同一 (srcSegmentId, srcTokenIdx) 多用户标 → 众数；冲突 > 30% 弃用

模型: MiniMax-M3
"""
from __future__ import annotations
from collections import Counter
from typing import List, Dict, Any, Optional


class ConflictTooHighError(Exception):
    """冲突率超过阈值的标注组（用于调试/单独处理）"""
    pass


def vote_for_segment(
    annotations: List[Dict[str, Any]],
    conflict_threshold: float = 0.50,
) -> Dict[str, Any]:
    """
    对同一 (srcSegmentId, srcTokenIdx) 的多条标注做众数投票。

    返回: {tgtIdx, agreementRate, dropped}
      - tgtIdx: 胜出的 tgt token idx（dropped=True 时为 None）
      - agreementRate: 胜出票数 / 总票数
      - dropped: 是否因冲突过高被弃用
    """
    if not annotations:
        return {"tgtIdx": None, "agreementRate": 0.0, "dropped": True}

    # 收集票（保持首次出现顺序，平票时取先到的）
    counts: Counter = Counter()
    order: List[int] = []
    for a in annotations:
        idx = a.get("correctedTgtTokenIdx")
        if idx is None:
            # 用户标"无对应词"——按 -1 处理（null 票）或不计入
            # 这里把它视作一个特殊票，便于识别
            idx = -1
        counts[idx] += 1
        if idx not in order:
            order.append(idx)

    # 选众数；平票时取最先出现
    top_count = max(counts.values())
    winners = [k for k in order if counts[k] == top_count]
    winner = winners[0]  # 平票取先

    n_total = len(annotations)
    agreement = top_count / n_total
    conflict = 1.0 - agreement
    dropped = conflict > conflict_threshold

    return {
        "tgtIdx": winner if not dropped else None,
        "agreementRate": agreement,
        "dropped": dropped,
    }


def group_annotations(
    annotations: List[Dict[str, Any]],
) -> Dict[tuple, List[Dict[str, Any]]]:
    """按 (srcSegmentId, srcTokenIdx) 聚合"""
    groups: Dict[tuple, List[Dict[str, Any]]] = {}
    for a in annotations:
        if a.get("kind") != "align_fix":
            continue
        key = (a["srcSegmentId"], a["payload"]["srcTokenIdx"])
        groups.setdefault(key, []).append(a)
    return groups


def vote_all(
    annotations: List[Dict[str, Any]],
    conflict_threshold: float = 0.30,
) -> List[Dict[str, Any]]:
    """
    对所有标注做投票，返回每个 (seg, token) 的投票结果。
    输出含 srcSegmentId + srcTokenIdx 便于后续 join。
    """
    groups = group_annotations(annotations)
    out = []
    for (seg, token), annos in groups.items():
        v = vote_for_segment(annos, conflict_threshold=conflict_threshold)
        v["srcSegmentId"] = seg
        v["srcTokenIdx"] = token
        out.append(v)
    return out
