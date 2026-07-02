#!/usr/bin/env python3
"""
Phase 5-A v2: LaBSE contextual embedding 映射到 MarianMT token 空间
====================================================================
v1 失败原因：每个 MarianMT token 独立喂 LaBSE → 失去上下文 → "开门" 这种短 tgt
LaBSE 在 standalone 下分数极不稳定（Case 5 F1=0）。

v2 策略：
  1. 把 MarianMT tokens 还原成 surface 句子（去特殊 token，拼回去）
  2. LaBSE 编码整句 → 得到每个 LaBSE sub-word 的 contextual hidden state
  3. 用 char offset 把 LaBSE sub-word 映射回 MarianMT token
  4. 每个 MarianMT token = 其覆盖的 LaBSE sub-word hidden state 的 mean pool

这样：
  - Route A 保留 contextual 强度（Phase 2 的 0.841 来源）
  - 与 Route C 共享 MarianMT token 索引空间（可 ensemble）
"""
import json
from pathlib import Path

import torch
from transformers import AutoTokenizer, AutoModel

LABSE = 'sentence-transformers/LaBSE'
SRC_FIXTURE = Path(__file__).resolve().parents[2] / 'test' / 'fixtures' / 'marian-crossattn.json'
OUT = Path(__file__).resolve().parents[2] / 'test' / 'fixtures' / 'labse-embeddings-marian-tokens.json'


def is_special(t):
    if not t:
        return True
    t = t.strip()
    if not t or t in ('</s>', '<pad>', '<s>', '<unk>'):
        return True
    if t.startswith('>>') and t.endswith('<<'):
        return True
    return False


def surface_of(t):
    """MarianMT BPE token → 表面字符（▁ = 词起始空格）"""
    return t.replace('▁', ' ')


def build_sentence_and_spans(tokens, reference=None):
    """构造 token 表面句 + 每 token 的 (start, end) char 区间。
    若 reference 给定：用 reference 作 ground truth 句子，每 token 贪心子串定位。
    否则：直接拼接 token surface（用于 tgt，因为 model.generate 无 ground truth）。
    """
    if reference is not None:
        sentence = reference
        spans = []
        cur = 0
        for t in tokens:
            if is_special(t):
                spans.append(None)
                continue
            surf = surface_of(t).strip()
            if not surf:
                spans.append(None)
                continue
            idx = sentence.find(surf, cur)
            if idx < 0:
                spans.append(None)
                continue
            spans.append((idx, idx + len(surf)))
            cur = idx + len(surf)
        return sentence, spans
    # 无 reference：拼接 surface
    sentence_chars = []
    spans = []
    cur = 0
    for t in tokens:
        if is_special(t):
            spans.append(None)
            continue
        surf = surface_of(t)
        start = cur
        sentence_chars.append(surf)
        cur += len(surf)
        spans.append((start, cur))
    sentence = ''.join(sentence_chars).strip()
    # 重新校准 strip 后的 offset
    leading = len(''.join(sentence_chars)) - len(''.join(sentence_chars).lstrip())
    new_spans = []
    for sp in spans:
        if sp is None:
            new_spans.append(None)
            continue
        s, e = sp[0] - leading, sp[1] - leading
        if e <= 0 or s >= len(sentence):
            new_spans.append(None)
            continue
        new_spans.append((max(0, s), min(len(sentence), e)))
    return sentence, new_spans


def encode_with_offsets(tok, model, sentence):
    """LaBSE 编码整句，返回每个 sub-word 的 (start, end, embedding)"""
    enc = tok(sentence, return_tensors='pt', truncation=True, max_length=128)
    with torch.no_grad():
        out = model(**enc)
    last_hidden = out.last_hidden_state[0]  # [L, 768]
    # token-level offsets
    offsets = enc.encodings[0].offsets  # list of (start, end) per sub-word, skip specials by (0,0)
    special_mask = enc.encodings[0].special_tokens_mask
    sub_emb = []
    sub_spans = []
    for i, (start, end) in enumerate(offsets):
        if special_mask[i]:
            continue
        if start == end:
            continue
        sub_emb.append(last_hidden[i].tolist())
        sub_spans.append((start, end))
    return sub_spans, sub_emb


def aggregate(sub_spans, sub_emb, token_spans, dim=768):
    """把 LaBSE sub-word embedding 按 MarianMT token 的 char span 聚合"""
    out = []
    for ts in token_spans:
        if ts is None:
            out.append(None)
            continue
        s, e = ts
        # 找所有与 [s, e) 重叠的 sub-word
        bucket = []
        for (ss, se), emb in zip(sub_spans, sub_emb):
            if ss < e and se > s:  # overlap
                bucket.append(emb)
        if not bucket:
            out.append(None)
            continue
        # mean pool + L2 normalize
        arr = torch.tensor(bucket).mean(dim=0)
        arr = torch.nn.functional.normalize(arr, p=2, dim=0)
        out.append(arr.tolist())
    return out


def main():
    print(f'▶ 加载 {LABSE}...')
    tok = AutoTokenizer.from_pretrained(LABSE)
    model = AutoModel.from_pretrained(LABSE).eval()
    print(f'  ✓ (hidden={model.config.hidden_size})')

    fixture = json.loads(SRC_FIXTURE.read_text())
    out = {
        'model': LABSE,
        'note': 'LaBSE contextual (full-sentence) embedding aggregated per MarianMT token via char offset.',
        'method': 'v2 contextual aggregation',
        'cases': [],
    }

    for ci, c in enumerate(fixture['cases']):
        # src: 用原始 src 句子做 ground truth
        src_sentence, src_spans = build_sentence_and_spans(c['srcTokens'], reference=c['src'])
        src_sub_spans, src_sub_emb = encode_with_offsets(tok, model, src_sentence)
        src_per_token = aggregate(src_sub_spans, src_sub_emb, src_spans)

        # tgt: 拼接 token surface 作句子（model.generate 无 ground truth）
        tgt_sentence, tgt_spans = build_sentence_and_spans(c['tgtTokens'])
        tgt_sub_spans, tgt_sub_emb = encode_with_offsets(tok, model, tgt_sentence)
        tgt_per_token = aggregate(tgt_sub_spans, tgt_sub_emb, tgt_spans)

        # 只保留有效的（非 None）token embedding + 原索引
        src_valid = [(i, e) for i, e in enumerate(src_per_token) if e is not None]
        tgt_valid = [(i, e) for i, e in enumerate(tgt_per_token) if e is not None]

        print(f'  case {ci+1}: src "{src_sentence}" ({len(src_valid)} valid)')
        print(f'           tgt "{tgt_sentence}" ({len(tgt_valid)} valid)')

        out['cases'].append({
            'src': c['src'],
            'tgt': c['tgt'],
            'srcSurface': src_sentence,
            'tgtSurface': tgt_sentence,
            'srcTokens': c['srcTokens'],
            'tgtTokens': c['tgtTokens'],
            'srcValidIdx': [i for i, _ in src_valid],
            'tgtValidIdx': [i for i, _ in tgt_valid],
            'srcEmb': [e for _, e in src_valid],
            'tgtEmb': [e for _, e in tgt_valid],
            'dim': model.config.hidden_size,
        })

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f'\n✓ 落 {OUT} ({OUT.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
