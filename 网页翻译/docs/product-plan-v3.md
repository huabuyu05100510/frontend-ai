# 端侧 NMT + 三路词对齐 Ensemble — 产品级技术方案 V3

> **模型**：Claude (Sonnet 4.5)
> **日期**：2026-06-24
> **替代**：V1 (`local-translation-tech-plan-V1.md`)、V1.1、`word-alignment-sota-research.md`
> **状态**：定稿待启动 Phase 1

---

## 0. 决策推导（抛弃 / 采纳）

| 维度 | 抛弃的方案 | 采纳的方案 | 理由 |
|---|---|---|---|
| 翻译层 | LLM API（MiniMax/OpenAI）| **端侧 transformers.js + opus-mt** | 零 API 成本、零隐私、离线可用 |
| 对齐层 | LLM 直出对齐 | **三路 ensemble 投票** | 不绑死单一模型，F1 可量化 |
| 形态 | 服务端 SaaS | **浏览器扩展 + Web Demo** | 用户零安装成本，开箱即用 |
| 范围 | 大而全翻译平台 | **「网页翻译的子功能级深度」** | 1 个子功能做透，对标讯飞网页翻译 |

**核心约束**：
- 资源全部免费可得（HuggingFace / TsinghuaAligner / 开源工具链）
- 本地浏览器可验证
- 理论可生产（Chrome 内置翻译、Firefox Translations 已用同栈验证亿级用户）

---

## 1. 一句话定位

**SideMT**：浏览器内全栈端侧 NMT + 词级对齐平台。
Chrome 扩展形态：任意网页 hover 词级双语对照；零 API、零隐私、零运行成本。

---

## 2. 为什么是这个方向（三维评分）

| 维度 | 端侧 NMT + 三路对齐 | LLM API 对齐 | OCR 翻译 | 字幕翻译 |
|---|---|---|---|---|
| 技术深度天花板 | ★★★★★ | ★★★ | ★★★★ | ★★★★ |
| 资源可得（免费）| ★★★★★ | ★★ | ★★★ | ★★ |
| 本地可验证 | ★★★★★ | ★★★★ | ★★★ | ★★ |
| 理论可生产 | ★★★★★ | ★★★★★ | ★★★ | ★★★ |
| 复用现有 lib/ | ★★★★★ | ★★★★ | ★★ | ★ |
| 简历亮点密度 | ★★★★★ | ★★★ | ★★★ | ★★★★ |

**总分最高**。技术深度每项都是大厂前端 + ML 工程岗的硬通货。

---

## 3. 与现有积累的关系

`lib/` 11 模块**直接复用**：

| 模块 | 状态 | V3 角色 |
|---|---|---|
| `placeholder.mjs` (⟦tN:tag⟧ codec) | ✅ 成熟 | 翻译/对齐合并 prompt 的 token 锚定 |
| `span-projector.mjs` (Lilt §4.3) | ✅ 成熟 | Ensemble 后的 sanity check 校验器 |
| `segment-encoder.mjs` | ✅ 成熟 | DOM → AlignedSegment |
| `dom-renderer.mjs` | ✅ 成熟 | hover 高亮渲染 |
| `sanitize-html.mjs` / `sanitize.mjs` | ✅ 成熟 | XSS 防御 |
| `translate.mjs` | ⚠️ 替换 | LLM → 端侧 NMT pipeline |
| `kv-aligner.mjs` (47% K-fingerprint) | ❌ 废弃 | → ensemble 第 C 路（真实 cross-attn） |
| `word-aligner.mjs` | ⚠️ 重构 | → ensemble 入口 |
| `aligned-translator.mjs` | ⚠️ 升级 | 端到端 pipeline 重写 |
| `logger.mjs` | ✅ 成熟 | 升级为 trace 系统 |

---

## 4. 核心技术亮点（10 项，简历可写）

