# 保结构流式翻译引擎 — 技术方案 V1（方案 A）

> **模型声明**：GLM-5.2，2026-06-22
> **对标**：Lilt Labs《Format Transfer in Machine Translation》+ arXiv:1901.11359 / 2021.findings-emnlp.299
> **差异化**：在 LLM API 时代（无 attention 输出）重新实现 span-scoring tag projection 算法，并补齐 Lilt 没做的可视化与质量回归闭环

---

## 一、问题陈述

### 1.1 当前实现的局限
`extension/src/content/injector.ts` 现在是「块级 textContent 替换/追加」，**完全丢失 inline 标记**：

```
源 DOM：<p>今天 <a href="/">买了</a> 一本<em>书</em></p>
当前译文注入后：<p>Today <a>I bought</a> a book</p>   ← 链接/强调错位甚至丢失
```

沉浸式翻译、开源 DeepL-like 插件普遍卡在这一层。Lilt 给出了学术正解，但它在自训 NMT 模型内部训了 Alignment Layer，**LLM API 用户无法直接复用**。

### 1.2 行业标杆（Lilt）做法回顾
1. 训 Alignment Layer 让 attention 锐化
2. 取 attention 矩阵的 argmax 做粗对齐
3. **Span-Scoring**：枚举译文中所有可能 span，按 `in_span + out_span` 评分取最优，对 attention 噪声鲁棒
4. 把 tag pair 重落在最优 span

### 1.3 LLM 时代的三条可行路径

| 路径 | 做法 | 可行性 | 备注 |
|---|---|---|---|
| **P1 占位符约束 + 嵌入对齐** | 翻译前 tag → 唯一占位符，prompt 约束 LLM 保留；嵌入相似度作对齐矩阵兜底 | ⭐⭐⭐⭐⭐ | **主选** |
| **P2 双调用对齐** | 第一次纯译，第二次让 LLM 输出 alignment JSON | ⭐⭐⭐ | 成本翻倍，对齐噪声大 |
| **P3 logprob 对齐** | 用 OpenAI logprobs 近似 attention | ⭐ | API 不开放 attention，pass |

→ **本方案采用 P1**：占位符保结构 + multilingual-e5 嵌入对齐 + span-scoring 校正。

---

## 二、核心算法

### 2.1 流水线总览

```
DOM 段落
  │
  ▼
[1. Segment Encoder]  ── 提取 inline tag，替换为唯一占位符 <t1:em>...</t1>
  │                      记录 TagSpan 元信息（type / payload / 源 token 区间）
  ▼
AlignedSegment { sourceText, sourceTokens, tagSpans }
  │
  ▼
[2. LLM Translator]   ── prompt 强制约束：保留占位符原样，只译文字
  │                      （few-shot + 结构化输出 schema）
  ▼
targetText（含占位符）
  │
  ▼
[3. Embed Aligner]    ── multilingual-e5-small 对源/译 token 做 embedding
  │                      cosine 相似度 → alignment matrix A[i][j]
  ▼
alignment: number[tgtLen][srcLen]
  │
  ▼
[4. Span Projector]   ── 对每个 TagSpan 枚举译文 span，取 score 最优
  │                      in_span + out_span（直接对标 Lilt 公式）
  ▼
projectedSpans: { tagId, open, close, score }[]
  │
  ▼
[5. DOM Renderer]     ── 把占位符替换回真实 DOM 节点，按 projected span 注入
  │                      Shadow DOM 隔离，避免宿主 CSS 污染
  ▼
最终双语 DOM
```

### 2.2 Span-Scoring 算法（对标 Lilt §4.3）

```typescript
// 纯算法、无副作用、可单测
function projectTag(
  tag: TagSpan,
  align: AlignmentMatrix,  // [tgtIdx][srcIdx] ∈ [0,1]
  srcLen: number,
  tgtLen: number,
): ProjectedSpan {
  let best: ProjectedSpan = { tagId: tag.id, open: 0, close: 0, score: -Infinity }

  // 暴力 O(tgtLen²)；工程上用前缀和优化到 O(tgtLen)
  for (let open = 0; open <= tgtLen; open++) {
    for (let close = open; close <= tgtLen; close++) {
      let inSpan = 0      // 源 tag 内 → 译 span 内
      let outSpan = 0     // 源 tag 外 → 译 span 外

      for (let t = 0; t < tgtLen; t++) {
        for (let s = 0; s < srcLen; s++) {
          const p = align[t][s]
          const srcIn = s >= tag.openToken && s < tag.closeToken
          const tgtIn = t >= open && t < close
          if (srcIn && tgtIn) inSpan += p
          else if (!srcIn && !tgtIn) outSpan += p
        }
      }

      const score = inSpan + outSpan
      if (score > best.score) best = { tagId: tag.id, open, close, score }
    }
  }
  return best
}
```

