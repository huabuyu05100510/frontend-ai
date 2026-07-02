# 简历策略 V2（最终版）

> **模型**：Claude (Sonnet 4.5)
> **状态**：替代 V1 系列（`career-analysis-work-review.md` / `career-path-options.md` 中的部分判断已过期）
> **核心结论**：双项目并行，技术栈共享，主战场是「浏览器内 ML 部署」

---

## 0. V1 → V2 的关键修正

| 议题 | V1 判断（已过期） | V2 修正 |
|---|---|---|
| 现有「网页翻译」项目 | ❌ 方向选错（讯飞做过更大的） | ✅ 讯飞翻译平台是 8 子功能综合体，网页翻译只是其一；现在做独立网页翻译是**深耕细分**，不是降级 |
| 图搜 vs 翻译哪个好 | ❌ 图搜优于翻译 | ✅ **深度等价**：两者在滴滴/讯飞都是「调 API」层级；都能通过「浏览器内 ML」升级为深度项目 |
| 深度的来源 | 含糊（暗示要训模型） | ✅ **明确**：10 年**前端**专家的深度 = **在浏览器里跑模型**（WebGPU / wasm / 量化 / 内存 / 流式 / 可视化），不是训模型 |
| 词级对齐的实现 | 含糊（依赖 WebGPU NMT） | ✅ **解耦**：MVP 走路径 B（后端 PyTorch，不量化，不依赖 WebGPU）；WebGPU 是未来演进 |
| 工期与路线 | 单选 A/B/C | ✅ **双项目并行**：翻译先打通栈（5-7 周），图搜复用 70% 技术栈（再 4-5 周） |

---

## 1. 核心洞察

### 1.1 过去 8 年的 AI 项目本质
| 项目 | 实际做的 | 层级 |
|---|---|---|
| 讯飞翻译平台（8 子功能） | 调讯飞 MT API | API 集成 |
| 滴滴 AI 图搜地点 | 调豆包 vision API | API 集成 |
| 当前网页翻译（业余） | 调 MiniMax API | API 集成 |

**8 年的"AI 项目"都是「调 API + 前端工程」**。中级前端够用，10 年专家**不够**。

### 1.2 真正的缺口
- ❌ **不是**「不会训模型」— 那是 ML 工程师的赛道
- ✅ **是**「没在浏览器里跑过模型」— 这才是前端专家的深度所在

### 1.3 深度的定义
```
训模型（PyTorch / 数据 / 算力）   ← ML 工程师
     ↓
部署到浏览器                     ← ★ 10 年前端专家的深度 ★
     ↓
WebGPU / wasm / 量化 / 内存 / 流式推理 / 可视化交互
```

**CLIP 是 OpenAI 训的，opus-mt 是 Helsinki 训的 — 但你能在浏览器里跑起来 + 做交互可视化，这就是你的深度。**

---

## 2. 双项目策略

### 项目 1：翻译 + 词级对齐（打通技术栈，5-7 周）

**定位**：深耕讯飞的细分领域（网页翻译），用「浏览器内 ML」做深度升级。

**两层架构**：
```
MVP（路径 B，1-2 周）：
  后端 PyTorch 跑 opus-mt → 导出 attention → 前端可视化 hover 高亮
  ✅ 不量化，不依赖 WebGPU
  ✅ 验证 attention 投影到前端的可行性

演进（路径 A，3-5 周，验证通过后）：
  transformers.js + WebGPU + 量化模型（80-300MB）
  ✅ 浏览器内推理，离线/隐私
  ✅ Service Worker 缓存
```

**为什么是深度**：
- 词级对齐**结构上**DeepL/Google/沉浸式翻译做不到（云架构不暴露 attention）
- 浏览器内 NMT 是 2024-2026 前端前沿
- 简历杀伤力：5/5

**详见**：`docs/local-translation-tech-plan-V1.md`（注：该方案待按 V2 修正，把模块 A/B 解耦，MVP 走路径 B）

### 项目 2：图搜 + 区域 attention（复用栈，4-5 周）

**定位**：浏览器内跨模态检索，**不调豆包 API**。