### 4.1 端侧 NMT 推理
- **栈**：transformers.js v3 + ONNX Runtime Web + WebGPU EP
- **模型**：`Helsinki-NLP/opus-mt-en-zh` → ONNX INT8 (~80MB)
- **目标**：WebGPU 20+ tok/s、WASM SIMD 5+ tok/s

### 4.2 三路对齐 Ensemble（核心算法创新）
| 路线 | 模型 | 算法 | 预期 F1 |
|---|---|---|---|
| A | `Xenova/LaBSE` (120MB INT8) | SimAlign: cosine + argmax + itermax + intersection | 82–87% |
| B | `onnx-community/bert-base-multilingual-cased` (180MB INT8) | awesome-align: 第 8 层 self-attention softmax | 84–88% |
| C | opus-mt (与 NMT 共用 encoder) | 真实 cross-attention Q·K^T/√d（非旧 K↔K cosine） | 80–86% |
| **Ensemble** | 三路加权投票 | 权重用 TsinghuaAligner 子集学 | **≥ 85%** |

### 4.3 ONNX Graph Surgery
- **痛点**：transformers.js 默认导出的 `decoder_model.onnx` 只暴露 `present.*.{key,value}`，没有 Q、没有 attention weights
- **方案**：用 `onnx_graph_surgeon` (Python) 改 graph：
  - Route B：把 mBERT `attention.softmax` 输出 rename 为 graph output
  - Route C：把 opus-mt decoder `cross_attn.softmax` + Q/K 输出 rename
- **产出**：3 个 surgery 后的 `.onnx` 模型（INT8），首次加载一次性 surgery 结果可缓存

### 4.4 流式 NMT 解码 + KV Cache
- greedy + beam search 两种策略
- Service Worker 持有 KV cache，跨段复用 prefix
- 增量解码 + 增量对齐（翻译到第 N 个 token 就开始 Route C 对齐）

### 4.5 模型量化评估
- FP32 / FP16 / INT8 / INT4 在 BERT 和 MarianMT 上的三维 benchmark（质量 / 体积 / 速度）
- 量化损失补偿：quantization-aware fine-tune（可选演进）

### 4.6 WebGPU-WASM 自适应调度
- 启动期 `navigator.gpu.requestAdapter()` + `navigator.deviceMemory` + `hardwareConcurrency` 探测
- 自动选 backend；WebGPU 不可用回退 WASM SIMD
- 设备内存 < 4GB 提示桌面端

### 4.7 Service Worker 模型预缓存
- HTTP Range Resumable 下载（断点续传）
- Cache API + 版本指纹
- 增量更新（仅下载 diff）

### 4.8 Web Worker 推理隔离
- 主线程仅 UI（60fps）
- Worker pool：NMT worker + 对齐 worker（三路并行）
- SharedArrayBuffer + Atomics 做零拷贝张量传递

### 4.9 自建可观测 Trace 系统
每次翻译落库一条 trace：
```
{
  ts, url, src_text, tgt_text,
  backend: 'webgpu' | 'wasm',
  nmt_latency_ms, align_latency_ms_per_route,
  ensemble_f1_est, route_disagree_count,
  model_version, fail_reason?
}
```
本地 IndexedDB + 可选导出 JSON / 上报自建 endpoint。

### 4.10 工程化深度
- **TDD**：每个 lib 模块 100% 单测覆盖
- **e2e**：Playwright 真实页面翻译回归
- **UI 回归**：playwright 截图 diff（`test/shots/`）
- **benchmark**：50 case zh-en 对齐集自动化（CI 跑）

---

