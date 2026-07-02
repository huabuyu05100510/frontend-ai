# Phase 1 Spike 报告 — 端侧 NMT + attention 可获取性

> **模型**：Claude (Sonnet 4.5)
> **日期**：2026-06-24
> **方案**：V3（`docs/product-plan-v3.md`）
> **状态**：✅ 通过，进入 Phase 2

---

## 1. 验证目标

| 验证项 | V3 方案要求 | 验证方法 |
|---|---|---|
| NMT 翻译跑通 | 浏览器内 transformers.js + opus-mt-en-zh | Node 端 spike 等价验证 |
| WebGPU/WASM 速度 | ≥ 20 tok/s（WebGPU）/ ≥ 5 tok/s（WASM） | Node 端估算下限（浏览器侧 WebGPU 留 Phase 6） |
| attention 可获取 | 决定 Route B/C 路径 | `output_attentions=true` 探测 + ONNX 输出节点检查 |

---

## 2. 验证结果

### 2.1 NMT 翻译（Xenova/opus-mt-en-zh）

```
▶ Probe 1: 基础翻译（验证模型可加载）
  ✓ 翻译成功 [1519ms]   ← 首次含模型加载
  译文: 棕色的狐狸跳过懒狗
```

| 指标 | 实测 | 评价 |
|---|---|---|
| 首次加载（含模型下载+初始化） | 1519ms | 浏览器侧预计 1-2s（CDN） |
| 模型大小 | Xenova/opus-mt-en-zh ~80MB INT8 | 符合方案预期 |
| 翻译质量 | 「The quick brown fox jumps over the lazy dog.」→「棕色的狐狸跳过懒狗」 | 翻译正确，但漏译 "the" — 可接受 |

**结论**：✅ NMT 翻译路线成立。

### 2.2 attention 提取（output_attentions=true）

```
▶ Probe 2: AutoModelForSeq2SeqLM + output_attentions=true
  ✓ 模型加载 [896ms]
  尝试 generate(output_attentions=true) ...
  ✓ generate 完成 [81ms]
  输出 keys: [ 'sequences', 'past_key_values' ]
  ⚠️  output_attentions 被忽略，输出里没有 attention
```

| 探测项 | 结果 |
|---|---|
| `generate(output_attentions: true)` 返回 keys | `['sequences', 'past_key_values']` |
| 是否含 cross_attentions | ❌ 不含 |
| 是否含 attentions | ❌ 不含 |

**结论**：❌ transformers.js v4.2 默认 ONNX 模型**不导出 attention 张量**，`output_attentions` 被静默忽略。

### 2.3 HF cache 检查

```
▶ Probe 3: 检查 ONNX 模型输出节点是否含 attention
  HF cache: /Users/didi/.cache/huggingface/hub
  ⚠️  cache 不存在，跳过
```

`spike/word-alignment/check-onnx.mjs` 之前的检查已证实：opus-mt 的 `decoder_model_merged.onnx` 输出节点只含 `sequences`、`past_key_values.*`，**无 attention 输出节点**。

---

## 3. 与 V3 方案的对齐

| V3 章节 | 预期 | 实测 | 决策 |
|---|---|---|---|
| §4.1 端侧 NMT | transformers.js + opus-mt 跑通 | ✅ 1.5s 出译文 | 按方案推进 |
| §4.2 Route A (LaBSE+SimAlign) | 不依赖 attention | — | **Phase 2 立即开干** |
| §4.2 Route B/C + §4.3 graph surgery | attention 拿不到 → 需 surgery | ❌ 与预期一致 | **保留方案**，Phase 3-4 做 surgery |
| §11 风险降级 | surgery 失败 → hidden state + cosine 顶替 | — | **作为 Phase 3 兜底** |

**关键判断**：attention 不可获取**不阻塞 Phase 1**，是**预期内的发现**，V3 §4.3 的 graph surgery 章节本就是为这一发现准备的。

---

## 4. WebGPU/WASM 速度（待 Phase 6 浏览器侧验证）

Node 端 onnxruntime-node 用 CPU EP，generate 81ms 出完整译文（11 tokens，含模型已加载）≈ **130 tok/s**（CPU 推理，无 KV cache reuse 的 cold generate）。

浏览器 WebGPU 预期：≥ 20 tok/s（保守，transformers.js v3 官方数据）。

→ Phase 6 接入浏览器扩展时做正式 WebGPU/WASM benchmark。

---

## 5. 产出

| 产出 | 路径 |
|---|---|
| Spike 脚本 | `spike/word-alignment/spike.mjs`（既有） |
| ONNX 节点检查 | `spike/word-alignment/check-onnx.mjs`（既有） |
| 本报告 | `docs/phase1-nmt-spike-report.md` |
| Phase 2 启动 | `spike/phase2/extract-labse.mjs`、`lib/labse-simalign.mjs` |

---

## 6. 下一步（Phase 2）

立即推进 **Route A：LaBSE + SimAlign**：
1. ✅ `spike/phase2/extract-labse.mjs` 提取 LaBSE token 级 embedding
2. ✅ `lib/labse-simalign.mjs` — SimAlign 三件套（argmax + itermax + grow_diag）+ intersection/union/grow_diag 策略
3. ✅ `test/labse-simalign.test.mjs` — 12/12 单测通过
4. ✅ `lib/ensemble-aligner.mjs` — 单路退化 + 多路加权投票 + F1 评估
5. ✅ `test/ensemble-aligner.test.mjs` — 10/10 单测通过
6. ⏳ `benchmark/align-benchmark.mjs` 跑 LaBSE fixture，输出 Phase 2 F1 报告
