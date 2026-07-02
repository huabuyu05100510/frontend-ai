"""
data.py —— JSONL → DataLoader
- 读 server/annotation 导出的 NDJSON
- 过滤 kind=align_fix
- 按 (srcSegmentId, srcTokenIdx) 聚合
- 跳过 schema 不合规的记录

模型: MiniMax-M3
"""
from __future__ import annotations
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Dict, Any, Iterator, Optional, Iterable


REQUIRED_PAYLOAD_KEYS = {"srcTokenIdx", "predictedTgtTokenIdx", "correctedTgtTokenIdx", "correctionKind"}


@dataclass
class AlignFixAnnotation:
    """单条对齐修正标注（已解码 payload）"""
    id: str
    url: str
    src_segment_id: str
    lang_pair: tuple  # (src, tgt)
    src_text: str
    tgt_text: str
    src_tokens: List[str]
    tgt_tokens: List[str]
    predicted: List[tuple]  # [[srcIdx, tgtIdx]]
    model_version: str
    src_token_idx: int
    predicted_tgt_token_idx: int
    corrected_tgt_token_idx: Optional[int]
    correction_kind: str  # 'change' | 'remove' | 'add'
    user_id: str = ""
    created_at: int = 0


@dataclass
class AlignExample:
    """一个 (srcSegmentId, srcTokenIdx) 上聚合的多标注"""
    src_segment_id: str
    src_token_idx: int
    src_text: str
    tgt_text: str
    src_tokens: List[str]
    tgt_tokens: List[str]
    predicted: List[tuple]
    lang_pair: tuple
    url: str
    annotations: List[AlignFixAnnotation] = field(default_factory=list)


@dataclass
class DataStats:
    total_raw: int
    total_align_fix: int
    total_examples: int
    unique_urls: int
    unique_lang_pairs: int
    source_file: str

    @classmethod
    def from_examples(cls, examples: List[AlignExample], source_file: str = "", total_raw: int = 0, total_align_fix: int = 0) -> "DataStats":
        urls = {e.url for e in examples}
        langs = {e.lang_pair for e in examples}
        return cls(
            total_raw=total_raw,
            total_align_fix=total_align_fix,
            total_examples=len(examples),
            unique_urls=len(urls),
            unique_lang_pairs=len(langs),
            source_file=source_file,
        )

    def to_gate_stats(self) -> Dict[str, int]:
        """转成 gate.py 期望的 stats dict"""
        return {
            "samples": self.total_align_fix,
            "urls": self.unique_urls,
            "langPairs": self.unique_lang_pairs,
        }


# ─── JSONL 解析 ─────────────────────────────────────────
def parse_jsonl(path: Path) -> Iterator[Dict[str, Any]]:
    """逐行解析 NDJSON，坏行跳过 + 警告"""
    with open(path, "r", encoding="utf-8") as f:
        for ln, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError as e:
                print(f"[data] 跳过坏行 {ln}: {e}", file=__import__("sys").stderr)


def _to_align_fix(raw: Dict[str, Any], user_id: str = "") -> Optional[AlignFixAnnotation]:
    """校验 + 转换单条 raw dict → AlignFixAnnotation；失败返回 None"""
    if raw.get("kind") != "align_fix":
        return None
    payload = raw.get("payload") or {}
    if not REQUIRED_PAYLOAD_KEYS.issubset(payload.keys()):
        return None
    lang_pair = raw.get("langPair") or raw.get("lang_pair") or ("", "")
    if isinstance(lang_pair, str):
        lang_pair = tuple(lang_pair.split("-", 1)) if "-" in lang_pair else (lang_pair, "")
    elif isinstance(lang_pair, list):
        lang_pair = tuple(lang_pair)
    return AlignFixAnnotation(
        id=raw.get("id", ""),
        url=raw.get("url", ""),
        src_segment_id=raw.get("srcSegmentId", ""),
        lang_pair=lang_pair,
        src_text=raw.get("srcText", ""),
        tgt_text=raw.get("tgtText", ""),
        src_tokens=list(raw.get("srcTokens", [])),
        tgt_tokens=list(raw.get("tgtTokens", [])),
        predicted=[tuple(p) for p in raw.get("predicted", []) if isinstance(p, (list, tuple)) and len(p) == 2],
        model_version=raw.get("modelVersion", ""),
        src_token_idx=int(payload["srcTokenIdx"]),
        predicted_tgt_token_idx=int(payload["predictedTgtTokenIdx"]),
        corrected_tgt_token_idx=(int(payload["correctedTgtTokenIdx"]) if payload["correctedTgtTokenIdx"] is not None else None),
        correction_kind=str(payload["correctionKind"]),
        user_id=user_id,
        created_at=int(raw.get("createdAt", 0)),
    )


def iter_align_fix(path: Path, user_id: str = "") -> Iterator[AlignFixAnnotation]:
    """只产 align_fix 类型的 AlignFixAnnotation"""
    for raw in parse_jsonl(path):
        af = _to_align_fix(raw, user_id=user_id)
        if af is not None:
            yield af


def build_examples(path: Path) -> List[AlignExample]:
    """按 (srcSegmentId, srcTokenIdx) 聚合"""
    groups: Dict[tuple, AlignExample] = {}
    for af in iter_align_fix(path):
        key = (af.src_segment_id, af.src_token_idx)
        if key not in groups:
            groups[key] = AlignExample(
                src_segment_id=af.src_segment_id,
                src_token_idx=af.src_token_idx,
                src_text=af.src_text,
                tgt_text=af.tgt_text,
                src_tokens=list(af.src_tokens),
                tgt_tokens=list(af.tgt_tokens),
                predicted=list(af.predicted),
                lang_pair=af.lang_pair,
                url=af.url,
            )
        groups[key].annotations.append(af)
    return list(groups.values())


def collect_stats(path: Path) -> DataStats:
    """一次性统计：raw 行数 + align_fix 数 + 聚合后 example 数"""
    raw_count = 0
    af_count = 0
    for raw in parse_jsonl(path):
        raw_count += 1
        if raw.get("kind") == "align_fix":
            af_count += 1
    examples = build_examples(path)
    return DataStats.from_examples(examples, source_file=str(path), total_raw=raw_count, total_align_fix=af_count)
