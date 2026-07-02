#!/usr/bin/env python3
"""
Phase 6: 提取 NLLB-200-distilled-600M cross-attn，4 个候选 alignment head 各落一份
"""
import json
from pathlib import Path

import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

MODEL = 'facebook/nllb-200-distilled-600M'
OUT_DIR = Path(__file__).resolve().parents[2] / 'test' / 'fixtures'

CASES = [
    'The quick brown fox jumps over the lazy dog',
    'I love you',
    'Hello world',
    'The cat is sleeping',
    'Open the door',
    'Neural networks are powerful',
    'Machine learning models require large datasets',
    'The weather is nice today',
]

# analyze_layers.py 实测 4 个候选（content-only sharpness）
CANDIDATES = [(1, 4), (2, 4), (1, 10), (0, 15)]

print(f'▶ 加载 {MODEL}...')
tok = AutoTokenizer.from_pretrained(MODEL, src_lang='eng_Latn')
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL, attn_implementation='eager').eval()
ZH_ID = tok.convert_tokens_to_ids('zho_Hans')

# 各候选 → 完整数据
fixtures = {f'L{L}H{H}': {'model': MODEL, 'alignment_layer': L, 'alignment_head': H, 'cases': []} for L, H in CANDIDATES}

for src in CASES:
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
    seq = out.sequences[0].tolist()
    n_steps = len(out.cross_attentions)
    n_layers = len(out.cross_attentions[0])
    src_len = inp['input_ids'].shape[1]

    src_ids = inp['input_ids'][0].tolist()
    src_tokens = [tok.decode([i]) for i in src_ids]
    tgt_tokens = [tok.decode([i]) for i in seq]
    gen_text = tok.decode(seq, skip_special_tokens=True)
    print(f'  gen: {gen_text}')
    print(f'  src tokens ({len(src_tokens)}): {"|".join(src_tokens)}')
    print(f'  tgt tokens ({len(tgt_tokens)}): {"|".join(tgt_tokens)}')

    for L, H in CANDIDATES:
        attn = torch.zeros(n_steps, src_len)
        for step in range(n_steps):
            layer_attn = out.cross_attentions[step][L]
            attn[step] = layer_attn[0, H, 0]
        fixtures[f'L{L}H{H}']['cases'].append({
            'src': src,
            'tgt': '',
            'genText': gen_text,
            'srcTokens': src_tokens,
            'tgtTokens': tgt_tokens,
            'crossAttn': attn.cpu().tolist(),
        })

# 各 candidate 落一份
for name, data in fixtures.items():
    out_path = OUT_DIR / f'nllb-crossattn-{name}.json'
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    print(f'\n✓ {out_path.name} ({out_path.stat().st_size // 1024} KB)')
