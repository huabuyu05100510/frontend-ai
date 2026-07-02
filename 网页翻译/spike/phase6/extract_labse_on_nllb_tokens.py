#!/usr/bin/env python3
"""
Phase 6: LaBSE on NLLB tokens（统一 tokenization 做 ensemble）
"""
import json
from pathlib import Path

import torch
from transformers import AutoTokenizer, AutoModel, AutoModelForSeq2SeqLM

LABSE = 'sentence-transformers/LaBSE'
NLLB_FIXTURE = Path(__file__).resolve().parents[2] / 'test' / 'fixtures' / 'nllb-crossattn-L0H15.json'
OUT = Path(__file__).resolve().parents[2] / 'test' / 'fixtures' / 'labse-embeddings-nllb-tokens.json'


def clean_token(t):
    if not t:
        return None
    t = t.strip()
    if not t or t in ('</s>', '<pad>', '<s>', '<unk>', '<mask>'):
        return None
    if t.startswith('>>') and t.endswith('<<'):
        return None
    if t == 'zho_Hans' or t == 'eng_Latn':
        return None
    if len(t) >= 7 and t[3] == '_' and t[0:3].islower() and t[4:7].isalpha() and t[4].isupper():
        return None  # language code like eng_Latn
    return t.replace('▁', '').strip() or None


def embed_tokens(tokens, tok, model):
    valid = [(i, clean_token(t)) for i, t in enumerate(tokens)]
    texts = [s for _, s in valid if s]
    idx_map = [(i, s) for i, s in valid if s]
    if not texts:
        return [], []
    batch = tok(texts, padding=True, truncation=True, max_length=16, return_tensors='pt')
    with torch.no_grad():
        out = model(**batch)
    last_hidden = out.last_hidden_state
    mask = batch['attention_mask'].unsqueeze(-1).float()
    emb = (last_hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1)
    emb = torch.nn.functional.normalize(emb, p=2, dim=1)
    return idx_map, emb.cpu().tolist()


def main():
    print(f'▶ 加载 {LABSE}...')
    tok = AutoTokenizer.from_pretrained(LABSE)
    model = AutoModel.from_pretrained(LABSE).eval()

    fixture = json.loads(NLLB_FIXTURE.read_text())
    out = {
        'model': LABSE,
        'note': 'LaBSE standalone embedding per NLLB token. 与 nllb-crossattn-L0H15.json 共享 tokenization.',
        'cases': [],
    }

    for ci, c in enumerate(fixture['cases']):
        src_idx_map, src_emb = embed_tokens(c['srcTokens'], tok, model)
        tgt_idx_map, tgt_emb = embed_tokens(c['tgtTokens'], tok, model)
        print(f'  case {ci+1}: src valid {len(src_emb)}/{len(c["srcTokens"])}, tgt valid {len(tgt_emb)}/{len(c["tgtTokens"])}')
        out['cases'].append({
            'src': c['src'],
            'tgt': c.get('genText', ''),
            'srcTokens': c['srcTokens'],
            'tgtTokens': c['tgtTokens'],
            'srcValidIdx': [i for i, _ in src_idx_map],
            'tgtValidIdx': [i for i, _ in tgt_idx_map],
            'srcEmb': src_emb,
            'tgtEmb': tgt_emb,
            'dim': model.config.hidden_size,
        })

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f'\n✓ 落 {OUT} ({OUT.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
