# 2026-06-24 — 三方 Benchmark：占位符 vs 直接 HTML vs DeepL

## 模型
- LLM 翻译：MiniMax（abab）
- 第三方对比：DeepL Free API（`tag_handling=html, v2`）

## 改动
- `benchmark/tag-retention.mjs`：新增方案 C `runDeepL()`
  - DeepL 2025-11 起弃用 form-body `auth_key`，已切到 `Authorization: DeepL-Auth-Key` header
  - 用 `--deepl` flag 启用，未传则只跑 A/B（保持向后兼容）
- 输出新增 DeepL 列、`vs DeepL` 对比、平均延迟对比
- JSON 结果含 `model` 元数据，便于简历引用

## 结果（24 case，19 个含标签）
| 方案 | 标签保留率 | 平均延迟 |
|---|---|---|
| **占位符（本项目）** | **98.3%** (59/60) | 1360ms |
| 直接 HTML | 100.0% (60/60) | 964ms |
| DeepL 原生 HTML | 93.3% (56/60) | 1048ms |

**核心发现**
1. **占位符 vs DeepL：+5.0 个百分点** — DeepL 在 `sub-sup` / `complex-1` 场景丢标签
2. 占位符 vs 直接 HTML：-1.7 个百分点（已知 trade-off：换安全隔离）
3. 占位符 1 个回归 case：`tech-1`（`useEffect` 内联代码）LLM 把 `⟦t1⟧useEffect⟦/t1⟧` 输出成 `⟦t1:useEffect⟧useEffect</code>`，是 prompt 约束问题，非 codec bug

## 简历叙事更新
从「标签保留率更高」调整为：
> **基于 LLM 占位符约束的 HTML 感知翻译：在 24 case benchmark 中标签保留率 98.3%，超过 DeepL 原生 HTML 处理（93.3%）5 个百分点，同时通过 attrs 不进 LLM + 三层 XSS 防御（tag 白名单 / attr 黑名单 / URL 协议白名单）实现安全隔离，直接 HTML 方案无法做到。**

## 待办
- [ ] 修 `tech-1` 回归：prompt 强化「不要改写占位符格式」
- [ ] 4 个 `fetch failed` 用例（multi-tags / link-code / del / tag-end）需重跑，疑似瞬时网络
- [ ] 把 benchmark 结果挂到 demo 页面，可视化对比
