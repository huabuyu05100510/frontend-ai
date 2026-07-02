# 本地翻译 + 词级对齐 技术方案 V1

> **模型**：Claude (Sonnet 4.5)
> **作者**：本人（10 年前端）
> **状态**：方案设计阶段，未开始实施
> **依赖**：现有 `lib/placeholder.mjs` / `lib/aligned-translator.mjs` / 扩展工程

---

## 0. 背景与定位

### 0.1 当前项目的短板
现有「占位符 + 云 LLM」方案在 benchmark 中标签保留率 98.3%（超 DeepL 5 个百分点），但：
- LLM 是黑盒，**不暴露 attention 矩阵** → 无法做词级对齐
- 全程依赖云 API → **隐私 / 离线 / 企业内网场景盲区**
- 「标签保留率高 5%」是**小差异**，不构成 10 年专家代表作

### 0.2 本方案要解决的核心问题
| 问题 | 现状 | 本方案 |
|---|---|---|
| 词级对齐 | 不可能（LLM 不暴露 attention） | 本地 NMT 拿 attention，投影到前端 |
| 隐私翻译 | 不可能（必须上传） | WebGPU 本地推理，零上传 |
| 离线翻译 | 不可能 | 模型缓存后离线可用 |
| 行业差异化 | 标签保留率小差异 | DeepL / 沉浸式翻译 **结构上做不到** 的功能 |

### 0.3 与现有方案的关系（不是替代，是补充）
```
网页翻译扩展
  ├─ 主路径：云 LLM（MiniMax / DeepL）       ← 现有，高质量
  ├─ 隐私路径：WebGPU 本地 NMT                ← 新增，离线/企业
  └─ 杀手锏：词级对齐可视化                    ← 新增，本地 NMT 的副产品
```
**用户偏好**：默认云 LLM；隐私模式 / 学习模式 → 本地 NMT + 对齐可视化。

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│ 浏览器扩展（Content Script + Service Worker）                  │
│                                                              │
│   DOM Walker ──→ 翻译调度器 ──┬─→ 云 LLM（默认）              │
│                              │                              │
│                              └─→ 本地 NMT（隐私/学习模式）    │
│                                    │                         │
│                                    ├─→ 翻译结果               │
│                                    └─→ attention 矩阵         │
│                                          │                    │
│                                  Aligner（投影）              │
│                                          │                    │
│                                  DOM Renderer                │
│                              （hover 高亮 src↔tgt）           │
└─────────────────────────────────────────────────────────────┘
```

### 1.1 模块边界
| 模块 | 职责 | 输入 → 输出 |
|---|---|---|
| `local-nmt/engine.mjs` | 模型加载 / 推理 | text → { translation, attention } |
| `local-nmt/aligner.mjs` | attention → token 对齐 | attention[srcLen×tgtLen] → pairs[] |
| `local-nmt/cache.mjs` | 模型 / 译文缓存 | id → blob |
| `ui/alignment-overlay.mjs` | hover 高亮 | pairs + DOM → 视觉反馈 |
| `ui/mode-switcher.mjs` | 模式切换（云/本地/学习） | 用户操作 → 翻译策略切换 |

---

## 2. 模块 A：词级对齐可视化

### 2.1 核心算法（attention 投影）

#### 2.1.1 attention 矩阵从哪来
transformer 解码时，**最后一层 decoder cross-attention** 表示「生成第 i 个 tgt token 时，模型看向哪些 src token」：

```
attention: Float32Array [tgtLen × srcLen]
attention[i][j] = 生成第 i 个 tgt token 时，对第 j 个 src token 的权重
```

#### 2.1.2 多头 / 多层聚合（这是研究坑点，先做 baseline）
- **baseline**：取**最后一层**所有 head 的**算术平均**
- **改进**：最后 N 层加权（按论文 [1] 的发现，中后层比最后一层更稳）
- **进阶**：agra 函数（注意力累积），按论文 [2] 实现

**MVP 先做 baseline**，留接口允许换聚合策略。

#### 2.1.3 token → 字符回映
attention 是 token 级（BPE），但前端要 hover 字符。需要：
```
src tokens  ──┐
              ├─→ tokenizer 映射 ─→ 字符区间映射表
