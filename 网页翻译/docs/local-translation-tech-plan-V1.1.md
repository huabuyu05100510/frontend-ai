# 翻译 + 词级对齐 技术方案 V1.1

> **模型**：Claude (Sonnet 4.5)
> **替代**：V1（`local-translation-tech-plan-V1.md`），V1 把 WebGPU NMT 当成词级对齐的前提，架构错误
> **V1.1 关键修正**：模块 A/B **解耦**，词级对齐 MVP **不依赖** WebGPU / 量化

---

## 0. V1 → V1.1 修正

| 议题 | V1（错误） | V1.1（修正） |
|---|---|---|
| 模块关系 | WebGPU NMT 是地基，词级对齐派生 | **解耦**：两个独立模块 |
| MVP 路径 | 浏览器内 WebGPU NMT | **路径 B**：后端 PyTorch，导出 attention |
| 量化 | MVP 必需 | MVP **不需要**；仅 WebGPU 演进时需要 |
| WebGPU | MVP 阻塞项 | **未来演进路径**，不阻塞 MVP |

---

## 1. 模块解耦

```
模块 A：词级对齐（独立产品）
  ├─ 后端 PyTorch 跑 opus-mt（fp32，不量化）
  ├─ 导出 attention 矩阵
  ├─ aligner 纯函数（投影算法）
  └─ 前端 hover 高亮
  → MVP 不依赖 WebGPU

模块 B：WebGPU 本地 NMT（可选演进）
  ├─ transformers.js + ONNX 量化模型
  ├─ 浏览器内推理（隐私/离线卖点）
  └─ Service Worker 缓存
  → MVP 验证通过后再做
```

**关键**：模块 A 的产出（attention 可视化技术）独立成立，即使模块 B 不做，模块 A 也是完整产品。

---

## 2. 模块 A：词级对齐 MVP（路径 B）

### 2.1 目标
**1-2 周验证**「attention 矩阵 → 前端 hover 高亮」全链路可行。

### 2.2 后端（新增 `server/nmt-py/`）

```python
# server/nmt-py/app.py
from transformers import MarianMTModel, MarianTokenizer
import torch

model_name = 'Helsinki-NLP/opus-mt-en-zh'
tokenizer = MarianTokenizer.from_pretrained(model_name)
model = MarianMTModel.from_pretrained(model_name)
model.eval()

def translate_with_attention(text):
    inputs = tokenizer(text, return_tensors='pt')
    with torch.no_grad():
        out = model.generate(
            **inputs,
            output_attentions=True,
            output_scores=True,
            return_dict_in_generate=True,
            output_hidden_states=False,
        )
    # 取 decoder 最后一层 cross-attention
    # shape: [tgt_len, num_heads, tgt_len, src_len]
    cross_attn = out.cross_attentions  # tuple per layer
    last_layer = cross_attn[-1]  # 最后一层
    # 多头平均
    attn_avg = last_layer.mean(dim=1)  # [tgt_len, src_len]
    return {
        'translation': tokenizer.decode(out.sequences[0], skip_special_tokens=True),
        'attention': attn_avg.cpu().tolist(),
        'src_tokens': tokenizer.convert_ids_to_tokens(inputs['input_ids'][0]),
        'tgt_tokens': tokenizer.convert_ids_to_tokens(out.sequences[0]),
    }
```

**API**：`POST /api/translate-aligned-local` → 返回 `{ translation, attention, src_tokens, tgt_tokens }`

### 2.3 前端 aligner（新增 `lib/word-aligner.mjs`）

```javascript
/**
 * attention[srcLen×tgtLen] → AlignmentPair[]
 * @param {number[][]} attention  [tgtLen][srcLen]
 * @param {string[]} srcTokens    BPE tokens
 * @param {string[]} tgtTokens
 * @returns {AlignmentPair[]} 每个 tgt token 对应最佳 src token
 */
export function alignTokens(attention, srcTokens, tgtTokens) {
  const pairs = []
  for (let i = 0; i < tgtTokens.length; i++) {
    const row = attention[i]
    let bestJ = 0, bestScore = -Infinity
    for (let j = 0; j < srcTokens.length; j++) {
      if (row[j] > bestScore) {
        bestScore = row[j]
        bestJ = j
      }
    }
    pairs.push({
      tgtIdx: i,
      srcIdx: bestJ,
      score: bestScore,
    })
  }
  return pairs
}

/**
 * BPE token → char 区间映射
 * 处理 Marian BPE 的 @@ 续接符
 */
export function tokensToCharRanges(tokens, originalText) {
  // ... BPE 合并逻辑
}

/**
 * 对齐结果挂到 DOM dataset
 */
export function attachAlignmentToDom(element, pairs, threshold = 0.3) {
  const filtered = pairs.filter(p => p.score >= threshold)
  element.dataset.alignment = JSON.stringify(filtered)
}
```

### 2.4 前端可视化（新增 `lib/attention-visualizer.mjs`）

```javascript
/**
 * hover tgt 词 → 高亮 src 原文
 * 共享给图搜项目的图像区域 attention 可视化
 */
export function bindHoverHighlight(container, mode = 'word') {
  // mode='word': 翻译词级
  // mode='region': 图搜图像区域
  container.addEventListener('mouseover', e => {
    const target = e.target.closest('[data-align-src]')
    if (!target) return
    highlightPair(target, mode)
  })
  // ...
}
```

