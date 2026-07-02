#!/usr/bin/env python3
"""
Phase 5-A: 在 MarianMT token 序列上算 LaBSE embedding
=====================================================
目的：让 Route A (LaBSE+SimAlign) 与 Route C (MarianMT cross-attn)
共享同一份 tokenization，做真正的跨路 ensemble。

策略：每个 MarianMT token 作为独立文本喂 LaBSE
- 失去 contextual 信息（LaBSE 看不到上下文）
- 但 Route A 是「语义信号」，standalone embedding 已足够区分 fox≠brown≠the
- Route C 提供 contextual 决策（cross-attn 本身就是 in-context）

输出：test/fixtures/labse-embeddings-marian-tokens.json
  与 marian-crossattn.json 同序、同 token 索引，可直接 ensemble
"""
import json
from pathlib import Path

import torch
from transformers import AutoTokenizer, AutoModel

LABSE = 'sentence-transformers/LaBSE'
SRC_FIXTURE = Path(__file__).resolve().parents[2] / 'test' / 'fixtures' / 'marian-crossattn.json'
OUT = Path(__file__).resolve().parents[2] / 'test' / 'fixtures' / 'labse-embeddings-marian-tokens.json'

# MarianMT token 表面清理：
# - sentencepiece BPE 续接符 ▁（U+2581）→ 空格
# - 特殊 token </s>/<pad>/<s>/语言代码 → 跳过
def clean_token(t):
    if not t:
        return None
    t = t.strip()
    if not t:
        return None
    if t in ('</s>', '<pad>', '<s>', '<unk>'):
        return None
    if t.startswith('>>') and t.endswith('<<'):
        return None
    # ▁ 是 sentencepiece 的「词起始」标记，去掉前缀
    return t.replace('▁', '').strip() or None


def embed_tokens(tokens, tok, model, device='cpu'):
    """对每个 token 独立 LaBSE 编码，返回 [n_valid_tokens, 768]"""
    # parallel 编码：一次性喂所有 token，模型自己处理 attention
    valid = [(i, clean_token(t)) for i, t in enumerate(tokens)]
    texts = [s for _, s in valid if s]
    idx_map = [(i, s) for i, s in valid if s]
    if not texts:
        return [], []

    batch = tok(texts, padding=True, truncation=True, max_length=16, return_tensors='pt').to(device)
    with torch.no_grad():
        out = model(**batch)
    # mean pool over non-pad tokens
    last_hidden = out.last_hidden_state  # [B, L, 768]
    mask = batch['attention_mask'].unsqueeze(-1).float()
    summed = (last_hidden * mask).sum(dim=1)
    counts = mask.sum(dim=1).clamp(min=1)
    emb = (summed / counts)  # [B, 768]
    # L2 normalize
    emb = torch.nn.functional.normalize(emb, p=2, dim=1)
    return idx_map, emb.cpu().tolist()


def main():
    print(f'▶ 加载 {LABSE}...')
    tok = AutoTokenizer.from_pretrained(LABSE)
    model = AutoModel.from_pretrained(LABSE).eval()
    print(f'  ✓ (hidden={model.config.hidden_size})')

    fixture = json.loads(SRC_FIXTURE.read_text())
    print(f'▶ 读 {SRC_FIXTURE.name}：{len(fixture["cases"])} cases')

    out = {
        'model': LABSE,
        'note': 'LaBSE contextual embedding, mean-pooled per MarianMT token. 与 marian-crossattn.json 共享 tokenization.',
        'cases': [],
    }

    for ci, c in enumerate(fixture['cases']):
        src_idx_map, src_emb = embed_tokens(c['srcTokens'], tok, model)
        tgt_idx_map, tgt_emb = embed_tokens(c['tgtTokens'], tok, model)
        print(f'  case {ci+1}: src valid {len(src_emb)}/{len(c["srcTokens"])}, tgt valid {len(tgt_emb)}/{len(c["tgtTokens"])}')
        out['cases'].append({
            'src': c['src'],
            'tgt': c['tgt'],
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