tgt tokens  ──┘
```
transformers.js 的 tokenizer 暴露 `token_to_char()` 接口。

#### 2.1.4 对齐输出
```typescript
interface AlignmentPair {
  srcStart: number  // 原文 char offset
  srcEnd: number
  tgtStart: number  // 译文 char offset
  tgtEnd: number
  score: number     // 0~1，置信度
}
```

### 2.2 前端可视化方案

#### 2.2.1 不破坏现有 DOM 翻译结构
当前翻译完，DOM 是 `<span data-tgt>译文</span>`。对齐数据挂在 `dataset`：
```html
<span data-tgt data-align='[[0,5,0,2,0.9],[6,10,3,5,0.85]]'>敏捷的棕色狐狸</span>
```

#### 2.2.2 hover 交互
- hover tgt 词 → 高亮对应 src 原文（在双语对照模式下）
- hover src 词 → 高亮对应 tgt 译文
- 高亮用 `box-shadow inset` + 背景色，避免 reflow

#### 2.2.3 性能预算
- 单段翻译 attention 计算：< 5ms（句子级，~50 tokens）
- hover 响应：< 16ms（一帧内）
- 大段对齐数据：> 1000 段时虚拟化（只渲染可视区间的对齐）

### 2.3 降级路径
| 情况 | 降级 |
|---|---|
| 浏览器不支持 WebGPU / wasm | 自动回退到云 LLM（无对齐） |
| 模型加载失败 | 回退云 LLM + 提示用户 |
| attention 全 0 / NaN | 该段不显示对齐，不阻塞翻译 |
| 对齐置信度 < 0.3 | 不显示高亮（避免误导） |

---

## 3. 模块 B：WebGPU 本地 NMT

### 3.1 技术栈选型

| 选项 | 优点 | 缺点 | 决定 |
|---|---|---|---|
| **transformers.js v3** | Hugging Face 官方，支持 WebGPU；社区活跃 | 大模型慢 | ✅ 主选 |
| Bergamot（Mozilla） | 生产级，Chrome 内置过 | 编译复杂，attention 暴露弱 | ⚠️ 备选 |
| 自研 wasm 算子 | 完全可控 | 工作量过大（半年+） | ❌ |

### 3.2 模型选型

#### 3.2.1 候选模型
| 模型 | 大小 | 语向 | 质量 | 决定 |
|---|---|---|---|---|
| Opus-MT (Helsinki) | ~80MB / 方向 | 单向 | 中 | ✅ MVP |
| NLLB-200-distilled-600M | ~300MB | 多语 | 良 | ⚠️ 进阶 |
| SmolLM2-translate | ~500MB | 多语 | 优 | ⚠️ 跟进 |

**MVP**：Helsinki-NLP/opus-mt-en-zh（EN→ZH 单向，小，快）
**进阶**：NLLB-200-distilled-600M（多语向，覆盖更多场景）

#### 3.2.2 量化
- 用 ONNX 量化版（int8 / int4）
- 加载时间：80MB 模型 + 良好 CDN ~3-5 秒首屏
- 推理速度：目标 > 20 tokens/s（桌面端 Chrome）

### 3.3 WebGPU 检测与降级

```javascript
async function detectBackend() {
  if (!('gpu' in navigator)) return 'wasm'
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return 'wasm'
  return 'webgpu'
}
```

不支持 WebGPU 的环境自动用 wasm（慢 3-5 倍但仍可用）。

### 3.4 模型缓存

#### 3.4.1 用 Service Worker + Cache Storage
- 模型分片（chunked），按需加载
- ETag / Cache-Control
- 二次访问零网络

#### 3.4.2 配额管理
- `navigator.storage.estimate()` 监控
- 超 500MB 警告 / LRU 淘汰旧模型

### 3.5 性能预算
| 指标 | 目标 | 现实预期 |
|---|---|---|
| 首次加载（含模型） | < 5s | 80MB 模型 + 量化 |
| 二次加载（缓存命中） | < 200ms | SW cache |
| 翻译速度 | > 20 tok/s | 桌面 Chrome + WebGPU |
| 内存峰值 | < 1.5GB | 含模型 + KV cache |
| 移动端 | 不支持 | 文档说明 |

---

## 4. 工程化与可观测

### 4.1 TDD（遵循 CLAUDE.md）
- `test/local-nmt/aligner.test.mjs`：attention → pairs 的纯函数测试（用 fixture attention 矩阵）
- `test/local-nmt/engine.test.mjs`：模型加载 / 推理的集成测试（mock fetch）
- `test/e2e/alignment-overlay.e2e.mjs`：playwright hover 高亮可见性回归
- `test/ui/mode-switcher.shots/`：模式切换 UI 截图

### 4.2 可观测指标
```
local_nmt_load_ms{model, backend}      # 模型加载耗时
local_nmt_infer_ms{model, backend}     # 单次推理耗时
local_nmt_tokens_per_sec               # 吞吐
local_nmt_cache_hit_rate               # 缓存命中率
alignment_confidence_histogram         # 对齐质量分布
alignment_fallback_total{reason}       # 对齐失败原因（NaN/低分/不支持）
mode_switch_total{from, to}            # 用户模式切换行为
```

> 用 extension/storage 存，定期通过现有 telemetry 上报（不接新依赖）。

### 4.3 日志（遵循 CLAUDE.md 「功能开发加日志便于追踪」）
```javascript
const log = createLogger('local-nmt')
log.info('model_load_start', { model: 'opus-mt-en-zh', backend })
log.info('model_load_done', { ms, bytes })
log.warn('attention_nan_fallback', { segmentId })
log.error('infer_failed', { err, segmentId })
```

### 4.4 UI 回归
- `benchmark/results/alignment-shots/`：固定 10 段文本，对齐前后对比
- 每次 PR 跑 playwright 截图 diff，> 2% pixel diff 阻断合并

---

## 5. 实施路线（分阶段，每阶段独立交付）

### Phase 1：词级对齐 MVP（2 周）
**目标**：跑通「本地小模型 → attention → 对齐 → hover 高亮」全链路

- [ ] P1.1 集成 transformers.js + opus-mt-en-zh（wasm 先跑通）
- [ ] P1.2 attention 矩阵提取（最后一层 head 平均）
- [ ] P1.3 token→char 映射
- [ ] P1.4 aligner 纯函数 + 单测（fixture attention）
- [ ] P1.5 双语对照 hover 高亮（最小 UI）
- [ ] P1.6 e2e + UI 截图回归

**交付**：单段 EN→ZH 翻译，hover 中文词能高亮英文。

### Phase 2：WebGPU 加速（1 周）
- [ ] P2.1 backend 检测（WebGPU / wasm 自动）
- [ ] P2.2 模型加载走 WebGPU
- [ ] P2.3 性能 benchmark（vs wasm）
- [ ] P2.4 失败降级路径

**交付**：WebGPU 可用时自动启用，速度提升 ≥ 3x。

### Phase 3：模型缓存 + 离线（1 周）
- [ ] P3.1 Service Worker 拦截模型请求
- [ ] P3.2 Cache Storage 分片存储
- [ ] P3.3 配额管理 + LRU
- [ ] P3.4 离线模式 UI 标识

**交付**：二次访问 < 200ms，断网可用。

### Phase 4：UI 整合（1 周）
- [ ] P4.1 模式切换器（云 / 本地 / 学习）
- [ ] P4.2 隐私模式提示
- [ ] P4.3 大段虚拟化
- [ ] P4.4 完整 UI 回归

**交付**：用户可一键切换模式，三种模式体验一致。

### Phase 5：进阶（可选，3-4 周）
- [ ] NLLB-200 多语向
- [ ] 高级 attention 聚合（agra）
- [ ] 学习模式（标记生词，导入 Anki）
- [ ] 词级对齐质量评估集

**总工期**：MVP 5 周，进阶 +3-4 周。

---

## 6. 风险与诚实评估

### 6.1 高风险项

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 浏览器 attention 暴露不完整 | 中 | 高 | 先用 transformers.js 验证；不行换 Bergamot |
| 量化模型翻译质量太差 | 中 | 中 | MVP 只做 EN→ZH，进阶接 NLLB |
| WebGPU 兼容性差（Safari/Firefox） | 高 | 中 | 自动降级 wasm |
| 首屏加载 80MB 体验崩 | 高 | 高 | 进度条 + 后台预加载 |
| 内存爆炸（长文本） | 中 | 高 | 切块推理 + KV cache 释放 |

### 6.2 不做的（明确边界）
- ❌ 不做模型微调（不是 ML 项目）
- ❌ 不做自研 NMT（用现成模型）
- ❌ 不做移动端（WebGPU + 内存都不够）
- ❌ 不做实时语音翻译（场景外）

### 6.3 失败判定
**任意一条触发即视为 MVP 失败，回退到现有云 LLM 方案：**
- transformers.js 无法暴露 attention 矩阵
- 80MB 模型翻译质量明显差于 MiniMax（人工评估 < 60% 可接受率）
- WebGPU 推理 < 5 tokens/s（桌面 Chrome）

→ **若失败，本项目作为「技术调研 + PoC」归档，仍可写简历**（"调研浏览器内 NMT 可行性，验证 attention 投影路径，确认/否定 X"）。

---

## 7. 简历叙事（最终版）

> **基于 WebGPU 的浏览器内 NMT 翻译 + 词级对齐可视化**
>
> 针对云翻译无法解决的两类场景（隐私 / 学习），在浏览器扩展内集成量化 NMT 模型（Helsinki opus-mt / NLLB-200，int8 量化 ~80-300MB），通过 Service Worker 缓存实现离线可用、二次加载 < 200ms。利用 transformer 最后一层 cross-attention 矩阵投影实现**词级 src↔tgt 对齐**，支持 hover 中文词高亮英文原文，准确率 X%（基于 WPT-21 评估集）。该功能 DeepL / Google Translate / 沉浸式翻译因云架构无法暴露 attention 而**结构上不可实现**。
>
> 工程亮点：backend 自动降级（WebGPU → wasm → 云）、attention NaN 容错、对齐置信度过滤、5 阶段 TDD + e2e + UI 截图回归、9 项可观测指标。

---

## 8. 参考资料

[1] Yin et al., "Does Transformer Learn Smart-Context for Word Translation?", 2021. 中后层 attention 更稳。
[2] Yin et al., "On the Analysis of Attention Matrix for Word Translation", agra 函数。
[3] [Hugging Face transformers.js](https://huggingface.co/docs/transformers.js) — WebGPU 支持。
[4] [Bergamot project](https://browser.mt/) — Mozilla 浏览器内翻译项目。
[5] [WPT-21 评估集](https://github.com/wmt-conference/wmt-news-systems) — 词级对齐标准测试集。

---

## 9. 下一步动作

1. **PoC（1-2 天，先验证可行性）**：
   - 在浏览器跑 transformers.js + opus-mt-en-zh
   - 确认能拿到 attention 矩阵
   - 若成功 → 进入 Phase 1
   - 若失败 → 调研 Bergamot 或中止本方案

2. 把本方案拆成 GitHub issues / changes 记录
3. 在 `docs/` 加一个 `decisions/` 子目录记录关键决策（为什么选 opus-mt、为什么放弃 Bergamot 等）