**工程优化**：
- 预计算 prefix sum 矩阵 → O(tgtLen) 每 tag
- tag 数量典型 ≤ 5，全段 ≤ 1ms

### 2.3 占位符 schema

| Inline 标签 | 占位符 |
|---|---|
| `<em>词</em>` | `⟦t1:em⟧词⟦/t1⟧` |
| `<a href="/">词</a>` | `⟦t2:a⟧词⟦/t2⟧` |
| `<strong>..</strong>` | `⟦t3:strong⟧..⟦/t3⟧` |

> 用 `⟦¦⟧` 而非 `<>` 避免 LLM 把它当 HTML 解析/翻译。

**Prompt 片段**：
```
原文（含占位符，**所有 ⟦..⟧ 必须原样保留**）：
{sourceWithPlaceholder}

要求：
1. 仅翻译文字，占位符 ⟦tN:tag⟧...⟦/tN⟧ 必须原样保留位置和编号
2. 占位符之间的文字翻译后语序符合目标语言习惯
3. 输出 JSON: { "translation": "...", "tags_moved": [{ "id": "t1", "reason": "语序调整" }] }
```

### 2.4 嵌入对齐

- 模型：`multilingual-e5-small`（ONNX 跑在浏览器 WASM，或后端 Node）
- token 级别：把每个词取 embedding（短词取整段，长词细分）
- 相似度矩阵归一化：行 softmax → 概率 alignment
- **作用**：当 LLM 没把占位符放对位置时，用 alignment + span-scoring 推断正确位置

---

## 三、模块设计

```
extension/src/content/aligned/
├── segment-encoder.ts      # DOM → AlignedSegment
├── placeholder.ts          # 占位符编解码（⟦tN:tag⟧...⟦/tN⟧）
├── llm-translator.ts       # 调 LLM，结构化输出 + 占位符保留率
├── embed-aligner.ts        # multilingual-e5-small 调用，相似度矩阵
├── span-projector.ts       # ★ Lilt span-scoring 算法（纯函数）
├── dom-renderer.ts         # 还原占位符 + 按 projected span 注入 + Shadow DOM
├── quality-metrics.ts      # TagAccuracy / 占位符保留率 / 延迟打点
└── alignment-viz.ts        # dev 模式：渲染 alignment heatmap 到右下角
```

**集成位置**：替换 `injector.ts` 的简单 textContent 替换；保留 `scheduler.ts` 的视口优先调度不动。

---

## 四、TDD 拆分（先算法、后集成）

> 所有 case 用 vitest；E2E 用 Playwright；UI 回归用 Playwright snapshot。

| 顺序 | 测试文件 | 验证内容 | 金标准 |
|---|---|---|---|
| 1 | `span-projector.test.ts` | 纯算法：给定 mock alignment，正确算出最优 span | 复现 Lilt 论文 §4.3 例子 |
| 2 | `placeholder.test.ts` | 编解码对称性、嵌套 tag 处理 | 100% round-trip |
| 3 | `segment-encoder.test.ts` | 真实 DOM 片段 → AlignedSegment | 20 个真实复杂段落 |
| 4 | `llm-translator.test.ts` | mock LLM 响应，占位符保留率 | ≥ 95% |
| 5 | `embed-aligner.test.ts` | 已知平行句对，对齐矩阵正确 | 对角线高亮 |
| 6 | `dom-renderer.test.ts` | segment → DOM 注入，Shadow DOM 隔离 | 0 宿主 CSS 污染 |
| 7 | `e2e/layout.spec.ts` | Playwright 翻译 20 个真实页面 | CLS<0.02，链接 0 错位 |

---

## 五、可观测设计

