# 2026-06-25 W1-4 真实站点兼容性矩阵

> **模型**：Claude (Sonnet 4.5)

## 决策

5 个代表性站点（BBC/GitHub/Arxiv/MDN/掘金）跑 dom-walker 提取，
验证扩展在真实站点上不会崩、不漏段、不抽到脚本/样式。

## fixture 抓取

```bash
mkdir -p test/fixtures/sites
curl -A 'Mozilla/5.0' https://www.bbc.com/news                → 404KB
curl -A 'Mozilla/5.0' https://github.com/torvalds/linux       → 333KB
curl -A 'Mozilla/5.0' https://arxiv.org/abs/1706.03762        →  48KB
curl -A 'Mozilla/5.0' https://developer.mozilla.org/.../Promise → 195KB
curl -A 'Mozilla/5.0' https://juejin.cn/post/...              →  50KB（反爬只给导航）
```

> 知乎 zse-ck 反爬拦截 → 改用掘金。掘金 SSR 后端校验 → 客户端首屏只渲染导航，
> 段数偏低（2），符合预期，不是 dom-walker bug。

## 改动

- **新增** `test/fixtures/sites/{bbc,github,arxiv,mdn,juejin}.html` — 5 站真实 HTML 快照
- **新增** `extension/test/unit/site-matrix.test.ts`（10 测试）
  - 5 站 × dom-walker 健康度（段数阈值 + 角色分布 + 首段抽样）
  - 数据卫生：无 script/style tag 泄漏、无空段、<5% 超长段（>5000 字）
  - 5 站 × fixture 自身有效性（HTML 含 doctype / 长度 > 1KB）

## 实测结果

| 站点     | 段数 | 角色分布                                       | 首段样本 |
|----------|------|------------------------------------------------|----------|
| BBC      | 149  | body, heading, list-item                       | "Home" |
| GitHub   | 123  | body, heading, list-item, table-cell           | "Navigation Menu" |
| Arxiv    |  44  | body, heading, list-item, blockquote, table-cell | "Help \| Advanced Search" |
| MDN      | 196  | body, heading, list-item, table-cell           | "Skip to main content" |
| 掘金     |   2  | list-item                                       | "首页 沸点 课程..." |

- ✅ 全部 5 站解析不崩
- ✅ 全部 5 站角色覆盖 ≥ 1 种
- ✅ 0 段 script/style 泄漏
- ✅ 0 段空段
- ✅ 超长段占比 < 5%

## 端到端 pipeline 实测（MDN 真实内容）

```bash
SRC = "The Promise object represents the eventual completion
       (or failure) of an asynchronous operation and its resulting value."

DeepL → TGT = "Promise 对象表示异步操作最终的完成（或失败）及其返回的值。"

LaBSE /align → 32 对齐对，关键映射：
  Promise        → Promise         ✓ 品牌名保留 + 正确对齐
  object         → 对象
  represents     → 表示
  eventual       → 最终
  completion     → 完成
  failure        → 失败
  asynchronous   → 异步（split 成 as/##ync/##hronous 三个 sub-token）
  operation      → 操作
  resulting      → 返回的
  value          → 值
```

延迟：LaBSE 对齐 116ms / 段。首屏翻译完一段即可触发对齐。

## 发现的真问题（W2 待修）

### 1. LaBSE WordPiece 子词碎片化

LaBSE 对英文用 WordPiece，遇到长词拆成 `as / ##ync / ##hronous`，
hover 时 1 个英文词对应 3 个 span，体验割裂。

**修法**：在 server/labse_server.mjs 的 `decodeTokenIds` 后合并连续 `##`-前缀 token；
或换用 MarianMT / NLLB tokenizer（已在 Phase 5/6 验证可统一 tokenization）。

### 2. Playwright MV3 SW attach 失败

Chrome 149 + Playwright 1.4x 在本机无法稳定 attach MV3 service worker
（30s 内不触发 `serviceworkerattached` 事件）。W1-5 e2e 改用 chrome.* mock
集成测试替代真浏览器 hover 截图。W2 起需排查：
- Playwright Chromium 版本与 Chrome 149 兼容性
- 备选：用 puppeteer-core + chrome-launcher

### 3. 掘金反爬只给导航 HTML

不是扩展问题，但说明 SPA 类站点首屏 SSR 渲染对 dom-walker 不友好。
scheduler 已有 MutationObserver 跟进 SPA 路由变化（content.ts observeSpa），
W2 跑真实加载时验证。

## 验证

```bash
$ cd extension && npx vitest run test/unit/site-matrix.test.ts
  Test Files  1 passed (1)
  Tests       10 passed (10)
  Duration    6.49s
```
