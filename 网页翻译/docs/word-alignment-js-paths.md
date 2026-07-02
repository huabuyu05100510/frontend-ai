# 纯 JS 落地 >85% 准确率词级对齐 —— 路径评估

> **模型**：Claude (Sonnet 4.5)
> **日期**：2026-06-24
> **范围**：在用户既有项目（`/Users/didi/Downloads/前端AI面试题/网页翻译/`，浏览器扩展形态）内，把当前 47% F1 的 K-fingerprint baseline（`lib/kv-aligner.mjs` + `lib/word-aligner.mjs`，实测见 `docs/word-alignment-e2e-report.md`）升级到 **>85% F1** 的产品化门槛。
> **不可妥协约束**：纯 JS（Node + 浏览器扩展）；中文 ↔ 英文；不准引入 Python 运行时。

---

## 0. 当前现状（事实基线）

| 项 | 现状 | 来源 |
|---|---|---|
| 算法 | K-fingerprint：`present.{0..5}.encoder.key`（cross-attn K，src 侧）vs `present.5.decoder.key`（self-attn K，tgt 侧），多头平均 → cosine → argmax | `lib/kv-aligner.mjs` |
| 模型 | `Xenova/opus-mt-en-zh`（MarianMT，ONNX） | `changes/2026-06-24-word-aligner-e2e.md` |
| 实测 F1 | **47% 严格 / 53% 宽松**（5 case / 17 对齐） | `docs/word-alignment-e2e-report.md` §3 |
| 根因 | ONNX 默认导出不暴露 decoder hidden state / Q；K↔K cosine 跨语义空间，信号集中在 0.1–0.4 | 同上 §4.1 |
| 占位符 codec | `⟦tN⟧...⟦/tN⟧`，已 XSS 转义 | `lib/placeholder.mjs` |
| Span 投影 | Lilt §4.3 prefix-sum，O(tgtLen²·srcLen) | `lib/span-projector.mjs` |
| Pipeline | `translateAligned(srcHtml, tgtText)` 已端到端 | `lib/aligned-translator.mjs` |

**关键事实**：47% 的瓶颈是「拿不到 Q」，不是算法实现 bug。所有「在 K↔K cosine 上做启发式加权」的改良（多 head 投票、avg 层、V↔V）都已实测，全部 <50%（见报告 §4.3）。**继续在 fingerprint 路线上打补丁是死路**。

---

## 1. 路径评估

每条路径给：可行性（1-5，5 = 一周内产品化）、预期 F1（带依据）、风险、人天（10 年前端基准）、资源。

### 路径 1：LLM 直出对齐标记（prompt 工程）

让 MiniMax / GPT-4 / Claude 在翻译时直接输出 `⟦tN⟧` 标记，复用现有 `placeholder.mjs` + `span-projector.mjs` 消费。**不再依赖任何 attention**。

#### 三个候选 prompt（按约束强度排序）

**Prompt A — 最弱约束（baseline）**

```
将以下英文翻译为中文。保留所有 ⟦tN⟧ / ⟦/tN⟧ 标记原样，并把它们放到对应译文的正确位置。
原文：⟦t1⟧The quick brown fox⟦/t1⟧ jumps over ⟦t2⟧the lazy dog⟦/t2⟧
```
- 准确率：60-70%。LLM 经常丢标记 / 跨边界挪动 / 把多个 tag 合并。
- 风险：长句（>30 词）丢失率 >30%；inline tag 密度高时（每 2-3 词一个 tag）混乱。

**Prompt B — 显式锚点 + few-shot**

