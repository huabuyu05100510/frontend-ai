#!/usr/bin/env python3
"""
分析 MarianMT 每层每 head 的 attention 集中度
找出最适合做对齐的 (layer, head) 组合
"""
import json
import torch
from transformers import MarianMTModel, MarianTokenizer

MODEL = 'Helsinki-NLP/opus-mt-en-zh'

tok = MarianTokenizer.from_pretrained(MODEL)
model = MarianMTModel.from_pretrained(MODEL, attn_implementation='eager')
model.eval()

# Case 6（Route C 跑 0 分）+ Case 4（Route C 跑 0.25）
TESTS = [
    ('The cat is sleeping', '猫在睡觉'),
    ('Neural networks are powerful', '神经网络很强大'),
    ('The quick brown fox jumps over the lazy dog', '快速棕色狐狸'),
]

print(f'{"case":<6}{"step":<5}{"tgt":<8}{"layer":<6}{"head":<5}{"top_src":<8}{"top_attn":<10}{"集中度"}')
print('-' * 70)

for ci, (src, tgt_ref) in enumerate(TESTS):
    inputs = tok(src, return_tensors='pt')
    with torch.no_grad():
        out = model.generate(
            **inputs,
            output_attentions=True,
            return_dict_in_generate=True,
            max_new_tokens=64,
        )

    n_steps = len(out.cross_attentions)
    n_layers = len(out.cross_attentions[0])
    n_heads = model.config.num_attention_heads
    src_tokens = [tok.decode([i]) for i in inputs['input_ids'][0].tolist()]

    print(f'\nCase {ci+1}: {src}')
    print(f'  生成 {n_steps} 步, {n_layers} 层, {n_heads} 头')

    # 统计每层每头的平均 max attention（信号集中度）
    layer_head_sharpness = [[0]*n_heads for _ in range(n_layers)]
    layer_head_top_src = [[None]*n_heads for _ in range(n_layers)]
    layer_head_count = [[0]*n_heads for _ in range(n_layers)]

    valid_steps = 0
    for step in range(1, n_steps):  # 跳过 step 0（decoder start）
        for layer in range(n_layers):
            attn = out.cross_attentions[step][layer]  # [1, heads, 1, src_len]
            for head in range(n_heads):
                row = attn[0, head, 0]  # [src_len]
                # 只对实际生成 token 的 step 算
                max_v, max_idx = torch.max(row, dim=0)
                layer_head_sharpness[layer][head] += max_v.item()
                if layer_head_top_src[layer][head] is None:
                    layer_head_top_src[layer][head] = []
                layer_head_top_src[layer][head].append((max_idx.item(), round(max_v.item(), 3)))
        valid_steps += 1

    # 平均
    print(f'\n  Layer × Head 平均 max attention（>0.6 才算尖）:')
    for layer in range(n_layers):
        line = f'    L{layer}: '
        for head in range(n_heads):
            avg = layer_head_sharpness[layer][head] / valid_steps
            line += f'H{head}={avg:.2f} '
        print(line)

    # Case 1 详细：step-by-step 看每层每头
    if ci == 0:
        print(f'\n  Step-by-step (Case 1, layer 3 head 0):')
        for step in range(1, min(n_steps, 6)):
            tgt_id = out.sequences[0][step].item()
            tgt_tok = tok.decode([tgt_id])
            if layer_head_top_src[3][0] and step - 1 < len(layer_head_top_src[3][0]):
                top_idx, top_v = layer_head_top_src[3][0][step - 1]
                print(f'    tgt[{step}]={tgt_tok:<8} → src[{top_idx}]={src_tokens[top_idx] if top_idx < len(src_tokens) else "?":<10} attn={top_v}')
