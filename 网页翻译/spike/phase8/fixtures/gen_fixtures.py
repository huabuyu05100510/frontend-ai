#!/usr/bin/env python3
"""
生成 Phase 8 测试用 fixture：
- 60 条 align_fix 标注（10 个不同 src/tgt 对，每个 6 标注）
- 故意混入冲突（让 majority vote 起作用）
- 故意混入低质量用户（测权重）
"""
import json
import random
from pathlib import Path

random.seed(42)

OUT = Path(__file__).resolve().parent / "annos.jsonl"

CASES = [
    ("The quick brown fox jumps over the lazy dog", "敏捷的棕色狐狸跳过了懒狗",
     ["The", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog"],
     ["敏捷的", "棕色", "狐狸", "跳", "过", "了", "懒", "狗"]),
    ("I love you", "我爱你", ["I", "love", "you"], ["我", "爱", "你"]),
    ("Hello world", "你好世界", ["Hello", "world"], ["你好", "世界"]),
    ("The cat is sleeping", "猫在睡觉", ["The", "cat", "is", "sleeping"], ["猫", "在", "睡觉"]),
    ("Open the door", "打开门", ["Open", "the", "door"], ["打开", "门"]),
    ("Neural networks are powerful", "神经网络很强大", ["Neural", "networks", "are", "powerful"], ["神经网络", "很", "强大"]),
]

USERS = ["power_user", "regular", "newbie1", "newbie2", "spammer"]


def mk_align_fix(case_idx, src, tgt, src_tokens, tgt_tokens, src_token_idx, predicted_tgt, corrected_tgt, user_id, created_at):
    return {
        "id": f"u-{case_idx}-{src_token_idx}-{user_id}-{created_at}",
        "kind": "align_fix",
        "schemaVersion": 1,
        "url": f"https://example.com/page-{case_idx % 7}",
        "domPath": f"/html/body/div[{case_idx}]/p",
        "srcSegmentId": f"seg-{case_idx}",
        "langPair": ["en", "zh"],
        "srcText": src,
        "tgtText": tgt,
        "srcTokens": src_tokens,
        "tgtTokens": tgt_tokens,
        "predicted": [[0, 0]],
        "modelVersion": "nllb-600m-l0h15-v1",
        "payload": {
            "srcTokenIdx": src_token_idx,
            "predictedTgtTokenIdx": predicted_tgt,
            "correctedTgtTokenIdx": corrected_tgt,
            "correctionKind": "change",
        },
        "context": {"prevSrc": "", "nextSrc": ""},
        "createdAt": created_at,
        "userId": user_id,
    }


def main():
    lines = []
    ts = 1700000000000
    case_idx = 0
    for src, tgt, src_tokens, tgt_tokens in CASES:
        # 每段标 3 个不同 srcToken
        for token_i in range(min(3, len(src_tokens))):
            # 4-5 个标注（多数对齐正确，少量冲突）
            for u_idx, user in enumerate(USERS):
                # 大多数标对
                if u_idx < 4:
                    corrected = token_i  # 正确对齐
                elif u_idx == 4:
                    # spammer 标错
                    corrected = (token_i + 1) % len(tgt_tokens)
                else:
                    corrected = token_i
                lines.append(mk_align_fix(
                    case_idx, src, tgt, src_tokens, tgt_tokens,
                    src_token_idx=token_i,
                    predicted_tgt=token_i,
                    corrected_tgt=corrected,
                    user_id=user,
                    created_at=ts,
                ))
                ts += 1000
        case_idx += 1

    # 写文件
    with OUT.open("w", encoding="utf-8") as f:
        for ln in lines:
            f.write(json.dumps(ln, ensure_ascii=False) + "\n")
    print(f"✓ {len(lines)} 条 → {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