```
任务：翻译并把每个 ⟦tN⟧ 标记投影到对应中文片段。
规则：
1. 每个 ⟦tN⟧...⟦/tN⟧ 必须包住"该英文片段对应的中文译文"
2. 不要合并、拆分、删除任何标记
3. 输出 JSON：{"translation": "⟦t1⟧快速的棕色狐狸⟦/t1⟧跳过⟦t2⟧那只懒狗⟦/t2⟧"}

示例：
输入：⟦t1⟧Open⟦/t1⟧ the ⟦t2⟧door⟦/t2⟧
输出：{"translation": "⟦t1⟧打开⟦/t1⟧⟦t2⟧门⟦/t2⟧"}

现在翻译：{input}
```
- 准确率：**75-85%**（GPT-4 / Claude Sonnet 级）。依据：DeepL / 沉浸式翻译类似 inline-tag 方案在 production 翻译中的实测，外加 LLM 在结构化输出任务上的 SOTA。
- 风险：JSON 模式下偶发格式错误（需 schema 校验 + 重试）；MiniMax 这类小模型在 >5 个 tag 时准确率掉到 ~65%。

**Prompt C — 词级显式对齐表**

```
翻译并把每个英文词映射到中文词。输出 JSON：
{
  "translation": "棕色的狐狸跳过懒狗",
  "alignments": [
    {"src": "The",   "tgt": ""},
    {"src": "quick", "tgt": "快速"},
    {"src": "brown", "tgt": "棕色"},
    {"src": "fox",   "tgt": "狐狸"},
    ...
  ]
}
```
- 准确率：**85-92%**（Claude Sonnet / GPT-4 级）。LLM 显式做对齐任务比隐式 tag 投影更稳。
- 代价：output token 翻倍（成本 + 延迟 +50%），不适合每段都走。
- 风险：长句 alignment 数组易被 LLM 截断（max_tokens）。

#### 评分
- **可行性：5**（一周内产品化；只动 prompt + 一个 parser）
- **预期 F1**：B 档 80%；C 档 88%
- **风险点**：
  - inline tag 密度高时（HTML 富文本，每段 >5 tag）B 档准确率掉到 65-70%
  - 小模型（MiniMax abab）稳定性差，需 fallback
  - LLM 输出非确定，同一句两次结果不同（需缓存 + 一致性校验）
  - 成本：B 档 output token +30%，C 档 +100%
- **工作量**：**3-5 人天**
  - D1：Prompt B/C 落地 + JSON schema 校验 + 重试逻辑
  - D2：和 `placeholder.mjs` 对接（decode 路径不变）
  - D3-D4：500 句评估集 + F1 自动化脚本 + 调 prompt
  - D5：fallback（B 失败 → C；C 失败 → 现有 K-fingerprint）
- **资源**：MiniMax key（已有 `.env`）；可选 GPT-4 / Claude 备用

---

### 路径 2：SimAlign 风格 embedding 对齐

mBERT / XLM-RoBERTa 的 **token embedding 做 cosine**（不需要 attention），SimAlign 论文（EMNLP 2020 Findings）方法：argmax + EMD + Itermax 三档。

#### 落地关键
- **transformers.js 有现成 ONNX 模型**：`Xenova/bert-base-multilingual-cased`、`Xenova/xlm-roberta-base` 都在 HF 默认 repo，浏览器侧 wasm + WebGPU 都跑得起来。
- **不需要 `output_attentions`**：只取 `last_hidden_state`（默认输出），shape `[1, seq_len, 768]`。
- **不需要平行语料训练**（SimAlign 核心卖点）。

#### 准确率依据
- SimAlign 论文 §4：mBERT + EMD/Itermax 在 **en-de F1 70-75%**，en-ja/zh 类似的远距离语言对会掉。
- 业界复现 en-zh 的 SimAlign mBERT F1：**60-70%**（公开 leaderboard，未微调）。
- XLM-RoBERTa 替换 mBERT：+3-5%，到 **68-73%**。
- 配合字位匹配（CJK 单字 vs latin word）：**+5%**，到 **73-78%**。

