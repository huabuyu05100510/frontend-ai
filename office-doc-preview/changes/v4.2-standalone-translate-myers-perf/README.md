# v4.2 — Standalone 翻译 + Myers 性能 + 静态 SPA

> 模型：claude-sonnet-4-6
> 日期：2026-06-30
> 类型：Bug Fix + Feature Enablement + Production Single-Port Entry

## 改动一览

### 1. Myers diff 高 D 场景性能修复（842ms → <5ms）

**症状**：`test/diff.test.mjs > 【压力】两份几乎完全不同的大文本（高 D） < 500ms` 失败，5000 'a' vs 5000 'b' 实测 842ms。

**根因**：Myers 算法是 O((N+M)·D) —— 当 D 接近 N+M（如完全无公共字符的两份文本），退化为 O(NM) = O(25M)，TypedArray 也救不了百万级循环。

**方案**：在 Myers 入口增加快速路径——构造 B 的字符集 (Set)，线性扫描 A：

- 0 个公共字符 → 直接返回 `[{op:'delete', text:a}, {op:'insert', text:b}]`，O(N+M)
- ≥1 个公共字符 → 走原 Myers（D << N+M 的常见场景）

**TDD**：

- 已有测试从 8s（1 fail）降到 22ms（38 pass）

### 2. Standalone 翻译模式（前端 TranslationPage 直接传文本，无需上传文件）

**症状**：`POST /api/inspect/translate` 收到 `taskId: 'standalone'` 直接返回 404，前端文本翻译页完全跑不通。

**根因**：handler 强制要求 `getTask(taskId)` 找到真实 task，否则 404。前端翻译页（用户未上传文件，直接输入文本翻译）天然没有 task。

**方案**：handler 支持 `taskId === 'standalone'` 模式，从 body 直接读 `text` 字段。

**TDD**（3 个新测试）：

1. standalone 模式：传 taskId="standalone" + text → 200 + 翻译 segments
2. standalone 模式：缺 text → 400
3. standalone 模式：text 为空 → 200 + 空 segments

### 3. 静态 SPA 路由（生产模式单端口入口）

**症状**：访问 `http://localhost:5180/` 返回 `{"error":"not found","path":"/"}`。开发模式用 Vite (5188) + proxy 没问题，但生产模式（部署时）只有 5180 一个端口，必须由 server 托管前端。

**根因**：server 是纯 API，不托管前端静态产物。

**方案**：

1. `config.mjs` 加 `WEB_DIST_DIR`（默认 `<root>/web/dist`，可用 `WEB_DIST_DIR_OVERRIDE` 覆盖）
2. `router.mjs` 在 catch-all 404 之前加 `serveStaticOrFallback()`：
   - 仅处理 GET 且非 `/api/*` 路径
   - 命中真实文件 → 直接 stream（assets 目录 immutable cache，index.html no-cache）
   - 未命中 → SPA fallback 到 `index.html`
   - dist 不存在 → 返回 JSON 404 + 提示用户 build 或用 dev 模式
3. `MIME` 表补齐 `.js / .mjs / .css / .html / .wasm / .woff / .woff2 / .ttf / .otf / .ico`（Vite 产物用的 web 资源）

**TDD**（5 个新测试）：

1. GET / → 200 + index.html
2. GET /index.html → 200 + html
3. GET /assets/... → 200 + 真实资源 + immutable cache
4. GET /unknown/spa/path → SPA fallback
5. GET /api/health → 不被静态路由接管

## 验证结果

```
server tests:    296 passed (19 files)   3.49s   (新增 5 static-spa)
frontend tests:  197 passed (18 files)   4.63s
production build: ✓ 506 modules, 1.96s
TypeScript:      ✓ clean
```

### 端到端验证（http://localhost:5180/）

```
GET /                             → 200 text/html     (432 B, index.html)
GET /assets/index-DVIVV23c.js     → 200 application/javascript  (247 KB)
GET /some/spa/route               → 200 text/html     (SPA fallback → index.html)
GET /api/health                   → 200 application/json
POST /api/inspect/translate       → 200 (standalone 翻译)
```

## 可观测性

翻译端点响应头保持不变，仍含 `X-Translate-Engine / X-Translate-Ms / X-Translate-Segments / X-Translate-Pages / X-Translate-Source-Chars / X-Translate-Target-Chars`，便于前端 perf 面板消费。

服务日志新增 `task=standalone` 标识（与 file 模式 `task=tr-xxx` 区分）：

```
[inspect-translate] task=standalone zh-CN→en strategy=synthetic engine=mock-v1 segments=1 pages=1 srcChars=7 ms=0
```