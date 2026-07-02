#!/usr/bin/env python3
"""
Phase 6: 分析 NLLB-200-distilled-600M cross-attention 集中度
找 alignment head（参考 Phase 3 MarianMT 流程）
"""
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

MODEL = 'facebook/nllb-200-distilled-600M'

print(f'▶ 加载 {MODEL}...')
tok = AutoTokenizer.from_pretrained(MODEL, src_lang='eng_Latn')
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL, attn_implementation='eager').eval()
ZH_ID = tok.convert_tokens_to_ids('zho_Hans')

print(f'  layers={model.config.num_hidden_layers}, heads={model.config.num_attention_heads}, n_encoder={model.config.encoder_layers}, n_decoder={model.config.decoder_layers}')

TESTS = [
    'The cat is sleeping',
    'Neural networks are powerful',
    'The quick brown fox jumps over the lazy dog',
]

for src in TESTS:
    print(f'\n▶ {src}')
    inp = tok(src, return_tensors='pt')
    with torch.no_grad():
        out = model.generate(
            **inp,
            forced_bos_token_id=ZH_ID,
            output_attentions=True,
            return_dict_in_generate=True,
            max_new_tokens=64,
        )
    n_steps = len(out.cross_attentions)
    n_layers = len(out.cross_attentions[0])
    n_heads = model.config.num_attention_heads
    src_len = inp['input_ids'].shape[1]
    src_tokens = [tok.decode([i]) for i in inp['input_ids'][0].tolist()]

    print(f'  生成 {n_steps} 步, {n_layers} 层 × {n_heads} 头, src_len={src_len}')
    text = tok.decode(out.sequences[0], skip_special_tokens=True)
    print(f'  gen: {text}')

    # 统计每层每头平均 max attn，**只在 content token 上**（跳过 src[0]=eng_Latn 和 src[-1]=</s>）
    sharp = [[0.0]*n_heads for _ in range(n_layers)]
    correct_top1 = [[0]*n_heads for _ in range(n_layers)]  # 实际对齐命中率
    valid = 0
    # 内容 token 区间：[1, src_len-1)
    content_lo, content_hi = 1, src_len - 1
    for step in range(1, n_steps):
        tgt_id = out.sequences[0][step].item()
        tgt_tok = tok.decode([tgt_id])
        if tgt_tok in ('</s>', '<pad>', '', '<unk>', 'zho_Hans'):
            continue
        for layer in range(n_layers):
            attn = out.cross_attentions[step][layer]  # [1, heads, 1, src_len]
            for h in range(n_heads):
                row = attn[0, h, 0]
                # 只在 content 区间内找 max
                content_vals = row[content_lo:content_hi]
                max_v = content_vals.max().item()
                max_idx = content_vals.argmax().item() + content_lo
                sharp[layer][h] += max_v
        valid += 1

    print(f'  Layer × Head 平均 max attention:')
    for layer in range(n_layers):
        line = f'    L{layer:<2}: '
        for h in range(n_heads):
            line += f'H{h}={sharp[layer][h]/valid:.2f} '
        print(line)
