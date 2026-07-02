"""
model.py —— NLLB + 冻结/解冻 alignment head
- 加载 facebook/nllb-200-distilled-600M
- 冻结 encoder + decoder 全部参数
- 仅解冻 L{L} H{H} 的 q_proj / k_proj（cross-attn）

参考: spike/phase6/export_nllb_crossattn.py + docs/annotation-feature-tech-plan-V1.md §6.2

模型: MiniMax-M3
"""
from __future__ import annotations
import json
import os
from dataclasses import dataclass, asdict
from typing import Optional, Dict, Any, Tuple


# ─── 默认配置（Phase 6 结论 L0H15） ────────────────────
DEFAULT_MODEL = "facebook/nllb-200-distilled-600M"
DEFAULT_ALIGN_LAYER = 0
DEFAULT_ALIGN_HEAD = 15


@dataclass(frozen=True)
class AlignmentHeadConfig:
    layer: int = DEFAULT_ALIGN_LAYER
    head: int = DEFAULT_ALIGN_HEAD

    def to_dict(self) -> Dict[str, int]:
        return {"layer": self.layer, "head": self.head}

    @classmethod
    def from_dict(cls, d: Dict[str, int]) -> "AlignmentHeadConfig":
        return cls(layer=int(d["layer"]), head=int(d["head"]))


# ─── 加载模型（兼容无 transformers 环境） ────────────────
def load_nllb(
    model_name: str = DEFAULT_MODEL,
    cache_dir: Optional[str] = None,
    skip_if_missing: bool = True,
    dry_run: bool = False,
):
    """
    加载 NLLB 模型 + tokenizer。
    - dry_run=True: 不真加载模型，返回 (None, None, mock_meta)
    - skip_if_missing=True: 模型文件不存在返回 mock
    """
    if dry_run:
        return None, None, _mock_meta(model_name, layer=DEFAULT_ALIGN_LAYER, head=DEFAULT_ALIGN_HEAD)

    try:
        import torch
        from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
    except ImportError:
        if skip_if_missing:
            return None, None, _mock_meta(model_name, layer=DEFAULT_ALIGN_LAYER, head=DEFAULT_ALIGN_HEAD)
        raise

    try:
        tok = AutoTokenizer.from_pretrained(model_name, src_lang="eng_Latn", cache_dir=cache_dir)
        model = AutoModelForSeq2SeqLM.from_pretrained(
            model_name,
            attn_implementation="eager",
            cache_dir=cache_dir,
        )
        model.eval()
    except Exception as e:
        if skip_if_missing:
            print(f"[model] 加载 {model_name} 失败: {e}\n  → 回退 mock", flush=True)
            return None, None, _mock_meta(model_name, layer=DEFAULT_ALIGN_LAYER, head=DEFAULT_ALIGN_HEAD)
        raise

    return tok, model, _real_meta(model)


def _real_meta(model) -> Dict[str, Any]:
    cfg = model.config
    return {
        "num_layers": int(getattr(cfg, "decoder_layers", 0)),
        "num_heads": int(getattr(cfg, "num_attention_heads", 0)),
        "d_model": int(getattr(cfg, "d_model", 0)),
        "source": "real",
    }


def _mock_meta(model_name: str, layer: int, head: int) -> Dict[str, Any]:
    """NLLB-200-distilled-600M: 12 decoder layers, 16 heads"""
    return {
        "num_layers": 12,
        "num_heads": 16,
        "d_model": 1024,
        "source": "mock",
        "model_name": model_name,
        "selected_layer": layer,
        "selected_head": head,
    }