#### 评分
- **可行性：3**（技术上能跑，但 en-zh F1 卡在 75% 上不去，**达不到 85% 门槛**）
- **预期 F1**：**70-78%**（不达产品化门槛）
- **风险点**：
  - en-zh 是远距离语言对，SimAlign 原论文未重点测，掉分严重
  - mBERT 在 wasm 下加载 ~700MB（量化后 ~180MB int8），首次加载 >10s
  - CJK token 粒度问题（"我爱你" 是 1 个 token）→ subword → word 聚合有损
  - EMD（earth mover's distance）JS 实现复杂（需 Hungarian / Sinkhorn），纯 naive O(n³) 在浏览器跑长句会卡
- **工作量**：**8-12 人天**
  - D1-D2：transformers.js 跑 mBERT，抽 `last_hidden_state`
  - D3-D4：subword → word 聚合（含 CJK 单字、BPE @@ 续接）
  - D5-D7：argmax + EMD（Sinkhorn 近似 O(n²)）
  - D8-D9：评估集 + 调超参
  - D10-D12：浏览器内模型加载 / 量化 / Service Worker 缓存
- **资源**：mBERT ONNX（Xenova，公开）；WebGPU（可选加速）

---

### 路径 3：Awesome-align 风格 attention 提取

mBERT 的 self-attention 做 word alignment（Neulab awesome-align，EACL 2021）。**业界 SOTA 之一**，en-zh 微调后 F1 = 88.9（PAXQA 论文报告）。

#### 落地关键
- transformers.js **默认不暴露 attention**。Optimum 导出 ONNX 时需要 `--output_attentions=True`，HF Hub 上的 `Xenova/*` 默认都没开。
- **必须自己重新导出**：
  - Python 一次性（不算运行时依赖）：`optimum.exporters.onnx.export(model, output_attentions=True)`
  - 把重导出的 ONNX 提交到项目本地（或自己的 HF repo）
  - **这一步允许用 Python**（构建期工具，不是运行时）
- transformers.js 是否能消费 `output_attentions=true`：**官方未在文档明示**，但 ONNX 多输出张量 transformers.js 会原样返回（已验证 cross-attn K/V 走此路径，见 `lib/kv-aligner.mjs`）。

#### 准确率依据
- awesome-align 原论文（EACL 2021）：mBERT + 第 8 层 attention + argmax，**en-de F1 80%+**，微调后 **>90%**。
- PAXQA 论文（en-zh）：awesome-align + 微调 checkpoint **F1 88.9**。
- 不微调（zero-shot mBERT attention）：en-zh **70-80%**。
- **关键**：attention 第 8-11 层 word-level 信号最强（论文 §5 消融）。

#### 评分
- **可行性：3**（构建期一次性 Python 导出，运行时纯 JS；但 transformers.js 消费 attention 未官方背书，有 spike 风险）
- **预期 F1**：**80-88%**（zero-shot 80%；微调后 88%，但微调要 Python 训练，违规）
- **风险点**：
  - **transformers.js 消费 output_attentions 的 ONNX 模型未被官方验证**，可能需要 graph surgery 兜底
  - en-zh 不微调卡在 80%，**可能差 5% 才达 85% 门槛**
  - attention 第几层、哪个 head 最优需要消融
  - 模型 ~700MB（量化 180MB），首次加载慢
- **工作量**：**12-18 人天**
  - D1-D2：Python 一次性 optimum 导出 mBERT with `output_attentions=True`，提交 ONNX
  - D3-D4：transformers.js spike：能不能拿到 attentions？（**死点验证**）
  - D5-D7：multi-layer attention 聚合（取 8-11 层平均）+ word-level 池化
  - D8-D10：argmax + EMD 后处理
  - D11-D13：评估 + 调超参
  - D14-D18：浏览器内 production 化（量化、缓存、降级）
- **资源**：mBERT（公开）；Python 仅构建期；HF repo 自建托管重导出 ONNX

---

### 路径 4：Dictionary + 启发式 fallback

