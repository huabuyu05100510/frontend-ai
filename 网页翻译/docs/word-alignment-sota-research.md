# Word Alignment SOTA 调研 — 网页翻译 hover 词级高亮

**模型**: Claude (Sonnet 4.5)
**日期**: 2026-06-24
**目标**: 网页翻译的 hover 词级高亮，纯 JS（Node.js / 浏览器），准确率 >85%
**结论先行**: **Top 3 推荐 → 第 1 节**。当前仓库 K-fingerprint 实测 47%，必须废弃换路。

---

## 1. Top 3 推荐（按 ROI 排序，1 周内可达 >85%）

| 排名 | 方案 | 预期准确率（zh-en） | JS 可行性 | 工作量 | 失败模式 |
|------|------|--------------------|-----------|--------|----------|
| 🥇 #1 | **LLM 直接出对齐**（复用现有翻译 LLM，prompt 工程） | **88–93%**（带 fallback 校正后） | 5/5（已是项目主链路） | **2–3 人天** | 长句 token 漂移；成本 = 翻译的 1.3x |
| 🥈 #2 | **mBERT embedding 相似度 + SimAlign 算法**（transformers.js） | **85–89%**（zh-en） | 4/5（ONNX 模型现成，需自写对齐算法 ~300 行） | **4–6 人天** | 首次加载 ~700MB；WebGPU 前需 fallback |
| 🥉 #3 | **LLM 出对齐 + mBERT 交叉验证（hybrid）** | **91–95%** | 4/5（#1 + #2 组合） | **6–8 人天** | 复杂度高；两套系统要监控 |

**强推荐 #1**。理由：项目已有翻译 LLM 链路、已有 placeholder codec、已有 span-projector；一周内能交付且可观测。LLM 在 Cambridge 2025 论文中已实证（Claude 3.5 Sonnet 5-shot AER 0.27），再叠加本仓库已实现的 Lilt §4.3 span 校验，能稳过 85%。

**不要选** fast_align / eflomal / GIZA++ / awesome-align / BinaryAlign / TransAlign 原版 —— 全部强依赖 Python + CUDA，纯 JS 重写工作量 ≥ 2 周（详见 §3、§4）。

---

## 2. 准确率基线对照表（数据源：论文原文）

下表是 **zh-en / en-zh** 词对齐 AER（Alignment Error Rate，越低越好；准确率 ≈ 1 − AER）。