# ─── 冻结/解冻 ─────────────────────────────────────────
def freeze_for_finetune(model, head_cfg: AlignmentHeadConfig) -> int:
    """
    冻结 encoder + decoder 全部参数
    仅解冻指定 (L, H) 的 cross-attn q_proj / k_proj

    返回可训练参数个数。
    """
    # 优先用 model.parameters()（真 transformers 模型）；否则递归子模块
    try:
        params = list(model.parameters())
    except (AttributeError, TypeError):
        params = []
        for sub in _iter_modules(model):
            for p in _safe_params(sub):
                params.append(p)
    for p in params:
        _set_requires_grad(p, False)

    # 解冻 L{H.layer} decoder layer 的 self_attn（cross-attn 实际存在 encoder/decoder 交叉处；
    # NLLB 的 cross-attn 实现是 decoder.layers[i].self_attn，因 src 经 encoder 后作为 K/V 输入）
    try:
        layer = model.decoder.layers[head_cfg.layer]
        self_attn = layer.self_attn
        # 解冻 q_proj / k_proj
        for proj_name in ("q_proj", "k_proj"):
            proj = getattr(self_attn, proj_name, None)
            if proj is None:
                continue
            for p in _safe_params(proj):
                _set_requires_grad(p, True)
    except (AttributeError, IndexError):
        # mock 模型容错
        pass

    return count_trainable_params(model)


def count_trainable_params(model) -> int:
    """统计 requires_grad=True 的 parameter 数"""
    n = 0
    for p in model.parameters():
        if p.requires_grad:
            n += 1
    return n


def count_total_params(model) -> int:
    try:
        return sum(1 for _ in model.parameters())
    except (AttributeError, TypeError):
        n = 0
        for sub in _iter_modules(model):
            n += len(_safe_params(sub))
        return n


def _iter_modules(model):
    """递归 yield 所有子模块（兼容 mock + list/容器）"""
    seen = set()
    stack = [model]
    while stack:
        m = stack.pop()
        mid = id(m)
        if mid in seen:
            continue
        seen.add(mid)
        yield m
        # 容器类型
        if isinstance(m, (list, tuple)):
            for sub in m:
                if id(sub) not in seen:
                    stack.append(sub)
            continue
        for attr in ("encoder", "decoder", "layers", "self_attn", "q_proj", "k_proj", "v_proj", "out_proj", "fc1", "fc2", "fc"):
            sub = getattr(m, attr, None)
            if sub is not None and id(sub) not in seen:
                stack.append(sub)


def _safe_params(m):
    try:
        return list(m.parameters())
    except (AttributeError, TypeError):
        return []


def _set_requires_grad(p, value: bool) -> None:
    """兼容 transformers Parameter + mock 纯属性对象"""
    if hasattr(p, "requires_grad_") and callable(p.requires_grad_):
        try:
            p.requires_grad_(value)
            return
        except Exception:
            pass
    if hasattr(p, "requires_grad"):
        p.requires_grad = value


def count_trainable_params(model) -> int:
    """统计 requires_grad=True 的 parameter 数"""
    n = 0
    try:
        params = list(model.parameters())
    except (AttributeError, TypeError):
        params = []
        for sub in _iter_modules(model):
            params.extend(_safe_params(sub))
    for p in params:
        if hasattr(p, "requires_grad"):
            if p.requires_grad:
                n += 1
    return n


# ─── 训练：单 batch loss（mock 友好） ────────────────────
def compute_align_loss(
    cross_attn,  # [tgt_len, src_len] tensor
    user_alignments: Dict[int, int],
    src_len: int,
) -> "torch.Tensor":
    """
    Loss = -log(softmax(cross_attn[user_aligned_positions]))
    方案 §6.2.

    cross_attn: [tgt_len, src_len]
    user_alignments: {tgtIdx → srcIdx} 正样本对
    """
    import torch
    import torch.nn.functional as F
    # softmax over src axis
    log_probs = F.log_softmax(cross_attn, dim=-1)  # [tgt_len, src_len]
    losses = []
    for tgt_i, src_j in user_alignments.items():
        if 0 <= tgt_i < cross_attn.shape[0] and 0 <= src_j < cross_attn.shape[1]:
            losses.append(-log_probs[tgt_i, src_j])
    if not losses:
        return torch.tensor(0.0, requires_grad=True)
    return torch.stack(losses).mean()


# ─── Checkpoint 辅助 ───────────────────────────────────
def save_checkpoint_meta(path, head_cfg: AlignmentHeadConfig, epoch: int, f1: float, extra: Optional[Dict[str, Any]] = None):
    """保存 head 配置 + epoch/f1（state_dict 由训练器写）"""
    meta = {
        "head": head_cfg.to_dict(),
        "epoch": epoch,
        "f1": f1,
        "model": DEFAULT_MODEL,
    }
    if extra:
        meta.update(extra)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
