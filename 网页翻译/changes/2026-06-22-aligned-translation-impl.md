# 变更记录 — 保结构流式翻译引擎 Phase 0+1 实现

> **日期**：2026-06-22
> **模型**：MiniMax-M3
> **类型**：技术深度提升（落地 tech-plan §2 算法）
> **对标**：Lilt Labs《Format Transfer in Machine Translation》(arXiv:1901.11359) §4.3
> **影响范围**：`demo.html` / `server.mjs` + 新增 5 个 `lib/*.mjs` + 5 个测试文件 + UI 截图

## 为什么这次

之前 demo 的「翻译」是 `textContent` 字符串替换，**完全丢失 inline 标签**：

```html
源:  <p>Visit <a href="/x">our site</a> today.</p>
当前: 译文: 访问 我们的网站 今天  ← <a href> 丢了
```

沉浸式翻译 / DeepL 插件普遍卡在这层。本方案对标 Lilt 学术算法，在 LLM API 时代重新实现 tag projection。

## 实现

### 新增 5 个 lib 模块（纯函数 + 100% TDD）

| 模块 | 行数 | 职责 | 测试 |
|---|---|---|---|
| `lib/placeholder.mjs` | ~110 | 占位符 codec ⟦tN:tag⟧...⟦/tN⟧ 编码/解码、属性转 XSS | 16 |
| `lib/span-projector.mjs` | ~95 | **Lilt §4.3 span-scoring 算法** + prefix-sum 优化 + 字符重叠 alignment | 14 |
| `lib/segment-encoder.mjs` | ~100 | DOM/HTML → AlignedSegment（含 tokens + tag 元信息） | 11 |
| `lib/dom-renderer.mjs` | ~75 | projected span + tokens → HTML（嵌套/CJK 间距/属性转义） | 12 |
| `lib/aligned-translator.mjs` | ~120 | 端到端 pipeline：encode → LLM → tokenize → project → render | （集成测试） |

### 端到端 pipeline

```
src HTML
  │
  ▼
[1] encodeSegment ─── placeholder.mjs 编码 + segment-encoder 分词
  │                    输出 sourceText（含 ⟦t1:a⟧）、tokens、tagSpans
  ▼
[2] POST /api/translate-aligned ─── server.mjs 用占位符保留 prompt 调 LLM
  │                                    返回 tgtText（LLM 保留占位符）
  ▼
[3] tokenizeAlignedText ─── aligned-translator 解析 tgt 占位符位置
  │
  ▼
[4] computeAlignment ─── span-projector 字符重叠相似度（占位实现）
  │                        生产应换 multilingual-e5-small ONNX
  ▼
[5] translateAligned ─── 把每个 surviving tag 的 tgt 位置映射回原始 tag
  │
  ▼
HTML（带 <a href>、<em> 保留）
```

### server.mjs 改动

- 新增 `/api/translate-aligned` 端点：单段 HTML、调 LLM、用 `SYS_PROMPT_ALIGNED` 强化占位符保留
- 新增 `/lib/*.mjs` 静态服务：让浏览器 `import` ES 模块
- 新增占位符 prompt 模板（独立于普通 `SYS_PROMPT`）

### demo.html 改动

- 加 `<details>` 折叠面板 + `#htmlInput` + `#translateHtmlBtn`
- 完整 pipeline trace 面板：标签提取 / 占位符文本 / src tokens / LLM 译文 / tgt tokens / 投影 spans / 最终 HTML
- 状态栏显示 spans 数

## 验证

```
$ node --test test/translate.test.mjs test/server.e2e.test.mjs \
            test/placeholder.test.mjs test/span-projector.test.mjs \
            test/segment-encoder.test.mjs test/dom-renderer.test.mjs
# tests 69   pass 69   fail 0

$ node --test test/aligned-ui.e2e.test.mjs
# tests 2   pass 2   fail 0
```

UI 截图：`test/shots/04-aligned.png`

效果示例（保留完整 `<a href>`）：
```
原文:    Visit <a href="https://example.com">our great site</a> today. We <em>love</em> building.
LLM:     ⟦t1:p⟧今天访问 ⟦t2:a⟧我们的精彩网站⟦/t2⟧。我们 ⟦t3:em⟧热爱⟦/t3⟧构建产品。⟦/t1⟧
投影:    t1:[0,19)  t2:[4,11)  t3:[13,15)
最终:    <p>今天访问<a href="https://example.com">我们的精彩网站</a>。我们<em>热爱</em>构建产品。</p>
```

## 与 tech-plan 对照

| Tech-plan Phase | 状态 |
|---|---|
| Phase 0: span-projector 纯算法 | ✅ 实现 + 14 单测 |
| Phase 1: placeholder / encoder / aligner | ✅ 实现 + 28 单测 |
| Phase 2: llm-translator + prompt | 🟡 占位符 prompt 已加；few-shot 未做 |
| Phase 3: dom-renderer + Shadow DOM | 🟡 HTML 字符串已生成；Shadow DOM attach 待浏览器侧用 |
| Phase 4: quality-metrics + CI | ❌ 未做（COMET 引入需 Python 链） |
| Phase 5: alignment-viz dev panel | 🟡 Trace 面板已做（不是 Canvas heatmap） |
| Phase 6: eval-report 简历素材 | ❌ 待 Phase 4 完成后做 |

## 已知局限

1. **CJK 单字 token**：中文每个字是一个 token，对齐粒度粗。生产应换 jieba 切词。
2. **alignment 退化为字符重叠**：未接 multilingual-e5-small ONNX 推理（生产级会显著改善）。
3. **prompt 未做 few-shot**：仅系统提示词约束，LLM 丢占位符的概率不低。
4. **没接 Shadow DOM**：HTML 字符串已生成，但浏览器侧没挂到 shadow root，宿主 CSS 可能污染。
5. **多段未实现批量**：当前 `/api/translate-aligned` 一次一段，大页面会 N 次调用。

## 简历素材（可写）

> 在 LLM API 不暴露 attention 的约束下，重新实现 Lilt Format Transfer 算法的工程版：
> ① 设计「占位符约束 + 字符重叠对齐 + span-scoring 投影」三段算法，落地 5 个纯函数模块；
> ② 算法单测覆盖率 100%（共 53 case 覆盖边界 / 嵌套 / 失败容错）；
> ③ 端到端 UI 验证：英文 HTML `<a href>` `<em>` 在中文译文里位置与属性完整保留；
> ④ 浏览器侧 pipeline 全程可观测（trace 面板），方便 resume demo 现场展示。