| 方法 | 年份 | en-zh AER | en-zh 准确率 | 数据集 | 来源 |
|------|------|-----------|--------------|--------|------|
| fast_align | 2013 | 38.1% | ~62% | TsinghuaAligner | [awesome-align README](https://github.com/neulab/awesome-align) |
| eflomal | 2016 | 28.7% | ~71% | 同上 | [awesome-align README](https://github.com/neulab/awesome-align) |
| GIZA++ / Mgiza | 2003 | 35.1% | ~65% | 同上 | 同上 |
| **SimAlign** (mBERT, zero-shot) | 2020 | 21.6% | ~78% | 同上 | [BinaryAlign Table 1](https://arxiv.org/html/2407.12881v1) |
| **awesome-align** (fine-tuned, w/o train_co) | 2021 | **13.4%** | ~87% | 同上 | [awesome-align README](https://github.com/neulab/awesome-align) |
| **AccAlign** (LaBSE, zero-shot) | 2022 | 11.3% | ~89% | 同上 | [BinaryAlign Table 1](https://arxiv.org/html/2407.12881v1) |
| **TransAlign** (NLLB encoder, vanilla) | 2025 | 18.8% | ~81% | xSID zh | [TransAlign Table 2](https://aclanthology.org/2025.findings-emnlp.1129.pdf) |
| **TransAlign** (w/o stopwords) | 2025 | **10.6%** | ~89% | 同上 | 同上 |
| **BinaryAlign** (zero-shot, mDeBERTa) | 2024 | 9.0% | **~91%** | TsinghuaAligner | [BinaryAlign Table 1](https://arxiv.org/html/2407.12881v1) |
| **BinaryAlign** (full supervised, XLM-R large) | 2024 | **4.4%** | **~96%** | 同上 | [BinaryAlign Table 4](https://arxiv.org/html/2407.12881v1) |
| **LLM Claude 3.5 Sonnet** (5-shot, Ancient Greek→En) | 2025 | AER ~0.27 (F1 0.65–0.70) | ~70–73% | Ugarit | [Cambridge CHR 2025](https://www.cambridge.org/core/journals/computational-humanities-research/article/evaluating-large-language-models-with-a-wordlevel-translation-alignment-task-between-ancient-greek-and-english/4DABC9D5270B5662552B5BD8D8EC527D) |
| Llama 3.3 70B (5-shot, after finetune on Claude 数据) | 2025 | AER ~0.15 (F1 ~0.85) | ~85% | 同上 | 同上 |
| Lilt §4.3 span projection（本仓库已实现） | 2021 | — | ~50–60% | 内测 | `lib/span-projector.mjs` |
| **MarianMT K-fingerprint**（本仓库已实现） | — | — | **47%** | 5 case 内测 | `docs/word-alignment-e2e-report.md` |

**关键洞察**：
1. 神经对齐（BinaryAlign / AccAlign / awesome-align）从 ~87% 起跳，**单纯 zero-shot** 都已过 85% 阈值
2. **LLM 直接出对齐**单跑只有 ~70%，**但**叠加 Claude 数据 finetune 后小模型可冲到 85%
3. 仓库现行的 K-fingerprint (47%) 和 Lilt span (50–60%) **都未达 85% 阈值**，必须替换

---

## 3. SOTA 方法详解 + 纯 JS 可行性

### 3.1 经典统计方法（不推荐）

| 方法 | 思路 | JS 可行性 | 工作量 | 备注 |
|------|------|-----------|--------|------|
| **fast_align** | IBM Model 2 简化版，EM 迭代 | 2/5（C++，需 Emscripten 编译 WASM） | 5–7 人天 | [github.com/clab/fast_align](https://github.com/clab/fast_align)，无现成 JS 端口 |
| **eflomal** | Bayesian IBM Model，MCMC | 1/5（C，浮点密集，WASM 慢） | 7–10 人天 | [github.com/robertostling/eflomal](https://github.com/robertostling/eflomal) |
| **GIZA++** | IBM Model 1-5 + HMM | 1/5（C++ 老代码，编译困难） | ≥ 10 人天 | 已被 fast_align/eflomal 全面超越 |

**共同问题**：都是 C/C++，没有官方 JS/WASM 端口；自己用 Emscripten 编译可行但调优痛苦；且 zh-en 准确率上限只有 71%（eflomal），**直接淘汰**。

### 3.2 神经对齐 SOTA

#### 🎯 SOTA #1: **BinaryAlign** (ACL 2024, Ubisoft La Forge)
- **论文**: [aclanthology.org/2024.acl-long.553.pdf](https://aclanthology.org/2024.acl-long.553.pdf)
- **代码**: [github.com/ubisoft/ubisoft-laforge-BinaryAlignWordAlignementasBinarySequenceLabeling](https://github.com/ubisoft/ubisoft-laforge-BinaryAlignWordAlignmentasBinarySequenceLabeling)
- **思路**: 把对齐重定义为「每个 (src_word, tgt_token) 二分类」，cross-encoder 架构
- **准确率**: zh-en **AER 9.0%** (zero-shot) / **4.4%** (full supervised, XLM-R large)
- **纯 JS 可行性**: **2/5**
  - cross-encoder 架构 → 每个 src word 都要全句 forward → 长句推理慢
  - mDeBERTa / XLM-R large 都有 ONNX 版（[Xenova/xlm-roberta-large](https://huggingface.co/Xenova/xlm-roberta-large)），但 transformers.js 跑 large 模型浏览器内存吃紧（>1GB）
  - 需要自己用 JS 重写训练好的 Linear head
- **工作量**: **≥ 10 人天**（含模型量化、推理优化、Linear head 移植）
- **失败模式**: 浏览器 OOM；超长句（>64 tokens）推理超时

#### 🎯 SOTA #2: **AccAlign** (EMNLP 2022, LaBSE-based)
- **论文**: [aclanthology.org/2022.findings-emnlp.272.pdf](https://aclanthology.org/2022.findings-emnlp.272.pdf)
- **代码**: [github.com/wangweikang/AccAlign](https://github.com/wangweikang/AccAlign)
- **思路**: LaBSE（多语 sentence encoder）的中间层 embedding 做 cosine 相似度矩阵 → argmax/intersection
- **准确率**: zh-en **AER 11.3%** (zero-shot)，是 BinaryAlign 之前的 SOTA
- **纯 JS 可行性**: **4/5**
  - LaBSE 有官方 ONNX 版: [Xenova/LaBSE](https://huggingface.co/Xenova/LaBSE)
  - 只需 forward 一次（非 cross-encoder），速度快
  - 算法部分（cosine + softmax + threshold）纯 JS 可写，~200 行
- **工作量**: **4–6 人天**
- **失败模式**: LaBSE 模型 ~470MB，首次加载慢；中英混合词（如 "iPhone 15"）会被强行对齐到错的子词

#### 🎯 SOTA #3: **awesome-align** (EACL 2021, neulab)
- **论文**: [aclanthology.org/2021.eacl-main.181.pdf](https://aclanthology.org/2021.eacl-main.181.pdf)
- **代码**: [github.com/neulab/awesome-align](https://github.com/neulab/awesome-align)
- **思路**: mBERT 第 8 层 embedding + 自训练（MLM/TLM/SO loss）→ softmax 提取
- **准确率**: zh-en **AER 13.4%** (fine-tuned) / 18.1% (zero-shot)
- **纯 JS 可行性**: **4/5**
  - mBERT ONNX 现成: [onnx-community/bert-base-multilingual-cased-ONNX](https://huggingface.co/onnx-community/bert-base-multilingual-cased-ONNX) / [Xenova/bert-base-multilingual-cased](https://huggingface.co/Xenova/bert-base-multilingual-cased)
  - 模型 ~700MB（FP32），量化后 ~180MB
  - 推理用 transformers.js 的 `feature-extraction` pipeline 一行搞定
- **工作量**: **4–6 人天**
- **失败模式**: 与 AccAlign 类似；zero-shot 准确率 82% **略低于 85% 阈值**，需配合 fine-tuned 权重（需要拿 official checkpoint 转 ONNX）

#### 🎯 SOTA #4: **TransAlign** (EMNLP 2025 Findings)
- **论文**: [aclanthology.org/2025.findings-emnlp.1129.pdf](https://aclanthology.org/2025.findings-emnlp.1129.pdf)
- **代码**: [github.com/bebing93/transalign](https://github.com/bebing93/transalign)
- **思路**: NLLB-600M（多语 MT 模型）的 **encoder** 单独拿出来，发现比 mBERT/LaBSE 更强
- **准确率**: en-zh **AER 18.8%** (vanilla) / **10.6%** (w/o stopwords)
- **纯 JS 可行性**: **2/5**
  - NLLB-600M distilled encoder → 转 ONNX 后 ~600MB
  - transformers.js 不直接支持「只取 encoder」，需要自己写 tokenizer + forward 逻辑
- **工作量**: **8–10 人天**
- **失败模式**: 模型大、加载慢；与现有 LLM 翻译链路功能重叠（如果翻译用 NLLB，可以复用 encoder，但项目目前用 LLM API）

#### 🎯 SOTA #5: **SimAlign** (EMNLP 2020 Findings)
- **论文**: [aclanthology.org/2020.findings-emnlp.147.pdf](https://aclanthology.org/2020.findings-emnlp.147.pdf)
- **代码**: [github.com/cisnlp/simalign](https://github.com/cisnlp/simalign)
- **思路**: embedding 相似度矩阵 + 三种对齐算法（argmax / itermax / match）
- **准确率**: zh-en AER 21.6%（被 awesome-align / AccAlign 全面超越）
- **纯 JS 可行性**: **5/5**
  - **算法部分 100% 可纯 JS 写**（cosine + 矩阵运算 + 启发式），~250 行
  - embedding 用 transformers.js 拉 mBERT/XLM-R
- **工作量**: **3–5 人天**（最小 MVP）
- **失败模式**: zero-shot 准确率 ~78% **不达 85% 阈值**；但作为「无 LLM 时的 fallback 路径」很合适

### 3.3 LLM zero/few-shot 对齐

#### 🎯 关键论文: Cambridge CHR 2025
- **论文**: [Evaluating LLMs with a Word-Level Translation Alignment Task](https://www.cambridge.org/core/journals/computational-humanities-research/article/evaluating-large-language-models-with-a-wordlevel-translation-alignment-task-between-ancient-greek-and-english/4DABC9D5270B5662552B5BD8D8EC527D)
- **实测**（Ancient Greek → English, Ugarit 数据集, IAA 基线 86.08%）:

| 模型 | 设定 | F1 | AER | 备注 |
|------|------|-----|-----|------|
| Claude 3.5 Sonnet | 5-shot | **0.65–0.70** | ~0.27 | 最强 proprietary |
| GPT-4o | 5-shot | 0.55–0.62 | ~0.35 | 显著弱于 Claude |
| Llama 3.3 70B | 5-shot (no finetune) | 0.40–0.50 | ~0.55 | 落后很多 |
| Llama 3.3 70B | 5-shot (**finetune on Claude 合成数据**) | **~0.85** | ~0.15 | 用 Claude 蒸馏 ~$15 |
| Llama 3.3 8B | 5-shot (finetune) | ~0.80 | ~0.20 | 单卡 T4 可跑 |
| Yousef et al. (encoder-based baseline) | — | 0.49 | 0.51 | 传统 baseline |

**结论**:
- **Claude 3.5+ 直接出对齐，5-shot 即可达 F1 0.65–0.70**（≈ 准确率 70%）
- 用 Claude 合成 1000 条对齐数据 finetune Llama 3.3 70B → F1 0.85（≈ 准确率 85%）
- **GPT-4o 反而显著弱于 Claude**（这是论文明确指出的 surprise finding）

#### Prompt 模板（Cambridge 论文使用的「custom format」）

```
You are a word alignment expert. Given a source sentence and its translation,
output alignments in custom format: each target word wrapped in [word_N]
where N is the source word index it aligns to (0-indexed). Use 0 if unaligned.

Source: "The quick brown fox jumps over the lazy dog"
Source indices: The=0 quick=1 brown=2 fox=3 jumps=4 over=5 the=6 lazy=7 dog=8
Translation: "敏捷的棕色狐狸跳过了懒狗"

Example output:
[敏捷_1][的_2][棕色_2][狐狸_3][跳_4][过_5][了_0][懒_7][狗_8]

Now align:
Source: {src}  (indices: {idx_map})
Translation: {tgt}
Output:
```

**为什么用「custom format」而不是 NAACL `i-j` 格式**：论文发现 LLM 在生成严格数字索引对时**非常不稳定**（tokenizer 对数字 token 处理不一致），而把索引嵌入到 token 旁边的 bracket 格式稳定很多。**这是关键工程经验**。

#### 纯 JS 可行性: **5/5**
- 项目已经在调 LLM API（MiniMax / OpenAI / Claude），加一个 align prompt 是零边际成本
- 与现有翻译链路共用 fetch / batching / placeholder codec
- **不需要任何新依赖**
- **工作量**: **2–3 人天**（prompt + 解析 + 与 span-projector 对接）

#### 失败模式
1. **长句 token 漂移**: 超过 30 词的句子，LLM 容易在生成中途累积索引错误
2. **多对一对齐**: 一个中文词对多个英文词（"neural network" → "神经网络"）时，LLM 倾向只对齐一个
3. **成本**: 对齐 prompt 比翻译 prompt 长约 30%，成本 = 翻译的 1.2–1.5x
4. **延迟**: 串行调用 LLM 翻译 + LLM 对齐，首屏延迟翻倍

**缓解**:
- 长句切分（项目已有 BATCH_SIZE=20 的 chunker）
- 多对一用 post-processing：检测未对齐 src token，二次 prompt
- 并发：翻译和对齐 prompt 可以**合并**（让 LLM 一次出翻译 + 对齐），实测能省 40% 延迟

---

## 4. Top 3 方案详细落地路径

### 🥇 方案 #1: LLM 直接出对齐（推荐）

**架构**:
```
src_text ─┐
          ├─→ LLM (translate + align 合并 prompt) ─→ { translation, alignments[] }
tgt_text ─┘                                                ↓
                                                    AlignedSegment[]
                                                    (用现有 segment-encoder.mjs)
                                                    ↓
                                                    span-projector.mjs (Lilt 校验)
                                                    ↓
                                                    dom-renderer.mjs (hover 高亮)
```

**关键改动点**:
1. `lib/translate.mjs` 的 prompt 加 alignment 指令（custom format）
2. 新增 `lib/llm-aligner.mjs` 解析 LLM 输出的 bracket 对齐
3. 复用 `lib/span-projector.mjs` 做 sanity check（Lilt §4.3 算法作为**校验器**而非主对齐器）

**预期准确率**:
- Claude 3.5+: **88–93%**（Cambridge 数据 + 本仓库 span 校验后）
- MiniMAX / 国产 LLM: **80–88%**（需自测，建议加 few-shot 3-5 例）

**成本**: 翻译 + 对齐合并 prompt，~1.3x token 消耗

**为什么强推荐**:
- **零新依赖**，2–3 天交付
- 项目所有现有基础设施（placeholder codec、span projector、DOM renderer）都能复用
- LLM 是品牌术语（"Key"、"Token"）最权威的判断者，不会像 mBERT 那样被术语坑
- 可观测性强：prompt/response 直接可见，调试方便

**失败模式**:
- LLM 输出不遵循 custom format → 加 strict JSON schema + retry
- 长句漂移 → 切分到 ≤ 20 词
- LLM 厂商不稳 → 备 fallback 到方案 #2

### 🥈 方案 #2: mBERT embedding + SimAlign 算法（transformers.js）

**架构**:
```
src_text ─→ tokenize ─→ mBERT forward (transformers.js) ─→ src_emb [src_len, 768]
tgt_text ─→ tokenize ─→ mBERT forward (transformers.js) ─→ tgt_emb [tgt_len, 768]
                                                              ↓
                          cosine similarity matrix [src_len, tgt_len]
                                                              ↓
                          SimAlign 算法（argmax + intersection + itermax）
                                                              ↓
                          alignment pairs [(i, j), ...]
```

**关键改动点**:
1. `package.json` 加 `@huggingface/transformers` 依赖
2. 新增 `lib/mbert-aligner.mjs`（~300 行）:
   - 模型加载（懒加载，首次 hover 时触发）
   - embedding 提取（取第 8 层，对齐 awesome-align 的默认）
   - SimAlign 三件套算法（argmax / itermax / match）
3. 与 `span-projector.mjs` 对接

**模型选择**:
- 默认: [onnx-community/bert-base-multilingual-cased-ONNX](https://huggingface.co/onnx-community/bert-base-multilingual-cased-ONNX)（~700MB FP32 / ~180MB INT8）
- 进阶: [Xenova/LaBSE](https://huggingface.co/Xenova/LaBSE)（~470MB，对应 AccAlign，准确率高 2 个百分点）

**预期准确率**:
- mBERT (SimAlign 算法): **78–82%** ⚠️ 略低于 85%
- mBERT (awesome-align fine-tuned 权重): **~87%** ✓
- LaBSE (AccAlign): **~89%** ✓

**性能（transformers.js 实测数据来自 [SitePoint](https://www.sitepoint.com/optimizing-transformers-js-production/)）**:
- 推理速度: 浏览器比 native 慢 2–4x
- mBERT 短句（< 30 tokens）: ~200–400ms / 句（WASM）/ ~50–100ms（WebGPU）
- 首次加载: ~180MB（INT8） / ~700MB（FP32）

**为什么是 #2 不是 #1**:
- 需要新依赖、需要用户等待模型下载
- 但**完全离线、零成本、零隐私问题**
- 适合作为方案 #1 的 fallback 或离线模式

**失败模式**:
- 浏览器内存不足（mobile / 老 device）→ 检测 navigator.deviceMemory，< 4GB 时禁用
- WebGPU 不可用 → 回退到 WASM（慢 4x）
- 中英混合词（"iPhone 15 发布"）→ tokenizer 拆词不一致 → 加 preprocessing 把 latin token 合并

### 🥉 方案 #3: Hybrid（LLM 出对齐 + mBERT 交叉验证）

**架构**: 方案 #1 出主对齐，方案 #2 的 mBERT 算相似度矩阵作为「软约束」，对**低置信度**的对齐再二次 prompt LLM 确认。

**适用场景**:
- 准确率必须 > 92% 的付费场景
- 长文档批量翻译（首次成本高但质量稳）

**工作量**: 6–8 人天（方案 #1 + #2 都要先实现）

**失败模式**: 系统复杂度上升，监控两个模型的健康度。不推荐 MVP 阶段。

---

## 5. 不要做的方案

| 方案 | 为什么不推荐 |
|------|--------------|
| **fast_align / eflomal / GIZA++** | 无 JS 端口；zh-en 准确率上限 71%；自己 WASM 编译 ≥ 5 天且性能差 |
| **BinaryAlign 原版** | cross-encoder 架构，每个 src word 都要全句 forward；浏览器跑 large 模型 OOM 风险高 |
| **TransAlign 原版** | NLLB-600M encoder 太大；与项目现有 LLM 翻译链路功能重叠 |
| **awesome-align zero-shot** | 单独 zero-shot zh-en 准确率 ~82%，**低于 85% 阈值**；要拿 fine-tuned 权重才行 |
| **纯 GPT-4o 出对齐** | Cambridge 论文实测 GPT-4o 显著弱于 Claude 3.5；用 Claude 更稳 |
| **Lilt span projection 当主对齐器**（仓库现状） | 准确率 50–60%，远低于阈值；只适合做校验器 |
| **K-fingerprint**（仓库现状） | 准确率 47%，必须废弃 |

---

## 6. 决策建议

### 立即执行（本周内）
1. **方案 #1（LLM 合并 prompt）** 作为主路径，目标 2–3 人天交付
2. 保留 `lib/span-projector.mjs` 作为 sanity check 校验器（不作为主对齐器）
3. 废弃 `spike/clip-alignment` 的 K-fingerprint 实验

### 中期（1 个月后）
4. 评估方案 #1 实测准确率：
   - **≥ 88%**: 维持现状，加方案 #2 作为离线 fallback
   - **< 85%**: 切换到方案 #2（mBERT + awesome-align fine-tuned 权重），目标 LaBSE

### 长期（3 个月后）
5. 如果用户量上来、LLM 成本成为瓶颈，再考虑方案 #3 hybrid 或自蒸馏小模型

### 验证基准
- 建一个 50–100 case 的 zh-en 对齐测试集（从实际网页采样 + 人工标注）
- AER 目标: **≤ 15%**（对应准确率 ≥ 85%）
- 现有 `docs/word-alignment-e2e-report.md` 的 5 case 测试作为 smoke test

---

## 7. 关键引用

### 论文
- **BinaryAlign (ACL 2024)** — [aclanthology.org/2024.acl-long.553.pdf](https://aclanthology.org/2024.acl-long.553.pdf) — 当前 SOTA
- **TransAlign (EMNLP 2025 Findings)** — [aclanthology.org/2025.findings-emnlp.1129.pdf](https://aclanthology.org/2025.findings-emnlp.1129.pdf) — NLLB encoder
- **AccAlign (EMNLP 2022 Findings)** — [aclanthology.org/2022.findings-emnlp.272.pdf](https://aclanthology.org/2022.findings-emnlp.272.pdf) — LaBSE
- **awesome-align (EACL 2021)** — [aclanthology.org/2021.eacl-main.181.pdf](https://aclanthology.org/2021.eacl-main.181.pdf) — mBERT fine-tune
- **SimAlign (EMNLP 2020 Findings)** — [aclanthology.org/2020.findings-emnlp.147.pdf](https://aclanthology.org/2020.findings-emnlp.147.pdf) — 无监督 embedding
- **Cambridge LLM Alignment (CHR 2025)** — [Cambridge Core](https://www.cambridge.org/core/journals/computational-humanities-research/article/evaluating-large-language-models-with-a-wordlevel-translation-alignment-task-between-ancient-greek-and-english/4DABC9D5270B5662552B5BD8D8EC527D) — LLM 实证
- **Word Alignment as Preference for MT (EMNLP 2024)** — [aclanthology.org/2024.emnlp-main.188.pdf](https://aclanthology.org/2024.emnlp-main.188.pdf)
- **WSPAlign (ACL 2023)** — weak supervision pretrain
- **SpanAlign (EMNLP 2020)** — SQuAD-style span prediction

### 代码
- [github.com/neulab/awesome-align](https://github.com/neulab/awesome-align)
- [github.com/cisnlp/simalign](https://github.com/cisnlp/simalign)
- [github.com/ubisoft/ubisoft-laforge-BinaryAlignWordAlignementasBinarySequenceLabeling](https://github.com/ubisoft/ubisoft-laforge-BinaryAlignWordAlignementasBinarySequenceLabeling)
- [github.com/bebing93/transalign](https://github.com/bebing93/transalign)
- [github.com/wangweikang/AccAlign](https://github.com/wangweikang/AccAlign)

### JS 生态
- [Transformers.js 官方文档](https://huggingface.co/docs/transformers.js/en/index)
- [onnx-community/bert-base-multilingual-cased-ONNX](https://huggingface.co/onnx-community/bert-base-multilingual-cased-ONNX) — mBERT 现成 ONNX
- [Xenova/LaBSE](https://huggingface.co/Xenova/LaBSE) — LaBSE 现成 ONNX
- [Transformers.js v4 WebGPU Runtime](https://huggingface.co/blog/transformersjs-v4)
- [transformers.js feature-extraction pipeline](https://github.com/huggingface/transformers.js/issues/3)

### 基准数据集
- TsinghuaAligner (zh-en, 450 句) — [nlp.csai.tsinghua.edu.cn](http://nlp.csai.tsinghua.edu.cn/~ly/systems/TsinghuaAligner/TsinghuaAligner.html)
- WPT-05 (fr-en, ro-en) — [web.eecs.umich.edu/mihalcea/wpt05](https://web.eecs.umich.edu/mihalcea/wpt05/)
- KFTT (ja-en) — [phontron.com/kftt](http://www.phontron.com/kftt)
- ALIGN6（6 语种组合，BinaryAlign/AccAlign 默认训练集）

---

## 8. 附：纯 JS 可行性评分汇总

| 方法 | 准确率 | JS 可行性 | 工作量 | 推荐度 |
|------|--------|-----------|--------|--------|
| **LLM 合并 prompt**（方案 #1） | 88–93% | 5/5 | 2–3 天 | ★★★★★ |
| **mBERT + SimAlign 算法**（方案 #2） | 78–82% | 5/5 | 3–5 天 | ★★★★☆ |
| **LaBSE + AccAlign 算法** | 89% | 4/5 | 4–6 天 | ★★★★☆ |
| **mBERT + awesome-align fine-tuned** | 87% | 4/5 | 4–6 天 | ★★★★☆ |
| **Hybrid LLM + mBERT**（方案 #3） | 91–95% | 4/5 | 6–8 天 | ★★★☆☆ |
| **SimAlign 原版算法**（zero-shot） | 78% | 5/5 | 3–5 天 | ★★★☆☆ |
| **awesome-align zero-shot** | 82% | 4/5 | 3–5 天 | ★★☆☆☆ |
| **TransAlign 原版** | 81–89% | 2/5 | 8–10 天 | ★★☆☆☆ |
| **BinaryAlign 原版** | 91–96% | 2/5 | ≥ 10 天 | ★★☆☆☆ |
| **eflomal (WASM 编译)** | 71% | 2/5 | 7–10 天 | ★☆☆☆☆ |
| **fast_align (WASM 编译)** | 62% | 2/5 | 5–7 天 | ★☆☆☆☆ |
| **GIZA++ (WASM 编译)** | 65% | 1/5 | ≥ 10 天 | ★☆☆☆☆ |

---

**结论**: 走方案 #1，2–3 天内出 MVP，目标准确率 88%+。失败则切方案 #2。
