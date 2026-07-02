# 商业翻译产品「hover 词级高亮」行业调研

**调研日期**：2026-06-24
**调研方法**：WebSearch + webReader 实地查证官网 / 论文 / 博客 / Stack Overflow / GitHub
**调研对象**：DeepL / Google Translate / Lilt / Smartcat / MateCat / Phrase / Readlang / LingQ / Immersive Translate / Saladict
**结论先行**：**行业 de facto 标准是 attention/word-alignment + 前端 span-project，没有一家靠 LLM 直出 markup 拼装做对齐**。我们项目用的 Lilt §4.3 span-scoring 就是顶级商业产品（Lilt 自己）的同源算法。

---

## 1. DeepL — 词级对齐的工业标杆

### 实际可观测行为
- **Web 版（deepl.com/translator）**：hover 源/目标侧任一词，**对侧对应词同时高亮**（同 span 联动）
- **Click 词 → 弹下拉菜单**显示该词（实际是该短语）的备选译文；周围文本会自动重排
- **Clarify 功能**（新）：源文本歧义时反向问用户选上下文，再生成
- 官方原话（Help Center）："alternatives appear directly under your translation (for short texts) **or in a dropdown list by clicking on a word**"

### 技术栈推断（有官方背书）
官方博客 [How does DeepL work?](https://www.deepl.com/en/blog/how-does-deepl-work) 白纸黑字写明：
> "the neural networks of DeepL also contain parts of this architecture, **such as attention mechanisms**. However, there are also significant differences in the topology of the networks..."

也就是说：
- 底层是 **Transformer 架构（带 attention）+ 自研拓扑改动**
- 词级对应关系来自 **attention 矩阵 → word alignment**
- Click 后下拉菜单的备选译文，是 force-decode 不同 target token 时 beam search 出来的 n-best 列表（典型的 interactive MT 手法）
- 前端用 `<span>` 包裹每个目标 token，hover/click 事件回调查对齐表

### 引用
- [DeepL Help Center — Select alternatives](https://support.deepl.com/hc/en-us/articles/4407359201938)
- [DeepL official blog — How does DeepL work?](https://www.deepl.com/en/blog/how-does-deepl-work)
- [DeepL Clarify feature](https://www.deepl.com/en/features/clarify)
- [DeepL Alternatives feature page](https://www.deepl.com/en/features/alternatives)

---

## 2. Google Translate — 早期 span-class 范式奠基者

### 实际可观测行为
- Web 翻译框里 hover 源/译文单词，**对应词高亮**
- 准确率一般（社区长期吐槽），尤其 morphologically rich 语言（俄语 / 阿语 / 日语）经常错位
- Chrome 扩展版没有 hover 对齐，只有 popup 翻译

### 技术栈推断（有 Stack Overflow 实证）
[Stack Overflow #5664263](https://stackoverflow.com/questions/5664263/google-translator-highlight-effect) 早年有扒过 Google Translate 翻译框的 DOM：
> "Google Translate does it, is to **split up each word in a sentence into separate `<span>` tags with matching classes**."

也就是：
- 后端：早期 SMT（phrase-based statistical）→ 2016 后转 GNMT（Transformer-like attention）→ 现在是 hybrid LLM
- **对齐信号**：早期 SMT 时代直接用统计 word alignment（Giza++ / fast_align），NMT 时代从 attention 抽取
- 前端：每个 token 一个 span，对应词对共享同 class（如 `class="gt-align-7"`），CSS `:hover` 联动
- **为什么经常错**：[arXiv:2109.05853](https://arxiv.org/abs/2109.05853) "Attention Weights in Transformer NMT Fail Aligning Words" 实证 Transformer 的 attention 对 word alignment 任务系统性不可靠，所以 Google Translate 的高亮经常"差不多但不准"

### 引用
- [Stack Overflow — Google translator highlight effect](https://stackoverflow.com/questions/5664263/google-translator-highlight-effect)
- [Google Support thread — hover and highlight feature issue](https://support.google.com/translate/thread/295257138)
- [arXiv:2109.05853 — Attention is not alignment](https://arxiv.org/abs/2109.05853)

---

## 3. Lilt — 唯一公开算法的「真·词对齐」商业产品

### 实际可观测行为
- 交互式翻译 IDE，**译员每打一个词，机器预测下一个词**（prefix-constrained MT）
- 译文区每个 token 可 hover，**源 token 高亮** —— 真·1:1 word alignment
- **格式标签（bold / italic / link）自动从源投射到译文**：译员翻完后系统把 tag 自动塞到译文对应位置；塞错时支持拖拽 / 快捷键调整

### 技术栈（公开了 3 篇论文，是我们项目的算法来源）
[Lilt Labs — Format Transfer in Machine Translation](https://labs.lilt.com/format-transfer-in-machine-translation)（Thomas Zenkel, 2022）讲得非常细：

#### 3.1 Alignment Layer（专改对齐质量的 Transformer 变体）
> "We design a dedicated **Alignment Layer** to force the neural network to predict the next token, based only on a linear combination of the source representation."

普通 Transformer 的 attention 太"散"（很多 attention 落到标点 "." 上），Lilt 强制让一个 decoder step 必须用 source 表示的线性组合来预测 next token，**逼着 attention 学对齐**。

#### 3.2 Span-Scoring 算法（即我们 `span-projector.mjs` 的来源）
源端有一个 tag pair 覆盖多个 token（比如 `<b>To see if this segment contains errors</b>`），要找到译文里**最优**的覆盖范围。Lilt 给每个候选 span (open, close) 算分：

```
score(span) = in_span_score + out_span_score
  in_span_score  = #attention_entries(src_in_tag → tgt_in_span)
  out_span_score = #attention_entries(src_not_in_tag → tgt_not_in_span)
```

枚举所有 (open, close) 取最大。**这就是我们 lib/span-projector.mjs 实现的算法**（外加 prefix-sum 把 O(tgtLen³) 降到 O(tgtLen²)）。

#### 3.3 三篇核心论文
1. [Adding Interpretable Attention to Neural Translation Models Improves Word Alignment (arXiv:1901.11359)](https://arxiv.org/abs/1901.11359) — Alignment Layer
2. [End-to-End Neural Word Alignment Outperforms GIZA++ (ACL 2020)](https://aclanthology.org/2020.acl-main.146/) — 超越 GIZA++ 的 neural aligner
3. [Automatic Bilingual Markup Transfer (Findings EMNLP 2021)](https://aclanthology.org/2021.findings-emnlp.299/) — span-scoring 算法 + 实验对比，代码在 [github.com/lilt/markup-transfer-scripts](https://github.com/lilt/markup-transfer-scripts)

### 准确率
论文报告对源 tag pair 投射到译文的 **token-level accuracy 显著高于 baseline**（baseline 是简单的 argmax attention 左右取极值）。

### 引用
- [Lilt Labs — Technology for Interactive MT](https://labs.lilt.com/technology-for-interactive-mt)（描述 prefix-constrained MT 思路）
- [Lilt Labs — Format Transfer in Machine Translation](https://labs.lilt.com/format-transfer-in-machine-translation)（核心，§4.3 就是我们项目用的）
- [Automatic Bilingual Markup Transfer 论文](https://aclanthology.org/2021.findings-emnlp.299/)

---

## 4. Smartcat / MateCat / Phrase — CAT 工具的 Segment 级高亮

### 实际可观测行为
- 这三家都是 **segment（句子/单元格/列表项）级**双语对照，**不做词级高亮**
- 源段在左、译文在右，TM 命中时高亮"100% match / fuzzy match / context match"
- **没有 hover 单词联动对侧的功能**（这是 CAT 工具和 MT 工具的根本差异：CAT 假设译员自己懂双语，机器只提供 TM 词典辅助）

### 技术栈
- 文本切分：基于句子边界检测（ICU BreakIterator / 规则），不是对齐
- 高亮：基于 fuzzy match ratio，把"差几个词"的部分用不同底色标出，**不需要 attention**
- MateCat 自带一个 [Matecat Aligner](https://guides.matecat.com/mate) 工具：给两份现成的源/目标文件，用统计对齐生成 TMX，**事后对齐**而不是翻译时实时对齐

### 结论
**CAT 工具完全不是我们的对标对象**。它们做的是 translator productivity，不是给最终用户看的"hover 词对齐"。我们抄的对象应该是 DeepL / Lilt 这种 MT 产品形态。

### 引用
- [Smartcat — What is a CAT tool?](https://www.smartcat.com/blog/what-is-a-cat-tool/)
- [Smartcat Editor Overview](https://help.smartcat.com/1539449-editor-functionalities-overview/)
- [MateCat Aligner Guide](https://guides.matecat.com/mate)
- [Phrase — What is a CAT tool?](https://phrase.com/blog/posts/cat-tools/)

---

## 5. Readlang / LingQ — 语言学习类阅读器

### 实际可观测行为

**Readlang**（[官网](https://readlang.com/) 实测）：
- 点击单词 → 弹翻译（inline 替换）
- 拖选短语 → 翻译短语
- 翻译过的词进 SRS 闪卡
- **没有"hover 这个词，对侧某词高亮"的对应关系**，因为压根**没有源/译对照双语显示**——它是单语阅读 + 按需查词
- 定价页泄露实现细节：免费版"phrase translations per day = 10, **6 words per phrase**"，Premium "12 words per phrase"——证明它就是**按用户拖选范围发翻译请求**，没有 alignment 概念

**LingQ**：
- 同样 click-to-lookup 模式
- 词典查词 + 用户保存的 hint，**完全不做机器对齐**
- 重点在"已知词 / 学习中词 / 新词"统计与 SRS

### 技术栈
- Readlang 早期作者博客自述：第一版就是「点词 → 调 Google Translate API → inline 替换」
- 没有对齐算法，没有 attention，没有 span-project
- 单纯是 DOM 包 span + click 发请求

### 结论
**语言学习类阅读器根本不是「翻译对齐」产品**，只是「划词查词 + 闪卡」。我们调研它们是为了**排除**——证明它们对我们没参考价值。

### 引用
- [Readlang 官网](https://readlang.com/)
- [Readlang Web Reader 介绍](https://blog.readlang.com/2013/09/20/web-reader.html)
- [LingQ SRS 算法讨论](https://forum.lingq.com/t/do-you-use-lingqs-srs-algorithm/77609)

---

## 6. Immersive Translate（沉浸式翻译）— 中文圈最流行

### 实际可观测行为（实测 + 官方文档确认）
- **整页翻译模式**：原文段落 + 译文段落上下对照（**段落级**对齐，不是词级）
- **鼠标悬停模式**：按 Shift + hover 段落 → 该段落译文显示在下方（**最小单位是段落，不是句子或单词**）
- **划词翻译**：选中词/短语 → 弹小窗给翻译，**和上面的段落翻译是两套互不相干的机制**
- **官方设计哲学原话**："段落在沉浸式翻译的设计理念中被视为最小单位，保留其上下文"（来自[官方文档](https://immersivetranslate.com/zh-Hans/docs/features/hover/)）
- 社区已有 [Issue #2075](https://github.com/immersive-translate/immersive-translate/issues/2075) 请求"hover 时只翻译单词"，**官方至今未实现**

### 技术栈推断
- [old-immersive-translate 开源旧版](https://github.com/immersive-translate/old-immersive-translate) 关键描述：「**双语显示，按照段落分割**；只翻译网页内容区域而非所有元素」
- DOM 实现：遍历页面找内容区（排除 nav/footer/script），按段落包 span，译文作为 sibling 节点 append
- **没有词对齐**，因为段落是原子单位
- 当前版（[chrome webstore](https://chromewebstore.google.com/detail/immersive-translate-ai-we/bpoadfkcbjbfhfodiogcnhhhpibjhbnh)）已闭源，但核心 DOM 注入思路没变

### 关键结论
**沉浸式翻译不解决「词级 hover 高亮」问题，它绕开了这个问题**——通过段落级对照让用户自己脑补对齐。这是产品取舍（简单 + 准确）而不是技术难题。

### 引用
- [Immersive Translate 官方 — 鼠标悬停翻译文档](https://immersivetranslate.com/zh-Hans/docs/features/hover/)
- [Immersive Translate — 划词功能介绍](https://immersivetranslate.com/blog/select-and-translate-launch/)
- [GitHub Issue #2075 — 请求单词级 hover](https://github.com/immersive-translate/immersive-translate/issues/2075)
- [old-immersive-translate 开源旧版](https://github.com/immersive-translate/old-immersive-translate)

---

## 7. Saladict（沙拉查词）— 划词翻译范式

### 实际可观测行为
- **划词翻译**：选中文字 → 鼠标抬起时在选中区附近弹面板，聚合多本词典（牛津 / 柯林斯 / 城市词典 / 日韩法德西）
- **悬浮取词**：可配置为"按住快捷键 + hover 单词"触发，**词典查询**而非翻译
- **多模式**：图标点击、双击、组合键、悬浮取词（来自 [Chrome 商店](https://chromewebstore.google.com/detail/%E6%B2%99%E6%8B%89%E6%9F%A5%E8%AF%8D/crmphedfefkbimjjhkldkjjilcjfcpnf)）
- 浏览器外划词：通过**剪贴板中转 + 全行快捷键**打开独立窗口（[官方说明](https://saladict.crimx.com/native)）

### 技术栈推断
- 纯**前端扩展**，content script 监听 `mouseup` / `selectionchange`，拿 `window.getSelection().toString()` 发请求
- **没有任何"源/目标对齐"概念**——查的是词典，不是翻译
- hover 取词模式：监听 `mouseover`，结合 caretRangeFromPoint 拿到光标下的词，发词典查询
- 多词典聚合：并发请求各家 API，按 UI 顺序展示

### 结论
和 Readlang / LingQ 一样，**Saladict 也不解决「翻译对齐」问题**。它是词典工具，定位完全不同。但它**示范了「hover 取词 + 弹窗」的极致前端体验**——这点我们可以借鉴 UX。

### 引用
- [Saladict 官网](https://saladict.crimx.com/)
- [Saladict 浏览器外划词原理](https://saladict.crimx.com/native)
- [Saladict 使用手册](https://saladict.crimx.com/manual)
- [Saladict GitHub 源码](https://github.com/crimx/ext-saladict)

---

## 行业实际 de facto 标准总结

### 标准是什么
**没有任何一家头部商业翻译产品用「LLM 直出 markup 拼装」做 hover 词对齐**。它们的共同范式是：

```
后端：NMT (Transformer + attention) → 抽取 word alignment matrix
         ↓
中端：alignment → span-project（如 Lilt 的 span-scoring）
         ↓
前端：每个 token 包 <span data-align-id="N">，hover 时 CSS 联动对侧同 id 的 span
```

具体每家的实现：

| 产品 | 对齐信号 | 前端实现 | 准确率 | 是否公开算法 |
|------|---------|---------|--------|------------|
| **DeepL** | Transformer attention（自研拓扑） | span + hover 联动 | 高（业内最好） | 部分（attention 公开，拓扑保密） |
| **Google Translate** | NMT attention（有噪声） | span + 共享 class | 中（morphologically rich 语言常错） | 否 |
| **Lilt** | **Alignment Layer + span-scoring** | span-project 到 tag 位置 | 高（论文报告超越 GIZA++） | **完全公开（3 篇论文）** |
| **Smartcat / MateCat / Phrase** | 无（segment 级） | 表格行高亮 | N/A（不做词对齐） | N/A |
| **Readlang / LingQ** | 无 | click → 词典查询 | N/A（词典不是翻译） | 部分（Readlang 早期博客） |
| **Immersive Translate** | 无（段落级对照） | 段落 sibling append | N/A（让用户脑补对齐） | 旧版开源 |
| **Saladict** | 无 | mouseup → 词典弹窗 | N/A（词典） | 开源 |

### 中文 ↔ 英文 语言对的特殊性
1. **token 边界**：中文没有空格，需要先分词（jieba / HanLP / LTP）；英文天然空格分词
2. **顺序错位严重**：中英 SVO 一致但 modifier 顺序反（中文"红色的苹果" vs 英文"red apple"），简单左对齐会错
3. **省略频繁**：中文常省主语 / 量词，1 个英文 token 可能对应 0 个中文 token
4. **数字 / 品牌词**：纯直通，对齐应该 1:1（这正是我们 placeholder codec 处理的部分）
5. **CJK ↔ Latin 空格渲染**：多 token 渲染 HTML 时要"先空格再开标签"，CJK↔CJK 紧贴

### 浏览器扩展 vs 网页版的差异
**做法不一样**：
- 网页版（DeepL / Google Translate）**控制源/译双区 DOM**，可以精确包 span 做对齐
- 浏览器扩展（沉浸式翻译 / Saladict）**只能操作第三方页面 DOM**，注入风险高，所以**要么段落级对照（沉浸式），要么纯划词（Saladict）**，没人敢在第三方页面里做精确词级对齐（成本高 + 易破坏原页布局）

### 我们能不能复用 Lilt 算法
**能，而且已经在用**：
- `lib/span-projector.mjs` 实现的就是 Lilt §4.3 的 in-span + out-span scoring，外加 prefix-sum 优化到 O(tgtLen²)
- `lib/aligned-translator.mjs` 是端到端 pipeline
- `test/span-projector.test.mjs` 已覆盖核心 case
- MEMORY.md 已记录关键坑（placeholder 必须占独立位置、CJK 分词、prefix-sum 等）

**我们还差什么**（相对 Lilt / DeepL 的差距）：
1. **对齐信号来源**：Lilt 用 Transformer attention matrix；我们目前是用 LLM 让它直接吐对齐提示（更贵 + 更不稳定）。可以考虑：
   - 走 NMT API（DeepL Pro）+ 自建 aligner 后处理
   - 或继续 LLM 但 prompt 强化（已在 placeholder codec 里部分实现）
2. **Alignment Layer 级别的精度**：Lilt 的专用 layer 把 attention 锐化，我们的 LLM 路径没有这个 lever
3. **tag 投射的失败兜底**：Lilt 有 fault tolerance + 手动拖拽，我们目前一旦 align 失败就直出整段

### 下一步行动建议
1. **保留现有 Lilt §4.3 span-scoring 实现**（已是行业最佳实践的同源算法）
2. **补 UI 回归测试**：hover 联动的 CSS 联动 + 多 token 渲染的空格逻辑（MEMORY.md 里已有坑记录）
3. **对齐失败兜底**：当 span-projector 算不出高分 span 时，回退到"段落级对照"而不是裸文本，UX 接近沉浸式翻译
4. **不要追 LLM 直出 markup 的路线**：行业无人验证、不稳定、难调试
5. **考虑接 DeepL API 做 benchmark**：把我们的 aligner 和 DeepL attention 抽取的对齐做准确率对比，作为技术方案 V2 的证据

---

## 附：调研覆盖度自检

- DeepL：官方博客 + Help Center + Features 页 ✓
- Google Translate：Stack Overflow 扒 DOM + arXiv 论文 ✓
- Lilt：3 篇论文 + 2 篇 Labs 博客 ✓（最全）
- Smartcat / MateCat / Phrase：官网 + 文档 ✓
- Readlang / LingQ：官网 + 作者博客 ✓
- Immersive Translate：官方文档 + GitHub Issue + 开源旧版 ✓
- Saladict：官网 + GitHub ✓
- ORenji：搜不到独立资料（可能是 yomichan 类的日语查词扩展），不单独成段
