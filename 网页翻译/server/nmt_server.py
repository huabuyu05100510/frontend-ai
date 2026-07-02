#!/usr/bin/env python3
"""
Phase 7-A: 云端 NMT 翻译 + cross-attention 服务
=============================================
对标百度网页翻译架构。

POST /translate
  body: { src: string, src_lang?: 'eng_Latn', tgt_lang?: 'zho_Hans' }
  resp: {
    src: string,
    tgt: string,
    srcTokens: string[],
    tgtTokens: string[],
    crossAttn: number[][]   # [tgt_len, src_len]，L0H15 alignment head
    latencyMs: number,
    meta: { model, layer, head }
  }

GET /health
"""
import time
import json
from pathlib import Path
from typing import Optional

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

MODEL = 'facebook/nllb-200-distilled-600M'
ALIGN_LAYER = 0
ALIGN_HEAD = 15
PORT = 8788

print(f'▶ 加载 {MODEL}...', flush=True)
t0 = time.time()
tok = AutoTokenizer.from_pretrained(MODEL, src_lang='eng_Latn')
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL, attn_implementation='eager').eval()
ZH_ID = tok.convert_tokens_to_ids('zho_Hans')
print(f'  ✓ 加载完成 [{time.time()-t0:.1f}s, params={sum(p.numel() for p in model.parameters())/1e6:.0f}M]', flush=True)

app = FastAPI(title='NMT + Cross-Attn Service', version='1.0.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)


class TranslateRequest(BaseModel):
    src: str
    src_lang: Optional[str] = 'eng_Latn'
    tgt_lang: Optional[str] = 'zho_Hans'


@app.get('/health')
def health():
    return {
        'status': 'ok',
        'model': MODEL,
        'alignment_layer': ALIGN_LAYER,
        'alignment_head': ALIGN_HEAD,
        'params_m': int(sum(p.numel() for p in model.parameters()) / 1e6),
    }


@app.post('/translate')
def translate(req: TranslateRequest):
    if not req.src or not req.src.strip():
        raise HTTPException(status_code=400, detail='src is empty')

    t0 = time.time()
    src_lang_id = tok.convert_tokens_to_ids(req.src_lang) if req.src_lang != 'eng_Latn' else None
    tgt_lang_id = tok.convert_tokens_to_ids(req.tgt_lang)
    if tgt_lang_id == 3 or tgt_lang_id is None:
        raise HTTPException(status_code=400, detail=f'unknown tgt_lang: {req.tgt_lang}')

    # 切源语言（默认 eng_Latn）
    if src_lang_id and src_lang_id != 3:
        tok.src_lang = req.src_lang

    inp = tok(req.src, return_tensors='pt')
    with torch.no_grad():
        out = model.generate(
            **inp,
            forced_bos_token_id=tgt_lang_id,
            output_attentions=True,
            return_dict_in_generate=True,
            max_new_tokens=128,
        )

    seq = out.sequences[0].tolist()
    n_steps = len(out.cross_attentions)
    src_len = inp['input_ids'].shape[1]

    # 提取 L0H15 cross-attn
    attn = torch.zeros(n_steps, src_len)
    for step in range(n_steps):
        layer_attn = out.cross_attentions[step][ALIGN_LAYER]
        attn[step] = layer_attn[0, ALIGN_HEAD, 0]

    src_tokens = [tok.decode([i]) for i in inp['input_ids'][0].tolist()]
    tgt_tokens = [tok.decode([i]) for i in seq]
    tgt_text = tok.decode(seq, skip_special_tokens=True)

    return {
        'src': req.src,
        'tgt': tgt_text,
        'srcTokens': src_tokens,
        'tgtTokens': tgt_tokens,
        'crossAttn': attn.cpu().tolist(),
        'latencyMs': int((time.time() - t0) * 1000),
        'meta': {
            'model': MODEL,
            'layer': ALIGN_LAYER,
            'head': ALIGN_HEAD,
            'srcLen': src_len,
            'tgtLen': n_steps,
        },
    }


@app.get('/examples')
def examples():
    """demo 默认 case"""
    return {
        'cases': [
            'The quick brown fox jumps over the lazy dog',
            'I love you',
            'Hello world',
            'The cat is sleeping',
            'Neural networks are powerful',
        ]
    }


if __name__ == '__main__':
    import uvicorn
    print(f'\n▶ 服务启动 http://localhost:{PORT}', flush=True)
    print(f'  POST /translate  body: {{"src": "Hello"}}', flush=True)
    print(f'  GET  /health', flush=True)
    uvicorn.run(app, host='0.0.0.0', port=PORT, log_level='info')