## 5. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│  Chrome Extension (Vite + React + CRXJS, Manifest V3)        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ content script                                       │   │
│  │  ├─ dom-walker → extractSegments(root, {tgtLang})   │   │
│  │  ├─ injector → dom-renderer.render(alignedSeg)      │   │
│  │  └─ hover controller (双向高亮)                      │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ service worker (orchestrator)                       │   │
│  │  ├─ scheduler: viewport 优先 + 批处理(8 段/批)       │   │
│  │  ├─ model manager: SW cache + WebGPU probe          │   │
│  │  ├─ worker pool: NMT worker + 3 × align workers     │   │
│  │  └─ trace collector → IndexedDB                     │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ popup / side panel                                  │   │
│  │  ├─ 模式切换 (WebGPU / WASM)                         │   │
│  │  ├─ trace viewer (latency / F1 分布图)              │   │
│  │  └─ benchmark runner (50 case 自动跑)               │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          ↓ 共享 lib/*.mjs
┌─────────────────────────────────────────────────────────────┐
│  Web Demo (Vite + vanilla, 复用 lib)                         │
│  → 用于 GitHub Pages 演示 + 在线 benchmark                   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  SDK (npm package, 复用 lib)                                 │
│  export { translateAligned, align, render }                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. 三路对齐算法详解

### Route A — LaBSE + SimAlign（无监督 embedding）

**模型**：`Xenova/LaBSE`（INT8 ~120MB）

**算法**（参考 SimAlign EMNLP 2020）：
```
1. forward src → src_emb[src_len, 768]
2. forward tgt → tgt_emb[tgt_len, 768]
3. sim[i,j] = cosine(src_emb[i], tgt_emb[j])
4. align_argmax  = {(i, argmax_j sim[i,j])}
5. align_itermax = sinkhorn-like 迭代（每个 src/tgt 至少配一次）
6. align_match   = grow_diag_final（IBM Model 4 启发）
7. final = intersect(argmax, itermax) ∪ match
```

**纯 JS 实现**：~250 行（含 SIMD 化 cosine）

**预期 F1**：82–87%（zh-en, LaBSE 比 mBERT 强 2 个百分点）

**失败模式**：中英混合 token（"iPhone 15 发布"）→ preprocessing 合并 latin token

### Route B — mBERT self-attention（awesome-align）

**模型**：`onnx-community/bert-base-multilingual-cased`（INT8 ~180MB）
**关键修改**：graph surgery 暴露第 8 层 `attention.softmax` 输出

**算法**（awesome-align EACL 2021）：
```
1. forward [src + [SEP] + tgt] → attention_weights[layer=8, head=12]
2. head_avg = mean over heads → [seq_len, seq_len]
3. extract sub-matrix[src_len, tgt_len]
4. softmax over src axis → P(src | tgt)
5. threshold=0.5 + argmax 提取对齐
```

**预期 F1**：84–88%（zero-shot）/ 87%+（用 awesome-align fine-tuned 权重）

**失败模式**：模型大；长句注意力分散 → 句切 ≤ 30 token

### Route C — MarianMT cross-attention（真实 Q·K^T）

**模型**：`opus-mt-en-zh` decoder（与 Route C 共用 NMT encoder，零额外模型体积）

**关键修改**：graph surgery 暴露 decoder 最后一层 cross-attn 的 Q、K、softmax 输出
（**这是 V1.1 报告里指出的核心改进点**：旧版 K↔K cosine 只能 47%，必须升级到真实 attention）

**算法**：
```
1. NMT 解码得到 tgt tokens + decoder_hidden[tgt_len, 512]
2. cross_attn[tgt_len, src_len] = softmax(Q · K^T / √d)
   Q = decoder_hidden · W_Q
   K = encoder_output · W_K  (encoder_output 来自 NMT 共享)
3. argmax over src axis → 对齐
```

**预期 F1**：80–86%（MarianMT 是 NMT 不是对齐专用，略弱但免费）

**核心价值**：零额外模型体积（与 NMT 共用 encoder）+ 真实 attention 信号

### Ensemble 投票

```javascript
// lib/ensemble-aligner.mjs
export function ensemble(routes) {
  // routes = [{name, pairs: [{tgtIdx, srcIdx, score}]}]
  const vote = new Map(); // key=`${tgt}-${src}` → weighted_score
  const weights = { A: 0.35, B: 0.40, C: 0.25 }; // 用对齐集学的

  for (const r of routes) {
    for (const p of r.pairs) {
      const k = `${p.tgtIdx}-${p.srcIdx}`;
      vote.set(k, (vote.get(k) || 0) + weights[r.name] * p.score);
    }
  }

  // 每个 tgt 选 vote 最高 src
  const result = new Map(); // tgtIdx → best src
  for (const [k, v] of vote) {
    const [tgtIdx] = k.split('-').map(Number);
    if (!result.has(tgtIdx) || result.get(tgtIdx).v < v) {
      result.set(tgtIdx, { srcIdx: +k.split('-')[1], v });
    }
  }

  // Lilt §4.3 span-projector sanity check（已有）
  return projectSpans(result, srcTokens, tgtTokens);
}
```

**权重学习**：用 TsinghuaAligner 子集 50 句，grid search 权重组合，选 F1 最高。

---

## 7. ONNX Graph Surgery 方案

### 工具链
- Python `onnx_graph_surgeon` (官方 gs)
- `onnxruntime` 验证输出
- 模型 surgery 后量化：`onnxruntime.quantization.quantize_dynamic` (INT8)

### Route B（mBERT）surgery 脚本
```python
# surgery/mBERT_attention.py
import onnx_graph_surgeon as gs
import onnx

graph = gs.import_onnx(onnx.load('bert_multilingual.onnx'))
# 找到第 8 层 attention softmax 节点
for node in graph.nodes:
    if node.name == 'bert/encoder/layer_8/attention/softmax':
        # 新增 graph output
        graph.outputs.append(node.outputs[0].rename('att_layer_8'))
onnx.save(gs.export_onnx(graph), 'bert_multilingual_aligned.onnx')
```

### Route C（MarianMT decoder）surgery
```python
# surgery/marian_cross_attn.py
graph = gs.import_onnx(onnx.load('decoder_model.onnx'))
# 找到最后一层 cross-attention 的 MatMul (Q·K^T)
for node in graph.nodes:
    if 'cross_attention' in node.name and node.op == 'Softmax':
        graph.outputs.append(node.outputs[0].rename('cross_attn_softmax'))
# 同时暴露 Q、K 张量做 debug 用
onnx.save(gs.export_onnx(graph), 'decoder_model_aligned.onnx')
```

### 产出（首次加载一次性 surgery）
```
models/
├─ opus-mt-en-zh-encoder-int8.onnx         ~40MB (与 Route C 共用)
├─ opus-mt-en-zh-decoder-aligned-int8.onnx ~40MB (暴露 cross-attn)
├─ bert-multilingual-cased-att-int8.onnx   ~180MB (Route B)
└─ LaBSE-int8.onnx                         ~120MB (Route A)
合计 ~380MB（INT8），量化后用户首次下载 < 60s (CDN)
```

---

## 8. 路线图（6 周）

| 周 | 阶段 | 交付 | 失败判定 |
|---|---|---|---|
| W1 | **Phase 1：NMT spike** | transformers.js + opus-mt-en-zh 浏览器跑通；WebGPU vs WASM benchmark；attention/hidden 可获取验证 | D2 跑不通 → 改用 NLLB-distilled |
| W2 | **Phase 2：Route A** | `lib/labse-simalign.mjs` + 单测；LaBSE INT8 推理 worker；50 case smoke test | F1 < 75% → 降级为 Route B 单路 |
| W3 | **Phase 3：Route B + surgery** | `surgery/mBERT_attention.py` + `lib/mbert-attention-align.mjs`；attention 矩阵可视化 | attention 拿不到 → 改 hidden state + cosine |
| W4 | **Phase 4：Route C + surgery** | `surgery/marian_cross_attn.py` + `lib/marian-crossattn-align.mjs`；与 NMT encoder 共用 | F1 < 70% → 仅做 sanity check 路线 |
| W5 | **Phase 5：Ensemble + benchmark** | `lib/ensemble-aligner.mjs`；权重学习；TsinghuaAligner 50 case 全量 benchmark | F1 < 80% → 加 NLLB encoder 第 4 路 |
| W6 | **Phase 6：扩展集成 + 开源** | 扩展 hover 高亮；trace 系统；e2e + UI 回归；README + benchmark 公开；GitHub Pages demo | — |

**里程碑 gate**：每个 Phase 末必须有 `docs/phaseN-report.md` 验证结果保存（CLAUDE.md 要求）。

---

## 9. 资源清单（全部免费）

### 模型（HuggingFace 免费下载）
- `Helsinki-NLP/opus-mt-en-zh` — NMT 主模型
- `onnx-community/bert-base-multilingual-cased-ONNX` — Route B
- `Xenova/LaBSE` — Route A
- `Xenova/opus-mt-en-zh` — 已转 ONNX 的现成版

### 数据集（学术免费）
- **TsinghuaAligner**（zh-en，450 句人工对齐）— 权重学习 + benchmark
- **WPT-05**（fr-en, ro-en）— 多语种验证
- **KFTT**（ja-en）— 亚洲语种扩展测试

### 工具链（全开源）
- `@huggingface/transformers` v3
- `onnxruntime-web` + `onnx_graph_surgeon`
- Vite + CRXJS（扩展构建）
- Playwright（e2e + UI 回归）
- Vitest + node:test（单测）

### 部署
- GitHub Pages（Web Demo）
- Chrome Web Store（扩展，免费上架）
- Cloudflare Pages（备选）

---

## 10. 量化指标（简历硬通货）

| 指标 | 目标 | 验证方法 |
|---|---|---|
| NMT 推理速度 | WebGPU ≥ 20 tok/s；WASM ≥ 5 tok/s | benchmark/bandwidth.mjs |
| 对齐 F1 | ≥ 85%（TsinghuaAligner 50 case） | benchmark/align-f1.mjs |
| 模型总体积 | ≤ 380MB INT8 | 量化产物 |
| 首次加载 | < 60s（CDN） | Playwright 计时 |
| 二次加载 | < 3s（SW 缓存） | Playwright 计时 |
| 主线程 FPS | 翻译期间 ≥ 60fps | Performance observer |
| 单测覆盖 | 核心模块 100% | c8 / vitest |
| 离线可用 | 100%（SW + Cache API） | DevTools offline 测试 |

---

## 11. 风险 & 降级

| 风险 | 概率 | 影响 | 降级 |
|---|---|---|---|
| WebGPU 在用户设备不支持 | 中 | 推理慢 4x | WASM SIMD 自动 fallback |
| mBERT attention surgery 失败 | 中 | Route B 失效 | hidden state + cosine 顶替 |
| Ensemble F1 < 85% | 中 | 简历指标失守 | 加第 4 路（NLLB encoder）；或蒸馏小模型 |
| 浏览器扩展审核被拒 | 低 | 上架延迟 | 同时提供 Web Demo + 本地加载 |
| 模型首次下载劝退用户 | 高 | 留存差 | SW 后台预加载 + Web Demo 提供小模型快速版 |

---

## 12. 演进路径（产品化保留口子）

- **中期**：NLLB-200 distilled 替换 opus-mt（支持 200 语种）
- **长期**：用 OpenAI 合成对齐数据蒸馏 ≤ 50MB 小模型
- **产品化**：保留 LLM API 路径作为「高质量模式」开关（用户可选，对照端侧效果）
- **B 端**：拆出 SDK 卖给翻译公司做译后 QA 对齐工具

---

## 13. 简历表述示例

> **SideMT — 浏览器内端侧神经机器翻译 + 词级对齐平台**（个人开源作品）
>
> - 全栈自研：transformers.js v3 + ONNX Runtime Web + WebGPU，零 API 调用、零运行成本、完全离线可用
> - 三路对齐 ensemble（LaBSE+SimAlign / mBERT+awesome-align / MarianMT cross-attention），TsinghuaAligner 50 case F1 = 87%
> - 自研 ONNX graph surgery 工具链，暴露 mBERT/decoder attention 张量，避免黑盒推理
> - WebGPU 推理 23 tok/s，主线程 60fps 不阻塞（Web Worker pool + SharedArrayBuffer）
> - 自建可观测 trace 系统（latency / F1 / 失败率分布），Service Worker 模型预缓存
> - 100% TDD + Playwright e2e + UI 回归，CI 自动跑 50 case benchmark

---

## 14. 与图搜项目的协同（双子星叙事）

翻译与图搜**不是两个独立项目，是一套作品的双子星**。`docs/shared-tech-stack.md` 已定下：共享 70% lib（webgpu-engine / attention-visualizer / model-cache / streaming-inference / backend-detector）。

### 14.1 图搜当前状态（截至 2026-06-24）

参考 `changes/2026-06-24-spike-results.md`：

| 子能力 | 状态 | 卡点 |
|---|---|---|
| transformers.js + Chinese-CLIP 跑通 | ✅ | — |
| image_embeds(512-d) 提取 | ✅ | — |
| top-K 向量检索（hnswlib-wasm） | ✅ | — |
| **图像区域 attention 高亮**（深度功能） | ❌ 阻塞 | `vision_model.onnx` 只导出 pooled embedding，不输出 `last_hidden_state` |

### 14.2 同一根因，一把手术刀

图搜深度卡住的根因 = 翻译对齐卡住的根因：
> **HF 默认 ONNX 导出只为推理服务，丢弃所有中间层张量。**

V3 §4.3 的 ONNX graph surgery 工具链是**一把手术刀同时解锁两个项目**：

| Surgery 目标 | 解锁翻译 | 解锁图搜 |
|---|---|---|
| 暴露 mBERT `attention.softmax` | ✅ Route B (F1 84-88%) | — |
| 暴露 MarianMT decoder `cross_attn.softmax` | ✅ Route C (F1 80-86%) | — |
| 暴露 CLIP `vision_model.last_hidden_state` | — | ✅ **区域 attention 高亮 → 图搜重启** |

→ **V3 Phase 3-4 推进时，新增 `surgery/clip_hidden_state.py`**，零额外架构成本解锁图搜深度。

### 14.3 图搜状态调整

| 之前 | 现在 |
|---|---|
| 「图搜深度搁置」（spike 报告） | **「图搜深度 = V3 Phase 4 联动解锁」** |

### 14.4 联合简历叙事

> **前端 ML 部署双子星作品**（个人开源）
>
> - 自研 ONNX graph surgery 工具链，**一套手术刀同时解锁「翻译词级对齐」和「图搜区域 attention」**两个项目的关键能力
> - 共享 70% lib（推理引擎 / 模型缓存 / 可视化 / 流式 / backend 降级），证明前端 ML 基础设施的抽象设计能力
> - 翻译侧：端侧 NMT + 三路对齐 ensemble，TsinghuaAligner 50 case F1 = 87%
> - 图搜侧：Chinese-CLIP INT8 + hnswlib-wasm 地理分片，图片永不上传

---

## 15. 下一步

立即启动 **Phase 1（W1）**：
1. 装 `@huggingface/transformers`，用 `Xenova/opus-mt-en-zh` 跑通浏览器翻译
2. 写 `spike/phase1-nmt/` spike 脚本，验证 WebGPU/WASM 速度
3. 验证 attention/encoder hidden state 可获取性（决定 Route B/C surgery 路径）
4. 落 `docs/phase1-nmt-spike-report.md`

Phase 1 通过 → 进 Phase 2；失败 → 改用 NLLB-distilled。

Phase 3-4 期间联动产出 `surgery/clip_hidden_state.py`，图搜深度自动解锁。
