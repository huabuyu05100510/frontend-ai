"""
测试 data —— JSONL → DataLoader
按 (srcSegmentId, srcTokenIdx) 聚合，过滤非 ALIGN_FIX
"""
import json
import pytest
from pathlib import Path
from data import (
    parse_jsonl,
    iter_align_fix,
    build_examples,
    collect_stats,
    AlignExample,
    DataStats,
)


# ─── 共享 fixture 数据 ───────────────────────────────────
SAMPLE_LINES = [
    # ALIGN_FIX 标 1（应被采纳）
    {
        "id": "a1", "kind": "align_fix", "schemaVersion": 1,
        "url": "https://a.com/1", "domPath": "/html/body/p",
        "srcSegmentId": "seg-1", "langPair": ["en", "zh"],
        "srcText": "The cat is sleeping", "tgtText": "猫在睡觉",
        "srcTokens": ["The", "cat", "is", "sleeping"],
        "tgtTokens": ["猫", "在", "睡觉"],
        "predicted": [[0, 0], [1, 1]],
        "modelVersion": "nllb-600m-l0h15-v1",
        "payload": {"srcTokenIdx": 1, "predictedTgtTokenIdx": 1, "correctedTgtTokenIdx": 1, "correctionKind": "change"},
        "context": {"prevSrc": "", "nextSrc": ""},
        "createdAt": 1000,
    },
    # SEG_RATING（应被过滤）
    {
        "id": "b1", "kind": "seg_rating", "schemaVersion": 1,
        "url": "https://a.com/1", "domPath": "/html/body/p",
        "srcSegmentId": "seg-1", "langPair": ["en", "zh"],
        "srcText": "The cat", "tgtText": "猫",
        "srcTokens": ["The", "cat"], "tgtTokens": ["猫"],
        "predicted": [], "modelVersion": "nllb-600m-l0h15-v1",
        "payload": {"rating": 5},
        "createdAt": 1001,
    },
    # ALIGN_FIX 标 2（同一 seg 同一 token，不同 user）
    {
        "id": "a2", "kind": "align_fix", "schemaVersion": 1,
        "url": "https://a.com/1", "domPath": "/html/body/p",
        "srcSegmentId": "seg-1", "langPair": ["en", "zh"],
        "srcText": "The cat is sleeping", "tgtText": "猫在睡觉",
        "srcTokens": ["The", "cat", "is", "sleeping"],
        "tgtTokens": ["猫", "在", "睡觉"],
        "predicted": [[0, 0], [1, 1]],
        "modelVersion": "nllb-600m-l0h15-v1",
        "payload": {"srcTokenIdx": 1, "predictedTgtTokenIdx": 1, "correctedTgtTokenIdx": 2, "correctionKind": "change"},
        "createdAt": 1002,
    },
]


def _write_jsonl(tmp_path, lines):
    p = tmp_path / "annos.jsonl"
    with p.open("w", encoding="utf-8") as f:
        for line in lines:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
    return p


# ─── 解析 JSONL ─────────────────────────────────────────
def test_parse_jsonl_basic(tmp_path):
    """正确解析 N 行 JSONL"""
    p = _write_jsonl(tmp_path, SAMPLE_LINES)
    records = list(parse_jsonl(p))
    assert len(records) == 3
    assert records[0]["id"] == "a1"
    assert records[1]["kind"] == "seg_rating"


def test_parse_jsonl_skips_invalid_json(tmp_path):
    """无效 JSON 行 → 跳过"""
    p = tmp_path / "bad.jsonl"
    p.write_text("{invalid json\n" + json.dumps(SAMPLE_LINES[0]) + "\n", encoding="utf-8")
    records = list(parse_jsonl(p))
    assert len(records) == 1


# ─── 过滤 ALIGN_FIX ─────────────────────────────────────
def test_iter_align_fix_filters_only_align_kind(tmp_path):
    """只保留 kind=align_fix"""
    p = _write_jsonl(tmp_path, SAMPLE_LINES)
    fixes = list(iter_align_fix(p))
    assert len(fixes) == 2
    # AlignFixAnnotation 是 dataclass
    assert all(getattr(f, "id", None) in ("a1", "a2") for f in fixes)


# ─── build_examples 聚合 ────────────────────────────────
def test_build_examples_groups_by_seg_token(tmp_path):
    """相同 (srcSegmentId, srcTokenIdx) 聚合"""
    p = _write_jsonl(tmp_path, SAMPLE_LINES)
    examples = build_examples(p)
    # seg-1, srcTokenIdx=1 聚合 2 条；其他无 → 共 1 个 example group
    assert len(examples) == 1
    ex = examples[0]
    assert ex.src_segment_id == "seg-1"
    assert ex.src_token_idx == 1
    assert len(ex.annotations) == 2


def test_build_examples_skips_missing_payload(tmp_path):
    """payload 缺字段 → 跳过该条"""
    bad = dict(SAMPLE_LINES[0])
    bad["payload"] = {"srcTokenIdx": 1}  # 缺 correctedTgtTokenIdx
    p = _write_jsonl(tmp_path, [bad])
    examples = build_examples(p)
    assert examples == []


def test_build_examples_computes_data_stats(tmp_path):
    """DataStats 统计正确（用 collect_stats 拿全量 raw/af 计数）"""
    p = _write_jsonl(tmp_path, SAMPLE_LINES)
    stats = collect_stats(p)
    assert stats.total_raw == 3
    assert stats.total_align_fix == 2
    assert stats.total_examples == 1
    assert stats.unique_urls == 1
    assert stats.unique_lang_pairs == 1
