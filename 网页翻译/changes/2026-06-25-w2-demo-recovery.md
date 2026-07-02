# 2026-06-25 W2 demo 可用性修复

> **模型**：Claude (Sonnet 4.5)

## 问题

用户反馈："网页翻译功能还是不可用 还是bug很多"。实测三条主路径：

| 路径 | 现象 | 根因 |
|------|------|------|
| 加载 URL 翻译 | ❌ CORS + allorigins 500 | 浏览器直连被 CORS 拦截，第三方外部代理 500 不可靠 |
| 主翻译后端 | ⚠️ 仍用 MiniMax | W1-3 只切了扩展，server.mjs 没同步 |
| viewer 布局 | ❌ 渲染破损 | CSS grid 双栏，HTML 实际是 `.pane` 堆叠，两者不匹配 |
| 段落提取 | ❌ HN 30 条新闻被塞进 1 段 | extractSegments 命中 BLOCK 容器就 return，不查内部嵌套 BLOCK |
| 保结构翻译按钮 | ❌ 首点无反应 | 输入空时只填默认值不翻译，但状态被覆盖看不出来 |

## 修复

### 1. `lib/fetch-url.mjs`（新）—— 服务端 URL 代理

绕开浏览器 CORS，在服务端拉目标页 HTML：
- 协议白名单：只允许 http/https
- SSRF 防护：DNS 解析后检查所有 IP，拒绝私网/回环/链路本地（127/10/172.16/192.168/169.254/::1/fc/fd/fe）
- 大小上限：默认 5MB，超则中止 reader
- 超时：默认 10s，abort 后构造 `code=TIMEOUT` 的 error
- 可观测：`fetch.start/done/failed` 结构化日志
- 可注入 `assertPublic`（测试用），生产默认走 `assertPublicHost`

测试：`test/fetch-url.test.mjs` 8/8 通过（200 / 404 / TOO_LARGE / TIMEOUT / SSRF / 协议白名单 / 无效 URL）

### 2. `/api/fetch` 端点（server.mjs）

POST { url } → { url, html, contentType, status }，HTTP 错误透传合适 status code。

### 3. `lib/deepl.mjs`（新）—— DeepL 翻译客户端

与 W1-3 扩展的 `extension/src/background/deepl.ts` 对齐：
- Free/Pro endpoint 自动选（key 后缀 `:fx` → free）
- LANG_MAP：中文 → ZH / English → EN-US / 日本語 → JA
- 429/456 指数退避重试（max 3）
- 不足段数补空字符串
- `tag_handling=html` + `ignore_tags=code,pre,kbd,samp`

测试：`test/deepl.test.mjs` 6/6 通过（端点选择 / 语言映射 / 200 / 重试 / 403 不重试 / 段数补齐）

### 4. `/api/translate` 切 DeepL

- 删除 `callMinimax`（原 MiniMax 普通 batch 路径）+ `SYS_PROMPT`
- 删除硬编码 leak 的 `DEFAULT_KEY`
- `/api/translate` 改用 `callDeepL`，每 50 段/批 `Promise.allSettled`，逐批 `translate.batch_ok/fail` 日志
- `/api/translate-aligned` 保留 MiniMax（占位符 prompt 仍需 LLM 配合）

实测：3 段 "Hello world / The quick brown fox / React Hooks are great" → DeepL 1.1s 完成，"React Hooks" 术语保留正确

### 5. demo.html 布局 + 交互修复

- `.viewer` HTML 改用 `.viewer-header` + `#rows`，与 grid CSS 对齐
- 新增 `renderRows(segments, translations)` 双栏渲染（原文左、译文右）
- 新增 `setAlignedPanels(srcHtml, tgtHtml)`，保结构翻译结果填入同一双栏
- URL 加载改走 `/api/fetch`，删除不可靠的 allorigins.win 代理
- 保结构翻译按钮：输入空时填示例 + 聚焦，再次点击才翻译（避免"按钮点了没反应"）

### 6. `extractSegments` 容器嵌套修复

旧逻辑：命中 BLOCK（含 TD/TH）就 push + return，导致 HN 的 `<td>`（内含整列 30 条新闻）被算成 1 段。

新逻辑：
- 加 `LEAF_BLOCK`（P/H*/LI/BLOCKQUOTE/FIGCAPTION/DT/DD）= 不可再分
- BLOCK 元素若非 LEAF 且子树含 BLOCK → 继续递归到子 BLOCK
- BLOCK 集合加 DIV/SECTION/ARTICLE/TD/TH（容器型）

实测 HN 主页：旧 3 段（其中 1 段是 30 条新闻拼成的 mega-string）→ 新 **63 段**（每条标题独立）。

## 验证

```
test/fetch-url.test.mjs    8/8 ✅
test/deepl.test.mjs        6/6 ✅
npm run test:unit        126/126 ✅  （原 lib 测试无回归）
test/w2-recovery.e2e.mjs  3/3 ✅     （真实 server + playwright）
```

e2e 三路径：
1. 文本翻译 3/3 段（DeepL 1.1s）
2. HN URL 抓取+翻译 63/63 段（fetch 0.8s + DeepL 1.4s）
3. 保结构翻译 spans=3 ✅

截图：`test/shots/w2-text.png` / `w2-url.png` / `w2-aligned.png`

## 可观测性

server.mjs 新增日志事件：
- `fetch.request` / `fetch.start` / `fetch.ok` / `fetch.fail`（含 bytes/costMs/code）
- `translate.start` 增加 `backend:'deepl'` `target:'ZH'` 字段
- `translate.batch_ok` / `translate.batch_fail`（per-batch 进度）
- `translate.done` 增加 `failed` 字段

## 已知遗留

1. **hover 词级对齐 UI 仍未接入 demo**（W1-5 的 LaBSE pipeline 在扩展里，demo web 没接）→ W2-2 入口
2. extractSegments 加了 DIV 可能在某些站点过度拆分（需 W2 fixture 扩展覆盖）
3. UTF-8 强制解码，遇到 GBK 站点会乱码（罕见）
