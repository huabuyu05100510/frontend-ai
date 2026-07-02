"""
测试 majority vote —— 方案 §6.4
同一 (srcSegmentId, srcTokenIdx) 多用户标 → 众数；冲突率 >30% 弃用
"""
import pytest
from majority_vote import vote_for_segment, ConflictTooHighError


# ─── 单 segment 投票 ─────────────────────────────────────
def test_three_users_same_choice_majority_wins():
    """3 用户全标同一 tgt → 众数即该 tgt"""
    annos = [
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 5, "userId": "u-a"},
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 5, "userId": "u-b"},
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 5, "userId": "u-c"},
    ]
    result = vote_for_segment(annos)
    assert result == {"tgtIdx": 5, "agreementRate": 1.0, "dropped": False}


def test_majority_vote_picks_mode():
    """3 用户 2 选 A 1 选 B → A 胜"""
    annos = [
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 5, "userId": "u-a"},
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 5, "userId": "u-b"},
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 7, "userId": "u-c"},
    ]
    result = vote_for_segment(annos)
    assert result == {"tgtIdx": 5, "agreementRate": 2 / 3, "dropped": False}


def test_tie_picks_first_seen():
    """2-2 平票 → 取先出现的（稳定排序）"""
    annos = [
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 5, "userId": "u-a"},
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 7, "userId": "u-b"},
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 7, "userId": "u-c"},
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 5, "userId": "u-d"},
    ]
    result = vote_for_segment(annos)
    # 5 (u-a) 先于 7 (u-b) 出现 → 取 5
    assert result["tgtIdx"] == 5
    assert result["agreementRate"] == 0.5


# ─── 冲突率 >30% 弃用 ────────────────────────────────────
def test_high_conflict_drops_segment():
    """4 用户标 4 个不同 tgtIdx → 冲突率 1.0 → 弃用"""
    annos = [
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 1, "userId": "u-a"},
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 2, "userId": "u-b"},
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 3, "userId": "u-c"},
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 4, "userId": "u-d"},
    ]
    result = vote_for_segment(annos, conflict_threshold=0.30)
    # 冲突率 1 - 1/4 = 0.75 > 0.30 → dropped=True, tgtIdx=None
    assert result["dropped"] is True
    assert result["tgtIdx"] is None
    assert result["agreementRate"] == 0.25


def test_conflict_threshold_boundary_30_percent():
    """冲突率正好 30% → 不弃用（边界 ≤）"""
    # 3 标全不同 → agreementRate=1/3, conflict=2/3 → drop
    # 改：4 标，3 同 1 不同 → agreementRate=0.75, conflict=0.25 → keep
    annos = [
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 5, "userId": "u-a"},
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 5, "userId": "u-b"},
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 5, "userId": "u-c"},
        {"srcSegmentId": "seg-1", "srcTokenIdx": 2, "correctedTgtTokenIdx": 7, "userId": "u-d"},
    ]
    result = vote_for_segment(annos, conflict_threshold=0.30)
    # conflict = 1 - 0.75 = 0.25 < 0.30 → keep
    assert result["dropped"] is False
    assert result["tgtIdx"] == 5


def test_empty_input_returns_dropped():
    """空输入 → 弃用"""
    result = vote_for_segment([])
    assert result["dropped"] is True
    assert result["tgtIdx"] is None
