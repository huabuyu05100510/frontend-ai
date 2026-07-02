# 变更记录 — 翻译不完整 bug 修复

> **日期**：2026-06-22
> **模型**：MiniMax-M3
> **类型**：Bug Fix
> **影响范围**：`server.mjs` / `demo.html` / 新增 `lib/translate.mjs` / 新增 3 个测试文件

## 现象

「翻译下方文本」模式下，粘多段英文进去，UI 只看到 1 段被翻译（或最多 20 段），其余空白。

## 根因（两个，互相叠加）

1. **`demo.html:82` 用 `<input>` 而不是 `<textarea>`**
   `<input>` 不支持多行，换行被吞，再 `split('\n')` 只剩 1 段。
2. **`demo.html:204` 写死 `.slice(0, 20)`**
   即便用户绕过 input 限制（比如扩展直接调 API），超过 20 段也只译前 20。
3. **`server.mjs` 单次把全部段落塞给 LLM**
   超过 token 上限会 502 整体失败。

UI 回归测试一跑就暴露：粘 25 段进去，原文显示 1 段。

## 修复

### 1. 客户端 — `demo.html`

- `<input id="textInput">` → `<textarea rows="6" id="textInput">`，加 `.text-input` 类样式（等宽字体、可纵向 resize）
- 去掉 `.slice(0, 20)`
- 两个翻译 handler（URL loader / 文本输入）状态栏统一显示：
  - 工作：`⏳ 翻译 50 段（3 批，服务端自动分块）...`
  - 完成：`✅ 完成 25/25 段`
  - 部分失败：`⚠️ 完成 23/25 段，2 段失败`

### 2. 服务端分块并行 — `lib/translate.mjs`（新）+ `server.mjs`

- 抽 `chunk(arr, size)` 和 `translateBatches(segments, tgtLang, callApi)` 两个纯函数
- `BATCH_SIZE = 20`：单批 ≤20 段，远低于 MiniMax 单次推荐 token 上限
- `Promise.allSettled` 并行：单批失败不影响其他批
- 输出数组严格保序：`out[i]` 一定是第 i 段的译文
- 失败段填空字符串，前端可识别
- 结构化日志：`分 N 批 / 批 X/Y ✅|❌ / 汇总 ok=X/Y`

### 3. 安全/健壮性 — `server.mjs`

- API key 从环境变量读 `MINIMAX_KEY`，源码仍有 fallback（保持向后兼容）
- API 地址可由 `MINIMAX_API` 覆盖（e2e 测试用）
- 端口可由 `PORT` 覆盖
- `segments.length > 500` → 413（防恶意大请求）
- 空数组 / 非法 JSON → 400

### 4. 测试 — `test/`（新目录）

`test/translate.test.mjs`（node:test 单元测试，9 case）
`test/server.e2e.test.mjs`（node:test 端到端，7 case）
`test/ui.e2e.test.mjs`（playwright UI 回归，3 case + 3 张截图）

启动方式：
```bash
node server.mjs &
node --test test/translate.test.mjs test/server.e2e.test.mjs test/ui.e2e.test.mjs
```

## 验证

```
# tests 19
# pass 19
# fail 0
```

UI 截图：`test/shots/01-initial.png` `02-after-translate.png` `03-english.png`

## 后续

- 服务端目前没有 SSE 流式；大批页面 UX 是「等几秒后一次性出现」，未来可改为逐批 flush
- 没改浏览器扩展（`extension/src/content/scheduler.ts` 已有 8 段/2000 字符的分批，无此 bug）
- API key 仍在源码 fallback；正式部署前应改强制从环境变量读，移除 fallback