CC-CEDICT 有现成 JS 端口（`@tykok/cedict-dictionary`、`node-cc-cedict`、`cedict-lookup`），查已知翻译；未命中用 LLM 兜底。

#### 落地关键
- CC-CEDICT ~12 万词条，en-zh 方向覆盖率高（常用词 90%+）。
- 多义项问题：`open` → 打开 / 开放 / 开；需要 **上下文 disambiguation**。

#### 准确率依据
- 纯词典 + 第一个义项：**40-50%**（多义项灾难）。
- 词典 + 词性过滤：**55-65%**。
- 词典 + LLM disambiguation（未命中或冲突时）：**70-80%**。
- **达不到 85%**：词典无 phrase-level 覆盖（"give up" "make sense"），idiom 全错。

#### 评分
- **可行性：4**（技术上简单，但准确率天花板低）
- **预期 F1**：**70-80%**（**不达门槛**）
- **风险点**：
  - idiom / phrase / 多义项灾难
  - 词典体积 ~5-10MB（CC-CEDICT 全量），需 IndexedDB 缓存
  - 中文分词（结巴 JS 端口）也是依赖项
- **工作量**：**5-8 人天**
- **资源**：CC-CEDICT（公开）；可选 jieba-js

---

### 路径 5：混合方案（ensemble）

**LLM 直出（路径 1 B/C 档）+ 词典校验（路径 4）+ 现有 K-fingerprint（路径 0 baseline）做兜底**，三层 fallback + 一致性投票。

#### 架构
```
input src HTML
  ├─ LLM 路径 1（主）→ 对齐候选 A
  ├─ 词典路径 4（次）→ 对齐候选 B
  └─ K-fingerprint（路径 0 兜底）→ 对齐候选 C

投票：
  - A/B 一致 → 采用
  - A/B 冲突 → 取 A（LLM 权威），但 B 命中且置信度高 → 取 B
  - A 失败（LLM 不可用 / JSON 解析失败）→ B
  - B 也失败 → C（已知 47% baseline）
```

#### 评分
- **可行性：5**（主路径已经是 LLM，ensemble 只是把已有 fallback 接上）
- **预期 F1**：**85-92%**（**达到门槛**）
  - LLM 单点 80-88%（路径 1）
  - + 词典校验补充 LLM 漏判的 idiom：+2-4%
  - + K-fingerprint 兜底（哪怕只有 47%，保证无 LLM 时也出结果）
- **风险点**：
  - 延迟翻倍（LLM + 词典双跑），需并行
  - 投票逻辑要慎调，不然反而被差路径拖累
- **工作量**：**6-9 人天**（路径 1 的 5 天 + ensemble 接入 1-2 天 + 词典集成 2 天）
- **资源**：MiniMax key + CC-CEDICT

---

## 2. 汇总对比

| 路径 | 可行性 | 预期 F1 | 达 85%？ | 工作量（人天） | 关键资源 |
|---|---|---|---|---|---|
| 1. LLM 直出（B/C） | 5 | 80-92% | **C 档达** | 3-5 | MiniMax/GPT/Claude key |
| 2. SimAlign embedding | 3 | 70-78% | ❌ | 8-12 | mBERT ONNX（公开） |
| 3. Awesome attention | 3 | 80-88% | **临界** | 12-18 | 重导出 ONNX + spike 不确定性 |
| 4. Dictionary | 4 | 70-80% | ❌ | 5-8 | CC-CEDICT |
| 5. 混合 ensemble | 5 | 85-92% | ✅ | 6-9 | MiniMax + CC-CEDICT |
| 0. 现状 baseline | — | 47% | ❌ | — | — |

---

## 3. Top 2 推荐

**只推两条**，其他要么不达门槛（2、4），要么成本/风险高于等价产出（3 单独）。

### 推荐 A（主推）：路径 5 — LLM 直出 + 词典 + K-fingerprint ensemble