### 5.1 翻译 Trace（每段都打）
```json
{
  "segmentId": "seg_42",
  "source": "今天 <a>买了</a> 一本<em>书</em>",
  "sourceWithPlaceholder": "⟦t1:a⟧买了⟦/t1⟧ 一本⟦t2:em⟧书⟦/t2⟧",
  "target": "⟦t2:em⟧book⟦/t2⟧ ⟦t1:a⟧bought⟦/t1⟧ a",  // LLM 译文（占位符移位了）
  "llmPlaceholderRetained": 1.0,
  "alignmentShape": "[3x4]",
  "projectedSpans": [
    { "tagId": "t1", "open": 2, "close": 3, "score": 1.82 },
    { "tagId": "t2", "open": 0, "close": 1, "score": 1.95 }
  ],
  "finalDom": "<em>book</em> <a>bought</a> a",
  "p50LatencyMs": 412
}
```

### 5.2 Dev 可视化
- 页面右下角浮层：alignment heatmap（Canvas 绘）
- 点击译文 token 高亮对应原文 token
- span-scoring top-3 候选展示

### 5.3 指标上报
| 指标 | 目标 | 采集方式 |
|---|---|---|
| Tag Projection Accuracy | ≥ 90% | 200 case 测试集自动跑 |
| 占位符保留率（LLM）| ≥ 95% | 每次翻译打点 |
| COMET 翻译质量 | ≥ 0.85 | wmt22 子集 |
| 延迟 P90 | < 800ms | OTLP trace |
| 复杂页面 CLS | < 0.02 | Lighthouse |

---

## 六、对标分析

| 维度 | Lilt 原版 | 沉浸式翻译 | 本方案 |
|---|---|---|---|
| Tag projection 算法 | ✅ span-scoring | ❌ 简单占位符替换 | ✅ span-scoring |
| Alignment 来源 | 自训 NMT attention | 无 | 嵌入相似度 |
| 占位符 prompt 约束 | N/A | ✅ | ✅ + 结构化输出 |
| Alignment 可视化 | ❌ | ❌ | ✅ dev heatmap |
| 翻译质量 CI 回归 | ❌ | ❌ | ✅ COMET 卡门槛 |
| Shadow DOM 隔离 | N/A（CAT 工具）| ❌ | ✅ |

---

## 七、路线图

| Phase | 交付 | 验收 |
|---|---|---|
| 0 | span-projector 纯算法 + 测试 | 论文用例复现，覆盖率 >90% |
| 1 | placeholder / encoder / embed-aligner | round-trip 测试通过 |
| 2 | llm-translator + 占位符 prompt 调优 | 200 case 占位符保留率 ≥ 95% |
| 3 | dom-renderer + Shadow DOM | 20 真实页面 0 错位 |
| 4 | quality-metrics + CI 集成 | Tag Accuracy ≥ 90%、COMET ≥ 0.85 |
| 5 | alignment-viz + dev 面板 | 简历 demo 可用 |
| 6 | 评测报告 `docs/eval-report.md` | 简历素材成稿 |

---

## 八、Multi-Agent 开发分工

按 CLAUDE.md 要求采用 multi agent，每个 agent 负责一个独立模块（worktree 隔离）：

- Agent-A：span-projector 算法 + 单测
- Agent-B：placeholder codec + segment-encoder
- Agent-C：embed-aligner（ONNX 跑 e5-small）
- Agent-D：llm-translator + prompt 工程
- Agent-E：dom-renderer + Shadow DOM
- Agent-F：测试集 + 评测脚本（独立工程）

agent 各自 PR 到 `feat/aligned-*` 分支，CI 跑通后合并。

---

## 九、简历素材预期产出

完成 Phase 6 后，简历可写：

> 主导 LLM 时代保结构流式翻译引擎，对标 Lilt 学术方案：
> ① 在 LLM API 不暴露 attention 的约束下，设计「占位符约束 + multilingual-e5 嵌入对齐 + span-scoring」三段算法，**复现并改进 Lilt Format Transfer (arXiv:1901.11359)**；
> ② 自建 200 case 测试集，Tag Projection Accuracy X%、COMET 0.X、占位符保留率 X%；
> ③ Shadow DOM 译文样式隔离，20 个真实复杂页面 CLS<0.02、链接 0 错位；
> ④ Dev 面板渲染 alignment heatmap + span-scoring top-K 候选，**翻译决策可观测**；
> ⑤ CI 接入 COMET 质量回归，卡门槛 0.85。

---

## 十、未决事项

1. e5-small 在浏览器 WASM 还是后端 Node？体积 ~120MB，倾向后端
2. 测试集标注：自建 200 case 需人工，是否走 Crowdin / Scale AI 外包？
3. 占位符 LLM 不保留时的 fallback 策略：重试 vs 接受？
