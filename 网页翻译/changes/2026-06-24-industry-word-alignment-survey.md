# 2026-06-24 — 商业翻译产品 hover 词级高亮行业调研

## 类型
research / 调研文档（不改代码）

## 模型
claude-sonnet-4-5（Anthropic Claude Code agent）

## 动机
网页翻译项目要实现 hover 词级高亮，需要先确认「行业实际在用什么方法」。
避免凭直觉选型（尤其要避开「LLM 直出 markup」这种没人验证过的路线）。

## 输出
新增文档：`docs/industry-word-alignment-survey.md`

## 调研方法
WebSearch + webReader 实地查证，覆盖 7 类产品（DeepL / Google Translate / Lilt / Smartcat / MateCat / Phrase / Readlang / LingQ / Immersive Translate / Saladict），每个产品给引用链接。

## 关键结论

### 行业 de facto 标准
**后端 attention 抽 word alignment → span-project（Lilt §4.3 算法）→ 前端 token 包 span 联动**。
没有一家头部产品用「LLM 直出 markup 拼装」做 hover 对齐。

### 各产品技术栈一览
| 产品 | 对齐方法 | 是否公开 |
|------|---------|---------|
| DeepL | Transformer attention（自研拓扑） | 部分 |
| Google Translate | NMT attention（有噪声，常错） | 否 |
| Lilt | Alignment Layer + span-scoring | **完全公开（3 篇论文）** |
| CAT 三家 | 不做词对齐（segment 级） | N/A |
| Readlang / LingQ | 不做对齐（词典查询） | 部分 |
| Immersive Translate | 段落级对照（绕开对齐问题） | 旧版开源 |
| Saladict | 词典弹窗（不做对齐） | 开源 |

### 对我们项目的意义
1. **我们 lib/span-projector.mjs 实现的 Lilt §4.3 算法就是行业最佳实践**，继续保留
2. **CAT 工具不是对标对象**（segment 级，不做词对齐）
3. **语言学习类（Readlang / LingQ）和词典类（Saladict）不是对标对象**（不做翻译对齐）
4. **浏览器扩展形态产品（沉浸式 / Saladict）都绕开了词级对齐**，因为在第三方 DOM 里做精确对齐风险高
5. **中文 ↔ 英文特殊处理**：分词、顺序错位、省略、品牌词直通、CJK 空格渲染（MEMORY.md 已记录）

### 下一步建议
- 保留现有 span-projector
- 补 UI 回归测试（hover 联动 + 多 token 空格）
- 对齐失败兜底回退到段落级
- 不追 LLM 直出 markup 路线
- 考虑接 DeepL API 做 benchmark

## 引用密度
每个产品 ≥ 3 个独立引用源，关键论断（如 Lilt §4.3 算法、DeepL 是 Transformer+attention）都有官方/论文链接。