### 2.5 单测（`test/word-aligner.test.mjs`）

```javascript
test('alignTokens: argmax 选最佳 src', () => {
  const attn = [
    [0.1, 0.8, 0.1],  // tgt[0] → src[1]
    [0.7, 0.2, 0.1],  // tgt[1] → src[0]
  ]
  const pairs = alignTokens(attn, ['a','b','c'], ['x','y'])
  assert.equal(pairs[0].srcIdx, 1)
  assert.equal(pairs[1].srcIdx, 0)
})

test('低置信度过滤', () => {
  const pairs = [{ score: 0.1 }, { score: 0.9 }]
  const filtered = pairs.filter(p => p.score >= 0.3)
  assert.equal(filtered.length, 1)
})
```

### 2.6 e2e（`test/e2e/word-alignment.e2e.mjs`）

```javascript
test('hover 中文词 → 高亮英文原文', async ({ page }) => {
  await page.goto('/demo-aligned.html')
  await page.hover('[data-tgt="0"]')
  const highlighted = await page.locator('.src-highlight').count()
  assert.ok(highlighted > 0)
})
```

### 2.7 MVP 里程碑（1-2 周）

| 天 | 交付 |
|---|---|
| D1-D2 | 后端 PyTorch 跑 opus-mt，验证 attention 可导出 |
| D3-D4 | aligner 纯函数 + 单测（fixture attention） |
| D5-D6 | 前端 hover 高亮（最小 UI） |
| D7 | e2e + UI 截图 |
| D8-D14 | 真实文本测试 + 边界处理（BPE 续接、NaN、低置信） |

**失败判定**：
- D2 拿不到 attention → 中止模块 A，归档为调研
- D7 hover 高亮位置错乱超过 30% → 评估聚合策略改进

---

## 3. 模块 B：WebGPU 本地 NMT（演进，3-5 周）

**前置**：模块 A MVP 验证通过。

### 3.1 技术栈
- transformers.js v3（[Hugging Face](https://huggingface.co/docs/transformers.js)）
- ONNX 量化模型（opus-mt-en-zh int8，~80MB）
- WebGPU 推理（fallback wasm）
- Service Worker 缓存

### 3.2 路径选择
| 路径 | 模型大小 | 速度 | attention 暴露 |
|---|---|---|---|
| wasm | 80MB | 慢（5-10 tok/s） | ✅ |
| WebGPU | 80MB | 快（20+ tok/s） | ✅（需验证） |

**先 wasm 跑通，再加 WebGPU**。

### 3.3 共享 lib（与图搜项目复用）
- `lib/webgpu-engine.mjs` — 通用推理引擎
- `lib/model-cache.mjs` — Service Worker 缓存
- `lib/streaming-inference.mjs` — 流式推理

详见 `docs/shared-tech-stack.md`。

### 3.4 失败降级
- WebGPU 不支持 → 自动降级 wasm
- 浏览器跑不动 → 回退到云 LLM（无对齐）
- attention 在浏览器侧取不到 → 用模块 A 的后端 attention API

---

## 4. 实施路线（修正版）

```
Phase 1：模块 A MVP（1-2 周）★ 单点依赖，先验证
  └─ 路径 B（后端 PyTorch，不量化）
  └─ 里程碑：attention 投影可行

Phase 2：模块 A 完整化（1 周）
  ├─ 多头聚合策略（baseline: 最后层 head 平均）
  ├─ BPE token → char 映射
  ├─ 评估集（WPT-21 子集，~50 段）
  └─ 里程碑：对齐准确率可量化

Phase 3：模块 B WebGPU（2-3 周，可选）
  ├─ transformers.js + wasm baseline
  ├─ WebGPU 加速
  ├─ Service Worker 缓存
  └─ 里程碑：浏览器内 NMT 可用

Phase 4：UI 整合（1 周）
  ├─ 模式切换器（云/本地/学习）
  ├─ 双语对照 hover 高亮
  └─ 里程碑：用户可切换

Phase 5：评估 + 开源（3-5 天）
  ├─ benchmark（对齐质量 vs DeepL）
  ├─ 文档
  └─ 里程碑：可放 GitHub
```

**总工期**：MVP 1-2 周，完整 5-7 周。

---

## 5. 风险

| 风险 | 概率 | 缓解 |
|---|---|---|
| PyTorch attention 导出格式不符合预期 | 低 | D1-D2 先 spike |
| Marian BPE tokenization 中文不友好 | 中 | 改用 NLLB-200 distilled |
| transformers.js 不暴露 attention | 中 | 路径 B 已不依赖，模块 B 退化为「无对齐浏览器内 NMT」 |
| 量化质量太差 | 中 | 只做 EN→ZH |

---

## 6. 下一步

1. **D1 spike（4 小时）**：本地跑 PyTorch + opus-mt-en-zh，确认 attention 矩阵 shape 和质量
2. spike 通过 → 进 Phase 1
3. spike 失败 → 改用 NLLB-200 或 Bergamot
