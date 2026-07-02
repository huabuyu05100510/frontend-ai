"""
gate.py —— 方案 §6.3 数据准入门槛
- ≥500 标注 / ≥10 URL / ≥3 lang pair

CLI: python gate.py --samples 499 --urls 12 --lang-pairs 4
     python gate.py --json stats.json

模型: MiniMax-M3
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Dict, Any, Optional


# ─── 默认阈值（方案 §6.3） ──────────────────────────────
DEFAULT_MIN_SAMPLES = 500
DEFAULT_MIN_URLS = 10
DEFAULT_MIN_LANG_PAIRS = 3

CONFLICT_THRESHOLD = 0.30  # majority_vote 用


@dataclass(frozen=True)
class GateConfig:
    min_samples: int = DEFAULT_MIN_SAMPLES
    min_urls: int = DEFAULT_MIN_URLS
    min_lang_pairs: int = DEFAULT_MIN_LANG_PAIRS


@dataclass
class GateResult:
    ready: bool
    current: Dict[str, int]
    missing: Dict[str, int]
    thresholds: Dict[str, int]

    @property
    def missing_samples(self) -> int:
        return self.missing.get("samples", 0)

    @property
    def missing_urls(self) -> int:
        return self.missing.get("urls", 0)

    @property
    def missing_lang_pairs(self) -> int:
        return self.missing.get("langPairs", 0)


class GateNotMetError(Exception):
    """准入门槛未达到"""

    def __init__(self, missing: Dict[str, int], current: Dict[str, int], thresholds: Dict[str, int]):
        self.missing = missing
        self.current = current
        self.thresholds = thresholds
        super().__init__(format_missing(missing))


def check_gate(
    stats: Dict[str, Any],
    config: Optional[GateConfig] = None,
    raise_on_fail: bool = False,
) -> GateResult:
    """
    检查是否达到训练门槛。

    stats: {samples, urls, langPairs}
    """
    if config is None:
        config = GateConfig()

    samples = int(stats.get("samples", 0))
    urls = int(stats.get("urls", 0))
    lang_pairs = int(stats.get("langPairs", 0))

    missing = {
        "samples": max(0, config.min_samples - samples),
        "urls": max(0, config.min_urls - urls),
        "langPairs": max(0, config.min_lang_pairs - lang_pairs),
    }
    thresholds = {
        "samples": config.min_samples,
        "urls": config.min_urls,
        "langPairs": config.min_lang_pairs,
    }
    current = {
        "samples": samples,
        "urls": urls,
        "langPairs": lang_pairs,
    }
    ready = all(v == 0 for v in missing.values())

    if raise_on_fail and not ready:
        raise GateNotMetError(missing, current, thresholds)

    return GateResult(ready=ready, current=current, missing=missing, thresholds=thresholds)


def format_missing(missing: Dict[str, int]) -> str:
    """中文友好提示"""
    parts = []
    if missing["samples"] > 0:
        parts.append(f"还差 {missing['samples']} 条标注")
    if missing["urls"] > 0:
        parts.append(f"还差 {missing['urls']} 个 URL")
    if missing["langPairs"] > 0:
        parts.append(f"还差 {missing['langPairs']} 个语言对")
    if not parts:
        return "已满足训练门槛 ✓"
    return "距下次可微调：" + "；".join(parts)


# ─── CLI 入口 ────────────────────────────────────────────
def _print_table(result: GateResult) -> None:
    print("─" * 56)
    print(f"{'指标':<12}{'当前':>8}{'门槛':>8}{'差值':>8}{'状态':>8}")
    print("─" * 56)
    rows = [
        ("样本数", result.current["samples"], result.thresholds["samples"], result.missing["samples"]),
        ("URL 数", result.current["urls"], result.thresholds["urls"], result.missing["urls"]),
        ("语言对", result.current["langPairs"], result.thresholds["langPairs"], result.missing["langPairs"]),
    ]
    for name, cur, thr, miss in rows:
        ok = "✓" if miss == 0 else "✗"
        print(f"{name:<10}{cur:>8}{thr:>8}{miss:>8}{ok:>8}")
    print("─" * 56)
    print(format_missing(result.missing))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="检查 alignment head 微调准入门槛（方案 §6.3）")
    parser.add_argument("--samples", type=int, help="当前标注数")
    parser.add_argument("--urls", type=int, help="当前 URL 数")
    parser.add_argument("--lang-pairs", type=int, help="当前 lang pair 数")
    parser.add_argument("--json", type=str, help="从 JSON 文件读 stats")
    parser.add_argument("--export-stats-url", type=str, default=os.environ.get("ANNOTATION_STATS_URL"),
                        help="从 HTTP 端点拉 stats（如 http://localhost:3001/v1/annotations/stats）")
    parser.add_argument("--raise", action="store_true", dest="do_raise", help="未达门槛时抛异常")
    args = parser.parse_args(argv)

    stats: Dict[str, Any] = {}

    if args.json:
        with open(args.json, "r", encoding="utf-8") as f:
            stats = json.load(f)
    elif args.export_stats_url:
        try:
            import urllib.request
            with urllib.request.urlopen(args.export_stats_url, timeout=5) as resp:
                stats = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"[错误] 无法拉取 stats: {e}", file=sys.stderr)
            return 2
    elif args.samples is not None and args.urls is not None and args.lang_pairs is not None:
        stats = {"samples": args.samples, "urls": args.urls, "langPairs": args.lang_pairs}
    else:
        parser.error("需要 --samples/--urls/--lang-pairs 或 --json 或 --export-stats-url")

    try:
        result = check_gate(stats, raise_on_fail=args.do_raise)
    except GateNotMetError as e:
        print(f"[未达门槛] {e}", file=sys.stderr)
        return 1

    _print_table(result)
    return 0 if result.ready else 1


if __name__ == "__main__":
    sys.exit(main())
