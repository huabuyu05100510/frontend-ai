#!/usr/bin/env python3
"""
Phase 6: 验证 NLLB-200-distilled-600M 翻译质量 vs opus-mt-en-zh
==============================================================
对 8 个 case 跑两个模型，对比翻译输出。
若 NLLB 显著更好 → 切 NLLB 重跑 Route C 全流程。
"""
import json
from pathlib import Path

import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM, MarianMTModel, MarianTokenizer

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

print('▶ 加载 opus-mt-en-zh (80M, 当前)...')
marian_tok = MarianTokenizer.from_pretrained('Helsinki-NLP/opus-mt-en-zh')
marian = MarianMTModel.from_pretrained('Helsinki-NLP/opus-mt-en-zh', attn_implementation='eager').eval()
print(f'  ✓ params={sum(p.numel() for p in marian.parameters())/1e6:.0f}M')

print('\n▶ 加载 NLLB-200-distilled-600M...')
nllb_tok = AutoTokenizer.from_pretrained('facebook/nllb-200-distilled-600M', src_lang='eng_Latn')
nllb = AutoModelForSeq2SeqLM.from_pretrained('facebook/nllb-200-distilled-600M', attn_implementation='eager').eval()
print(f'  ✓ params={sum(p.numel() for p in nllb.parameters())/1e6:.0f}M')

ZH_ID = nllb_tok.convert_tokens_to_ids('zho_Hans')  # NLLB 用 zho_Hans 不是 zho_Chin

print('\n═══════════════════════════════════════════════════')
print(f'{"case":<6}{"opus-mt":<35}{"NLLB-600M":<35}')
print('═══════════════════════════════════════════════════')

results = []
for src in CASES:
    # opus-mt
    inp = marian_tok(src, return_tensors='pt')
    with torch.no_grad():
        out = marian.generate(**inp, max_new_tokens=64)
    opus_text = marian_tok.decode(out[0], skip_special_tokens=True)

    # NLLB
    inp = nllb_tok(src, return_tensors='pt')
    with torch.no_grad():
        out = nllb.generate(
            **inp,
            forced_bos_token_id=ZH_ID,
            max_new_tokens=64,
        )
    nllb_text = nllb_tok.batch_decode(out, skip_special_tokens=True)[0]

    print(f'{src[:32]:<34}\n  opus: {opus_text}\n  nllb: {nllb_text}\n')
    results.append({'src': src, 'opus': opus_text, 'nllb': nllb_text})

out_path = Path(__file__).resolve().parents[2] / 'spike' / 'phase6' / 'translation-compare.json'
out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(f'✓ 落 {out_path}')
