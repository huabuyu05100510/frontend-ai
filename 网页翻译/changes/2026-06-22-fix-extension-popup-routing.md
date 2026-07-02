# 变更记录 — 修复 popup 消息路由 bug（插件完全失效）

> **日期**：2026-06-22
> **模型**：MiniMax-M3
> **类型**：bug fix
> **影响范围**：`extension/src/popup/App.tsx` + 新增 `popup-tab-pick.test.ts` + `popup-message-routing.e2e.mjs`

## 现象

用户报告"插件完全没有生效"：
- 安装扩展 ✓
- 点击扩展图标 ✓（popup 能打开）
- 点击 "翻译此页面" → 页面没有任何反应
- 浮层一直停留在 "🌐 翻译扩展已注入点扩展图标开始翻译"

## 根因

`extension/src/popup/App.tsx` 里 `sendToContent` 用了错误的 query：

```js
// ❌ 错的
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
```

**Chrome 文档明确警告**：从 popup 里查 "用户正在浏览的 tab" 时，`currentWindow: true` 指的是 popup 自己的窗口，永远拿到 popup 自己。`lastFocusedWindow: true` 也类似——popup 本身就是 last-focused 的 active tab。

诊断过程（CDP + 多 tab 列表）确认：

```
[t] 加载 example.com 后所有 tabs:
  id=678842464 active=false win=678842463 url=undefined       ← SW
  id=678842465 active=true  win=678842463 url=https://example.com/   ← 用户页
[t] popup 查到的 (lastFocusedWindow / currentWindow):
  → 都返回 id=678842466 url=undefined  ← popup 自己！
[t] 手动拿 example.com id 发消息: ok=true  resp=完整 state
```

→ content script **完全正常**（监听器已注册，`chrome.runtime.id` 可读），纯粹是 popup 找不到用户 tab，所以 `sendMessage` 报 "Could not establish connection. Receiving end does not exist."

## 修复

`extension/src/popup/App.tsx`：抽出纯函数 `pickTargetTab(tabs, selfTabId)`，用「列出所有 tab → 排除 popup 自己 + 排除扩展/chrome/about 页 → 优先 active 否则兜底」。

```js
export function pickTargetTab(tabs, selfTabId) {
  const isUsable = (t) =>
    t.id !== undefined &&
    t.id !== selfTabId &&
    !!t.url &&
    !t.url.startsWith('chrome-extension://') &&
    !t.url.startsWith('chrome://') &&
    !t.url.startsWith('about:')
  return tabs.find(t => t.active && isUsable(t)) ?? tabs.find(t => isUsable(t))
}
```

## 验证

| 测试 | 结果 |
|---|---|
| `test/unit/popup-tab-pick.test.ts`（8 case） | ✅ 8/8 |
| `test/e2e/popup-message-routing.e2e.mjs`（popup→LLM→DOM 全链路） | ✅ example.com 3 段全部翻成中文 |

端到端日志：

```
[xt:content] message TRANSLATE
[xt:content] 开始翻译 auto→zh 模式:bilingual
[xt:content] 提取到 3 个 segment
[xt:scheduler] flush 3 段 pending=3 scheduled=1
[xt:content] message TRANSLATION_CHUNK   ← background 回传
[xt:content] 完成 3/3 (xt-3-dnn7 full=4字)
overlay: ✅ 翻译完成 3 段 | firstTgt: '示例域名'
```

## 顺手补的

1. `sendToContent` 失败时 `console.warn` 错误细节（之前 `.catch(() => null)` 吞掉）
2. `chrome.tabs.getCurrent()` 拿 popup 自己的 tabId 用于排除
3. 纯函数 `pickTargetTab` 抽出来好单测

## 简历素材

> 排查 Chrome 扩展 popup 路由失败时，定位到 `chrome.tabs.query({ active: true, currentWindow: true })` 在 popup 上下文会返回 popup 自身——这是 Chrome 文档明确警告但社区极易踩的坑。重构为「列出所有 tab + 排除 popup/扩展页」策略，并抽出纯函数 + 8 个 case 单测覆盖边界（chrome://、about:blank、无 url、多普通页等），e2e 验证 popup → content → background → LLM → DOM 全链路首次跑通。

## 相关坑（写入 MEMORY）

- popup 里 `chrome.tabs.query({ active: true, currentWindow: true })` 永远拿到 popup 自己
- popup 里 `chrome.tabs.query({ active: true, lastFocusedWindow: true })` 也可能拿到 popup（如果 popup 是 last focused 的 active tab）
- 正确做法：`chrome.tabs.query({})` 列全部，过滤掉 `selfTabId` + `chrome-extension://` + `chrome://` + `about:`
- playwright 默认 headless chrome 拒绝 `--load-extension`，必须用 chromium 通道
- 诊断时切忌用 `page.evaluate(() => typeof chrome.runtime)` —— 这跑在 MAIN world，对所有扩展都是 undefined；要从 CDP 的 isolated context 或 DOM marker 观察