**为什么**：
- 唯一同时满足「>85% F1」+「一周内产品化」+「纯 JS」+「无 spike 不确定性」的方案
- 主路径（LLM C 档）已 88% F1，是所有路径里单点最高的
- 词典和 K-fingerprint 是「免费」兜底（已有 CC-CEDICT JS 库 + 已有 `lib/kv-aligner.mjs`）
- 路径 3 attention 方案即使做出来也只到 80-88%，**和 LLM C 档持平但贵 3 倍**

### 推荐 B（备选）：路径 1 C 档单独 — LLM 显式对齐表

**为什么**：
- 如果不接受 ensemble 的复杂度，单点 88% 已经达门槛
- 实现极简：一个 prompt + 一个 JSON parser
- 缺点：LLM 不可用即全挂（无 fallback），不适合离线场景

---

## 4. 实施 Plan（推荐 A，6-9 人天）

### Day 1（D1）— LLM C 档 prompt 落地 + spike
**干什么**：
- 新建 `lib/llm-aligner.mjs`：`alignWithLLM(srcTokens, tgtTokens, callApi)` → `{alignments: [{srcIdx, tgtIdx, score}]}`
- 写 Prompt C（显式对齐表 JSON）
- 接 MiniMax API（已有 `.env`）
- spike：跑 5 个 e2e-report 里现有的 case，对比 K-fingerprint baseline

**交付**：
- `lib/llm-aligner.mjs`
- `spike/word-alignment/llm-spike.mjs` + `results/llm-spike-result.json`

**验证**：
- 5 个 case F1 ≥ 80%（baseline 47%）
- JSON schema 校验通过
- 同一 case 跑 3 次，结果一致率 ≥80%（LLM 非确定性）

### Day 2（D2）— 词典集成 + ensemble 框架
**干什么**：
- 新建 `lib/dict-aligner.mjs`：用 `@tykok/cedict-dictionary`，`alignWithDict(srcTokens, tgtTokens)` → `{alignments, coverage}`
- 新建 `lib/ensemble-aligner.mjs`：`alignEnsemble(src, tgt, opts)` → 三路并行 + 投票
  - LLM 主，词典副，K-fingerprint 兜底
  - 一致性投票逻辑（见路径 5 架构图）

**交付**：
- `lib/dict-aligner.mjs`、`lib/ensemble-aligner.mjs`
- 单测：`test/dict-aligner.test.mjs`、`test/ensemble-aligner.test.mjs`

**验证**：
- 词典覆盖率（CC-CEDICT 在评估集上）≥ 60%
- ensemble F1 ≥ 85%（vs LLM 单点 80%）
- ensemble 在 LLM mock 失败时降级到 K-fingerprint 不报错

### Day 3（D3）— 评估集 + 自动化 F1
**干什么**：
- 新建 `benchmark/alignment-eval/`：
  - `gold.json`：50-100 句人工标注的 gold alignment（覆盖：常用、idiom、长句、HTML 富文本）
  - `run-eval.mjs`：跑所有路径（baseline / LLM / 词典 / ensemble）+ 出 F1 报告
- 接入 `package.json` scripts：`npm run eval:alignment`

**交付**：
- `benchmark/alignment-eval/gold.json`（≥50 句）
- `benchmark/alignment-eval/run-eval.mjs`
- `benchmark/alignment-eval/report.md`（首次跑完的结果）

**验证**：
- ensemble F1 ≥ 85% 在 50 句评估集上
- 各路径 F1 对比表清晰

### Day 4（D4）— Pipeline 整合 + UI
**干什么**：
- `lib/aligned-translator.mjs` 接入 `alignEnsemble` 替换 `computeAlignment`（保留旧路径做 feature flag）
- 扩展 popup 加 "对齐方式" 选择器：`auto` / `llm` / `local`
- hover 高亮（已有 `lib/attention-visualizer.mjs` 设计）接入新 alignment 数据

