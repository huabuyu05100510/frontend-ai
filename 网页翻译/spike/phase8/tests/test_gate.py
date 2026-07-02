"""
测试 gate —— 方案 §6.3
准入门槛：≥500 标注 / ≥10 URL / ≥3 lang pair
"""
import pytest
from gate import (
    GateNotMetError,
    check_gate,
    GateConfig,
    format_missing,
)


def test_gate_met_when_all_thresholds_satisfied():
    """500/10/3 全满足 → 不抛异常"""
    stats = {"samples": 500, "urls": 10, "langPairs": 3}
    config = GateConfig(min_samples=500, min_urls=10, min_lang_pairs=3)
    result = check_gate(stats, config)
    assert result.ready is True
    assert result.missing_samples == 0
    assert result.missing_urls == 0
    assert result.missing_lang_pairs == 0


def test_gate_not_met_when_samples_short():
    """样本 499/500 → 未达门槛"""
    stats = {"samples": 499, "urls": 50, "langPairs": 5}
    config = GateConfig(min_samples=500, min_urls=10, min_lang_pairs=3)
    result = check_gate(stats, config)
    assert result.ready is False
    assert result.missing_samples == 1
    assert result.missing_urls == 0


def test_gate_not_met_when_urls_short():
    """URLs 9/10 → 未达"""
    stats = {"samples": 1000, "urls": 9, "langPairs": 5}
    config = GateConfig(min_samples=500, min_urls=10, min_lang_pairs=3)
    result = check_gate(stats, config)
    assert result.ready is False
    assert result.missing_urls == 1


def test_gate_not_met_when_langpairs_short():
    """langPairs 2/3 → 未达"""
    stats = {"samples": 1000, "urls": 20, "langPairs": 2}
    config = GateConfig(min_samples=500, min_urls=10, min_lang_pairs=3)
    result = check_gate(stats, config)
    assert result.ready is False
    assert result.missing_lang_pairs == 1


def test_gate_raises_when_required():
    """raise_on_fail=True → 抛 GateNotMetError"""
    stats = {"samples": 100, "urls": 5, "langPairs": 2}
    config = GateConfig(min_samples=500, min_urls=10, min_lang_pairs=3)
    with pytest.raises(GateNotMetError) as exc_info:
        check_gate(stats, config, raise_on_fail=True)
    err = exc_info.value
    assert err.missing["samples"] == 400
    assert err.missing["urls"] == 5
    assert err.missing["langPairs"] == 1


def test_format_missing_chinese():
    """format_missing 返回中文友好文本"""
    missing = {"samples": 400, "urls": 5, "langPairs": 1}
    msg = format_missing(missing)
    assert "400" in msg
    assert "5" in msg
    assert "1" in msg
    # 必须是中文
    assert any("\u4e00" <= c <= "\u9fff" for c in msg)


def test_gate_boundary_exact_match():
    """正好达到门槛 → ready=True"""
    stats = {"samples": 500, "urls": 10, "langPairs": 3}
    config = GateConfig()
    result = check_gate(stats, config)
    assert result.ready is True