**技术栈**：
- 模型：[Chinese-CLIP](https://github.com/OFA-Sys/Chinese-CLIP) 量化版（OpenAI 开源，**非豆包**）
- 推理：transformers.js + WebGPU（**复用项目 1 的 `lib/webgpu-engine.mjs`**）
- 索引：hnswlib-wasm + 分片加载
- 可视化：图像区域 attention 高亮（**复用项目 1 的 `lib/attention-visualizer.mjs`**）

**为什么是深度**：
- Google Lens / 百度识图 / 小红书搜索**全是云架构**
- 全本地化版本**结构上做不到的事**你做到了 = 真护城河
- 隐私卖点强（企业付费意愿）

**简历杀伤力**：5/5

### 双项目技术栈共享（关键优势）

```
共享层（项目 1 打通，项目 2 复用）：
  ├─ lib/webgpu-engine.mjs          # 通用推理引擎
  ├─ lib/attention-visualizer.mjs   # 通用 attention 可视化
  ├─ lib/model-cache.mjs            # Service Worker 缓存
  └─ lib/streaming-inference.mjs    # 流式推理框架

项目 1 独有：
  └─ lib/word-aligner.mjs           # 词级对齐算法

项目 2 独有：
  ├─ lib/vector-index.mjs           # HNSW 索引
  └─ lib/map-heatmap.mjs            # 地图热力图
```

**70% 技术栈重合** → 项目 2 工期从 6-8 周压到 4-5 周。

---

## 3. 路线图

```
W1-W2   翻译项目：词级对齐 MVP（路径 B，后端 PyTorch）
        ├─ 后端跑 opus-mt，导出 attention
        ├─ aligner 纯函数 + 单测
        └─ 前端 hover 高亮 demo
        ── 里程碑：验证 attention 投影可行 ──

W3-W4   翻译项目：WebGPU 演进（路径 A）
        ├─ transformers.js + 量化模型
        ├─ WebGPU 推理
        └─ Service Worker 缓存
        ── 里程碑：浏览器内 NMT 可用 ──

W5-W7   翻译项目：UI 整合 + 评估
        ├─ 模式切换器（云/本地/学习）
        ├─ WPT-21 评估集
        ├─ benchmark vs DeepL（对齐质量维度）
        └─ 文档 + 开源
        ── 里程碑：项目 1 完成，可放 GitHub ──

W8-W9   图搜项目：基础链路
        ├─ Chinese-CLIP 浏览器加载（复用 webgpu-engine）
        ├─ hnswlib-wasm 索引
        └─ 文字/图片 → top-K 地点
        ── 里程碑：基础图搜可用 ──

W10-W11 图搜项目：深度可视化
        ├─ 图像区域 attention 高亮（复用 attention-visualizer）
        ├─ 地图相似度热力图
        └─ 交互式 drill-down
        ── 里程碑：项目 2 完成 ──

W12     收尾：双项目联动 demo + 简历
```

**总工期**：12 周（3 个月）。如果只做项目 1：5-7 周。

---

## 4. 简历叙事（最终版）

### 项目 1
> **基于 WebGPU 的浏览器内 NMT 翻译 + 词级对齐可视化**
>
> 针对云翻译无法解决的两类场景（隐私 / 学习），在浏览器扩展内集成量化 NMT 模型（Helsinki opus-mt / NLLB-200，int8 量化 ~80-300MB），通过 Service Worker 缓存实现离线可用、二次加载 < 200ms。利用 transformer cross-attention 矩阵投影实现**词级 src↔tgt 对齐**，支持 hover 中文词高亮英文原文，准确率 X%（WPT-21 评估集）。该功能因云架构限制，DeepL / Google / 沉浸式翻译**结构上不可实现**。

### 项目 2
> **基于 WebGPU 的浏览器内跨模态图搜系统**
>
> 图片 embedding（ONNX 量化 Chinese-CLIP）+ 向量检索（hnswlib-wasm）+ 索引分片加载，**全本地推理，图片永不上传**，主打隐私 / 离线 / 企业内网场景。集成图像区域 attention 高亮、地图相似度热力图、交互式 drill-down，提供 Google Lens 等云架构产品**结构上做不到**的隐私 + 交互体验。

### 共享技术栈叙事
> 两个项目共享自研的 WebGPU 推理引擎（`lib/webgpu-engine.mjs`）+ attention 可视化框架（`lib/attention-visualizer.mjs`），证明**前端 ML 部署基础设施的抽象与复用能力**。

---

## 5. 风险与降级

### 5.1 翻译项目风险
| 风险 | 缓解 |
|---|---|
| attention 矩阵提取失败 | 路径 B 先验证（1-2 周），失败则中止 |
| WebGPU 兼容性差 | 自动降级 wasm |
| 量化模型质量差 | 只做 EN→ZH，进阶接 rerank |

### 5.2 图搜项目风险
| 风险 | 缓解 |
|---|---|
| 量化 CLIP 准确率掉 | 用 Chinese-CLIP 而非原版 |
| 10 万+ 索引浏览器装不下 | 分片加载 + geo 预过滤 |
| **滴滴 IP 风险** | **必须用公开数据 + 不同实现，不可复用滴滴代码/数据/模型** |

### 5.3 整体降级路径
- 翻译 MVP 失败 → 翻译退为「工程纪律 portfolio」（不调 ML），全力做图搜
- 图搜 MVP 失败 → 图搜退为「后端推理 + 前端可视化」混合架构
- 两个都失败 → 双项目归档为「浏览器内 ML 可行性调研」（仍可写简历）

---

## 6. 待办

### 待用户决策
- [ ] 是否同意 V2 策略（双项目并行 + 技术栈共享）
- [ ] 滴滴在职做相关开源的 IP/竞业合规边界（用户自行确认）
- [ ] 是否启动项目 1 的 PoC（1-2 天验证 attention 提取）

### 待产出文档
- [ ] `docs/local-translation-tech-plan-V1.md` 按 V2 修正（模块 A/B 解耦，MVP 走路径 B）
- [ ] `docs/image-search-tech-plan-V1.md`（图搜技术方案）
- [ ] `docs/shared-tech-stack.md`（共享技术栈设计）

### 过期文档归档
- `docs/career-analysis-work-review.md` — V1 判断，被本文档替代
- `docs/career-path-options.md` — A/B/C 单选框架，被本文档双项目并行替代

---

## 7. 一句话总结

**8 年 API 集成经验已饱和证明，真正缺口是「浏览器内 ML 部署」。翻译 + 图搜两个项目共享 70% 技术栈（WebGPU + attention 可视化），先做翻译打通栈，再做图搜作为第二代表作。3 个月双项目落地，构成 10 年专家的技术深度证据。**