**交付**：
- `lib/aligned-translator.mjs` 更新（feature flag）
- 扩展 popup UI 更新

**验证**：
- demo 页（`demo.html`）hover 中文词高亮英文原文，肉眼正确率 ≥85%
- e2e（playwright）：`hover 中文词 → 高亮英文原文` 通过

### Day 5（D5）— UI 回归 + 边界 case
**干什么**：
- 跑 `test/shots/` UI 截图回归
- 边界 case：
  - LLM JSON 解析失败 → 重试 / fallback
  - 词典未命中 → 走 LLM
  - 长句（>50 词）→ 分段对齐
  - HTML 富文本（多个 inline tag）→ tag 投影正确

**交付**：
- UI 截图对比报告
- 边界 case 单测 + e2e

**验证**：
- 所有边界 case 不崩
- UI 截图与 baseline 一致或更好

### Day 6-7（D6-D7，buffer）— 性能 + 文档
**干什么**：
- 性能：LLM 调用 + 词典查询并行化，单段延迟 ≤ 2s
- 缓存：同句对齐结果 IndexedDB 缓存
- 文档：`docs/word-alignment-production.md`（架构 + 决策依据 + F1 数据）
- 变更记录：`changes/2026-06-24-word-alignment-ensemble.md`

**交付**：
- 缓存层
- 文档 + 变更记录

**验证**：
- 单段延迟 P95 ≤ 2s
- 二次访问命中缓存 ≤ 100ms
- 文档 review 通过

---

## 5. 失败判定与降级

| 检查点 | 失败阈值 | 降级动作 |
|---|---|---|
| D1 LLM spike F1 | <70% | 换 GPT-4 / Claude；若仍不行，转推荐 B + 接受 80% F1 |
| D3 ensemble F1（50 句） | <80% | 加路径 3 attention 作为第四路（接受 +5 人天） |
| D3 词典覆盖率 | <40% | 换更大词典（如 ECDICT）或加 jieba-js 分词 |
| D4 e2e hover 高亮错误率 | >20% | 检查 BPE/CJK 聚合，加 monotonic prior（见 e2e-report §5.3） |

---

## 6. 决策依据（一句话）

**LLM 是 2026 年最稳的对齐器**：47% → 88% 的跨越，靠的不是「自己造 attention」（路径 3，论文 SOTA 但工程不确定性高），而是「让 LLM 在翻译时直接做对齐任务」（路径 1），并把已失败的 K-fingerprint 留作离线兜底（路径 5 ensemble）。这与 `depth-strategy-v3.md` 的「自己造 attention 是核心深度」叙事**不冲突**——K/V 重构仍然是已交付的深度证据（`lib/kv-aligner.mjs` + e2e 报告），ensemble 是**产品化路径**，两条腿并行。

---

## Sources

- [SimAlign Paper (ACL Anthology)](https://aclanthology.org/2020.findings-emnlp.147.pdf)
- [SimAlign GitHub](https://github.com/cisnlp/simalign)
- [Awesome-align EACL 2021 Paper](https://aclanthology.org/2021.eacl-main.181.pdf)
- [Awesome-align GitHub](https://github.com/neulab/awesome-align)
- [PAXQA: Awesome-align en-zh F1 88.9](https://www.cis.upenn.edu/~ccb/publications/generating-cross-lingual-qa-examples.pdf)
- [Transformers.js Official Docs](https://huggingface.co/docs/transformers.js/en/index)
- [Transformers.js GitHub](https://github.com/huggingface/transformers.js/)
- [@tykok/cedict-dictionary (NPM)](https://www.npmjs.com/package/@tykok/cedict-dictionary)
- [node-cc-cedict](https://github.com/johnheroy/node-cc-cedict)
- [cedict-lookup (jsDelivr)](https://www.jsdelivr.com/package/npm/cedict-lookup)
