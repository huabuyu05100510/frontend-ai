#!/usr/bin/env python3
"""
Phase 3 spike: 用 PyTorch 直接拿 opus-mt 的 cross-attention
============================================================
绕过 ONNX graph surgery，直接用 PyTorch + output_attentions=True
拿 decoder cross-attention 矩阵，落 fixture JSON。

输出: test/fixtures/marian-crossattn.json
  { cases: [{ src, tgt, srcTokens, tgtTokens, crossAttn: [[...]] }] }
  crossAttn shape: [tgt_len, src_len]（已对最后一层、多头平均）

为什么 PyTorch 而非 ONNX：
- onnxruntime-node 默认 ONNX 砍掉了 attention 张量（Phase 1 已验证）
- PyTorch 原生支持 output_attentions=True
- 这是 spike：先证明 cross-attn 信号强度够，再做 ONNX graph surgery 端侧化
"""
import json
import sys
from pathlib import Path

import torch
from transformers import MarianMTModel, MarianTokenizer

MODEL = 'Helsinki-NLP/opus-mt-en-zh'
OUT = Path(__file__).resolve().parents[2] / 'test' / 'fixtures' / 'marian-crossattn.json'

# 与 Phase 2 LaBSE fixture 完全一致的 8 case，方便对比
CASES = [
    ('The quick brown fox jumps over the lazy dog', '敏捷的棕色狐狸跳过了懒狗'),
    ('I love you', '我爱你'),
    ('Hello world', '你好世界'),
    ('The cat is sleeping', '猫在睡觉'),
    ('Open the door', '打开门'),
    ('Neural networks are powerful', '神经网络很强大'),
    ('Machine learning models require large datasets', '机器学习模型需要大量数据'),
    ('The weather is nice today', '今天天气很好'),
]

print(f'▶ 加载 {MODEL}...')
tok = MarianTokenizer.from_pretrained(MODEL)
# 必须用 eager attention：SDPA（PyTorch 2.0+ 默认）不支持 output_attentions
model = MarianMTModel.from_pretrained(MODEL, attn_implementation='eager')
model.eval()
print(f'  ✓ 加载完成 (layers={model.config.num_hidden_layers}, heads={model.config.num_attention_heads})')

results = {
    'model': MODEL,
    'note': 'cross_attentions from generate(output_attentions=True), LAYER=3 HEAD=0 (alignment head, like awesome-align论文选 alignment head 思路)',
    'alignment_layer': 3,
    'alignment_head': 0,
    'cases': []
}

for src, tgt_ref in CASES:
    print(f'\n▶ {src!r}  →  ref={tgt_ref!r}')
    inputs = tok(src, return_tensors='pt')

    # 用 model.generate 自然生成，cross-attn 反映模型真实对齐
    with torch.no_grad():
        out = model.generate(
            **inputs,
            output_attentions=True,
            return_dict_in_generate=True,
            max_new_tokens=64,
        )

    # out.cross_attentions: tuple per decode step
    # 每个 step 是 tuple per layer (6 layers)，每层 [batch, heads, 1, src_len]
    # 选 alignment head: LAYER=3 HEAD=0（analyze_layers.py 实测最尖）
    seq = out.sequences[0].tolist()
    n_steps = len(out.cross_attentions)
    n_layers = len(out.cross_attentions[0])
    ALIGN_LAYER = 3
    ALIGN_HEAD = 0
    print(f'  生成 {n_steps} 步, {n_layers} 层, 用 L{ALIGN_LAYER} H{ALIGN_HEAD}')

    src_len = inputs['input_ids'].shape[1]
    attn = torch.zeros(n_steps, src_len)
    for step in range(n_steps):
        # out.cross_attentions[step][layer]: [1, heads, 1, src_len]
        layer_attn = out.cross_attentions[step][ALIGN_LAYER]
        attn[step] = layer_attn[0, ALIGN_HEAD, 0]  # 单 alignment head → [src_len]

    attn_avg = attn.cpu().tolist()

    src_ids = inputs['input_ids'][0].tolist()
    tgt_ids = seq.tolist() if hasattr(seq, 'tolist') else list(seq)
    # 去掉 prompt（decoder 起始是 </s> 或 0），generate 返回完整 sequence
    # 对 MarianMT，sequences[0] = [decoder_start, ...generated]
    src_tokens = [tok.decode([i]) for i in src_ids]
    tgt_tokens = [tok.decode([i]) for i in tgt_ids]

    gen_text = tok.decode(seq, skip_special_tokens=True)
    print(f'  生成译文: {gen_text}')
    print(f'  src tokens ({len(src_tokens)}): {"|".join(src_tokens)}')
    print(f'  tgt tokens ({len(tgt_tokens)}): {"|".join(tgt_tokens)}')
    print(f'  cross-attn matrix: [{len(attn_avg)}][{len(attn_avg[0])}]')

    results['cases'].append({
        'src': src,
        'tgt': tgt_ref,
        'srcTokens': src_tokens,
        'tgtTokens': tgt_tokens,
        'crossAttn': attn_avg,
        'meta': {
            'layers': len(out.cross_attentions),
            'heads': model.config.num_attention_heads,
            'shape': [len(attn_avg), len(attn_avg[0])],
        },
    })

OUT.write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(f'\n✓ 落 fixture: {OUT}')
print(f'  ({OUT.stat().st_size // 1024} KB)')
