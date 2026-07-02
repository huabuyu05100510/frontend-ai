"""
测试 model —— NLLB 加载 + 冻结/解冻 alignment head
不下载真模型：用 mock + 离线 mini model（transformers 自带 tiny 测试模型）
"""
import pytest


def test_freeze_all_except_alignment_head_logic():
    """测试冻结/解冻逻辑本身（不依赖真模型）"""
    # 用 mock 模型对象模拟 NLLB 结构
    class MockLinear:
        def __init__(self):
            self.weight = type("W", (), {"requires_grad": False, "grad": None})()
            self.weight.requires_grad = True
        def parameters(self):
            return [self.weight]

    class MockAttn:
        def __init__(self):
            self.q_proj = MockLinear()
            self.k_proj = MockLinear()
            self.v_proj = MockLinear()
            self.out_proj = MockLinear()

    class MockLayer:
        def __init__(self):
            self.self_attn = MockAttn()
            self.fc1 = MockLinear()
            self.fc2 = MockLinear()

    class MockDecoder:
        def __init__(self):
            self.layers = [MockLayer() for _ in range(3)]

    class MockEncoder:
        def __init__(self):
            self.layers = [MockLayer() for _ in range(3)]

    class MockModel:
        def __init__(self):
            self.encoder = MockEncoder()
            self.decoder = MockDecoder()
            self.config = type("Cfg", (), {"decoder_layers": 3, "num_attention_heads": 16})()

    from model import freeze_for_finetune, AlignmentHeadConfig, count_trainable_params

    model = MockModel()
    cfg = AlignmentHeadConfig(layer=0, head=15)
    n_trainable = freeze_for_finetune(model, cfg)
    # 期望可训练：仅 L0 的 q_proj + k_proj → 4 个 weight (q + k 各 1 weight)
    # 其他全冻
    trainable = count_trainable_params(model)
    assert trainable == 2  # q_proj.weight + k_proj.weight
    assert n_trainable == 2


def test_alignment_head_config_validation():
    """层/头范围校验"""
    from model import AlignmentHeadConfig
    # 正常
    cfg = AlignmentHeadConfig(layer=0, head=15)
    assert cfg.layer == 0
    assert cfg.head == 15
    # 边界
    cfg = AlignmentHeadConfig(layer=11, head=0)  # NLLB 12 层 16 头
    assert cfg.head == 0


def test_alignment_head_config_serialization():
    """可序列化（checkpoint 用）"""
    from model import AlignmentHeadConfig
    cfg = AlignmentHeadConfig(layer=2, head=8)
    d = cfg.to_dict()
    assert d["layer"] == 2
    assert d["head"] == 8
    # 反序列化
    cfg2 = AlignmentHeadConfig.from_dict(d)
    assert cfg2 == cfg


def test_freeze_encoder_always():
    """encoder 必须始终冻结"""
    class MockLayer:
        def __init__(self):
            self.weight = type("W", (), {"requires_grad": True})()
        def parameters(self):
            return [self.weight]

    class MockEncoder:
        def __init__(self):
            self.layers = [MockLayer() for _ in range(3)]

    class MockDecoderLayer:
        def __init__(self):
            self.q_proj = type("L", (), {"weight": type("W", (), {"requires_grad": True})()})()
            self.q_proj.parameters = lambda: [self.q_proj.weight]
            self.q_proj.weight = self.q_proj.weight
            self.k_proj = self.q_proj  # share for test
            self.fc = MockLayer()

    class MockDecoder:
        def __init__(self):
            self.layers = [MockDecoderLayer() for _ in range(3)]

    class MockModel:
        def __init__(self):
            self.encoder = MockEncoder()
            self.decoder = MockDecoder()
            self.config = type("Cfg", (), {"decoder_layers": 3})()

    from model import freeze_for_finetune, AlignmentHeadConfig
    model = MockModel()
    freeze_for_finetune(model, AlignmentHeadConfig(layer=0, head=0))
    # encoder 全冻
    for layer in model.encoder.layers:
        assert layer.weight.requires_grad is False
