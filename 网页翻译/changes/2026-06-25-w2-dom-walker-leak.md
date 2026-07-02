# 2026-06-25 W2 漏翻修复 — dom-walker 段落提取覆盖度

> **模型**：Claude (Sonnet 4.5)

## 问题

用户反馈"漏翻很多"。实测 BBC 151 段时漏 80 段，对比页面真实文字节点：

| 漏翻类别 | 示例 |
|---------|------|
| inline 元素直接含文字 | `<span>4 hrs ago</span>` |
| 容器型 div 直接含文字 | `<div class="banner">Click here...</div>` |
| A 链接文字 | `<a href="/x">Read full story</a>` |

## 根因

`extension/src/content/dom-walker.ts` 旧 `BLOCK_TAGS` 仅 13 个标准块级：
```
P H1-H6 LI TD TH BLOCKQUOTE FIGCAPTION DT DD
```

- `<span>` `<a>` `<em>` 等 inline 元素**直接含文字**时：walkElement 递归 children，但 text node 不在 `el.children` 里 → **段丢失**
- `<div>` `<section>` 等容器直接含文字时：同样递归不进 text node → **段丢失**

## 修复

### 1. LEAF_BLOCK_TAGS（叶子可提取）

原 BLOCK_TAGS + 新增 inline 文字承载元素：
```
+ A, SPAN, LABEL, EM, STRONG, B, I, SUB, SUP, Q, CITE, TIME
```

### 2. CONTAINER_BLOCK_TAGS（容器型）

```
DIV, SECTION, ARTICLE, ASIDE, HEADER, FOOTER, NAV, MAIN, FIGURE, DETAILS, SUMMARY
```

### 3. walkElement 加 hasInnerBlock 检查

容器型元素：
- 若 `el.querySelector(BLOCK_SELECTOR)` 有命中 → 继续递归子元素（避免把外层容器整段算一段，HN 的 td 套 td 场景）
- 否则把容器本身算一段（兜底 banner/metadata 类布局）

LEAF_BLOCK_TAGS 仍直接提取（包括 inline 元素）。

## TDD

`extension/test/unit/dom-walker.test.ts` 加 6 个新用例：

| 用例 | 覆盖场景 |
|------|----------|
| 直接含文字的 `<span>` 被提取 | BBC metadata "4 hrs ago" |
| 多个 inline span 各自提取不合并 | BBC 列表 metadata |
| 容器型 DIV 含子 BLOCK 时继续递归 | 标准 P 包裹 |
| 容器型 DIV 直接含文字时作为一段 | banner 类 |
| A 链接直接含文字被提取 | 链接文案 |
| P 内 inline 元素不重复提取 | P 合并 inline 子元素 |

测试结果：dom-walker.test.ts **28/28 通过**（原 22 + 新 6）。

## 端到端验证（用户指定页面）

`test/ext-multi-page.mjs`（playwright + chromium + 真实页面）：

### alibaba.com 首页

```
提取段数: 353（body 68993 字符）
[1s] injected=20
[2s] injected=217
[3s] injected=336
✅ 翻译完成 ≥ 90% (336/353 = 95%)
```

样例段（含旧版漏掉的 inline 文字）：
- "交货至："、"简体中文-CNY"、"创建账户"、"所有类目"、"推荐类目"

### console.volcengine.com/iam/identitymanage/settings

未登录跳到登录页：
```
提取段数: 25
[1s] injected=67（含 hover 对齐 token span）
✅ 完成
```

样例：
- "欢迎来到火山引擎"、"账号登录"、"手机号登录"、"登录视为您已阅读并同意..."

## vitest 全量

| 阶段 | 通过/总数 |
|------|-----------|
| 修复前 | 119/120（1 老 flake） |
| 加 scheduler 修复 | 120/121 |
| **加 dom-walker 修复** | **126/128**（1 老 flake + 1 skipped） |

新增 6 个 dom-walker 测试 + 1 个 scheduler 测试全部通过。

## 已知遗留

1. **火山引擎 IAM 真实页**（登录后）未测 —— 需用户登录后实测
2. BBC 反爬限制 playwright 重连（ERR_CONNECTION_CLOSED），但首次测试已有数据
3. 纯 CJK 段在 `tgtLang=zh` 下被 isPureChinese 过滤（设计正确，避免反向翻译）
