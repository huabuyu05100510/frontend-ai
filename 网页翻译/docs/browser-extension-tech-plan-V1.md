# 网页翻译插件（Browser Extension）— 技术方案 V1

> **模型声明**：Claude Sonnet 4.6 (`claude-sonnet-4-6`)，2026-06-22
> **范围**：仅网页翻译 Chrome/Firefox 浏览器插件

---

## 一、产品定义

对标 **沉浸式翻译 / Google Translate Extension**，核心体验：

- 一键翻译当前页面（快捷键 `Alt+T`）
- **双语模式**：原文保留，译文紧随其后（段落下方）
- **译文模式**：直接替换原文
- **划词翻译**：选中文字，气泡弹出译文
- 视口优先：先翻译可见区域，滚动时继续翻译
- 支持 SPA 动态内容（MutationObserver）

---

## 二、架构总览

```
┌─────────────────────────────────────────────────────┐
│                   Browser Extension                  │
│                                                      │
│  ┌──────────────┐   ┌──────────────────────────────┐ │
│  │   Popup UI   │   │       Content Script          │ │
│  │  (React 18)  │   │  ┌──────────────────────────┐│ │
│  │              │   │  │   DOM Walker              ││ │
│  │ · 语言选择   │   │  │   Segment Extractor       ││ │
│  │ · 模式切换   │   │  │   Translation Injector    ││ │
│  │ · 页面统计   │   │  │   MutationObserver        ││ │
│  └──────┬───────┘   │  │   IntersectionObserver    ││ │
│         │           │  └──────────────────────────┘│ │
│         │  chrome   │  ┌──────────────────────────┐│ │
│         │  .storage │  │   Selection Handler       ││ │
│         │           │  │  (划词翻译气泡)            ││ │
│  ┌──────▼───────┐   │  └──────────────────────────┘│ │
│  │  Background  │   └──────────────┬───────────────┘ │
│  │Service Worker│◄──────message────┘                  │
│  │              │                                      │
│  │ · API 代理   │──────► MiniMax LLM API (流式)        │
│  │ · 翻译缓存   │                                      │
│  │ · 批次合并   │                                      │
│  │ · 限流控制   │                                      │
│  └──────────────┘                                      │
└─────────────────────────────────────────────────────┘
```

---

## 三、Manifest V3 结构

```json
{
  "manifest_version": 3,
  "name": "智能翻译",
  "version": "1.0.0",
  "permissions": [
    "activeTab",
    "storage",
    "contextMenus"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "css": ["content.css"],
    "run_at": "document_idle"
  }],
  "action": {
    "default_popup": "popup.html",
    "default_icon": "icon.png"
  },
  "commands": {
    "toggle-translate": {
      "suggested_key": { "default": "Alt+T" },
      "description": "翻译/还原当前页面"
    }
  }
}
```

---

## 四、核心模块

### 4.1 DOM Walker — 文本提取

**原则**：只提取可见文本节点，跳过不可翻译内容。

```typescript
// content/dom-walker.ts
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'CODE', 'PRE',
  'KBD', 'SAMP', 'VAR', 'MATH', 'SVG', 'CANVAS'
])

interface Segment {
  id: string           // 唯一 ID，绑定 DOM 节点
  text: string         // 原文
  node: Text           // 原始 Text 节点引用
  blockEl: Element     // 所属块级元素（用于注入译文）
  type: 'block' | 'inline'
}

function extractSegments(root: Element = document.body): Segment[] {
  const segments: Segment[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement!
      // 跳过不可翻译标签
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
      // 跳过空白节点
      const text = node.textContent?.trim() ?? ''
      if (text.length < 2) return NodeFilter.FILTER_SKIP
      // 跳过纯数字/URL/邮箱
      if (/^[\d\s\W]+$/.test(text)) return NodeFilter.FILTER_SKIP
      return NodeFilter.FILTER_ACCEPT
    }
  })

  let node: Text | null
  while ((node = walker.nextNode() as Text)) {
    const blockEl = getBlockAncestor(node)
    segments.push({
      id: generateId(),
      text: node.textContent!.trim(),
      node,
      blockEl,
      type: isInlineContext(node) ? 'inline' : 'block'
    })
  }
  return mergeAdjacentInlineSegments(segments) // 合并同一行的 inline 片段
}
```

### 4.2 IntersectionObserver — 视口优先翻译

```typescript
// content/viewport-scheduler.ts
class ViewportScheduler {
  private observer: IntersectionObserver
  private queue: Segment[] = []
  private flushing = false

  constructor(private translate: (segs: Segment[]) => Promise<void>) {
    this.observer = new IntersectionObserver(
      entries => this.onIntersect(entries),
      { rootMargin: '200px 0px' }  // 提前 200px 预翻译
    )
  }

  schedule(segments: Segment[]) {
    for (const seg of segments) {
      seg.blockEl.setAttribute('data-xt-id', seg.id)
      this.observer.observe(seg.blockEl)
    }
  }

  private onIntersect(entries: IntersectionObserverEntry[]) {
    const visible = entries
      .filter(e => e.isIntersecting)
      .map(e => e.target.getAttribute('data-xt-id')!)
      .filter(Boolean)

    if (visible.length > 0) this.flush(visible)
  }

  private async flush(ids: string[]) {
    // 批次合并，8 段一组发给 Background
    const batches = chunk(ids, 8)
    for (const batch of batches) {
      chrome.runtime.sendMessage({ type: 'TRANSLATE', ids: batch })
    }
  }
}
```

### 4.3 Background Service Worker — API 代理 + 缓存

```typescript
// background/index.ts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TRANSLATE') {
    handleTranslate(msg, sender.tab!.id!).then(sendResponse)
    return true  // 异步响应
  }
})

async function handleTranslate(msg: TranslateMsg, tabId: number) {
  const { segments, srcLang, tgtLang } = msg

  // 1. 查缓存（chrome.storage.local，按 hash 存）
  const cached = await lookupCache(segments, srcLang, tgtLang)
  const needTranslate = segments.filter(s => !cached.has(s.id))

  // 2. 分批请求 MiniMax
  const results = await translateBatch(needTranslate, srcLang, tgtLang)

  // 3. 写缓存
  await writeCache(results, srcLang, tgtLang)

  // 4. 通知 Content Script 注入译文（流式推送）
  for (const chunk of results) {
    chrome.tabs.sendMessage(tabId, { type: 'INJECT_TRANSLATION', chunk })
  }
}

// MiniMax 流式调用
async function* callMiniMax(
  prompt: string,
  apiKey: string
): AsyncGenerator<string> {
  const resp = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'MiniMax-Text-01',
      stream: true,
      messages: [
        { role: 'system', content: TRANSLATE_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ]
    })
  })

  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  // 解析 SSE stream → yield delta tokens
  yield* parseSseStream(reader, decoder)
}
```

### 4.4 Translation Injector — 双语注入

**双语模式**：在原段落后插入译文节点，样式独立。

> **更新（2026-06-23，P0-3）**：wrapper tag 不再固定为 `<span>`，而是根据
> `seg.node.parentElement.tagName` 选择合法嵌套元素，避免浏览器对非法嵌套做
> mutation 修正导致 CLS 与布局破坏。规则：
> - `UL/OL` → `<li class="xt-translation xt-translation--li">`
> - `TR` → `<td class="xt-translation xt-translation--td">`
> - phrasing parent（`P/SPAN/A/EM/...`） → `<span class="xt-translation xt-translation--inline">`
> - 默认块容器 → `<div class="xt-translation xt-translation--block">`
> - `srcEl` 自身是 `THEAD/TBODY/TFOOT/TR` 或父为 `TABLE/THEAD/TBODY/TFOOT` 的极端情况：跳过并 warn
>
> 实现见 `content/injector.ts` 的 `chooseWrapper(srcEl)`。

```typescript
// content/injector.ts
function injectBilingual(seg: Segment, translation: string) {
  const container = seg.blockEl

  // 防止重复注入
  if (container.querySelector('.xt-translation')) return

  const wrapper = chooseWrapper(seg.node)  // ← 根据父容器选合法 tag
  if (!wrapper) return  // 已 warn

  const tgtEl = document.createElement(wrapper.tag)
  tgtEl.className = `xt-translation xt-translation--${wrapper.variant}`
  tgtEl.setAttribute('data-xt-src', seg.id)
  tgtEl.textContent = translation

  // 插入到原文节点之后（合法嵌套保证不触发浏览器 mutation 修正）
  seg.node.parentNode!.insertBefore(tgtEl, seg.node.nextSibling)

  // 流式更新：逐字追加
  // 通过 MutationObserver-free 方式直接操作 textContent
}

// 译文模式：直接替换 text node
function injectOverride(seg: Segment, translation: string) {
  seg.node.textContent = translation
  seg.node.parentElement!.setAttribute('data-xt-original', seg.text)
}
```

```css
/* content.css — 双语样式 */
.xt-translation {
  display: block;
  font-size: 0.9em;
  color: #1a73e8;          /* Google蓝，辨识度高 */
  line-height: 1.6;
  margin-top: 4px;
  padding: 2px 0;
  border-left: 2px solid #1a73e8;
  padding-left: 8px;
  opacity: 0;
  animation: xt-fade-in 0.3s ease forwards;
}

@keyframes xt-fade-in {
  to { opacity: 1; }
}

/* 流式写入时的打字机光标 */
.xt-translation.xt-streaming::after {
  content: '▋';
  animation: xt-blink 0.6s step-end infinite;
}

@keyframes xt-blink {
  50% { opacity: 0; }
}
```

### 4.5 划词翻译

```typescript
// content/selection-handler.ts
let bubble: HTMLElement | null = null

document.addEventListener('mouseup', debounce(async (e: MouseEvent) => {
  const selection = window.getSelection()
  const text = selection?.toString().trim()

  if (!text || text.length < 2 || text.length > 500) {
    removeBubble()
    return
  }

  const range = selection!.getRangeAt(0)
  const rect = range.getBoundingClientRect()

  showBubble({
    x: rect.left + rect.width / 2,
    y: rect.top + window.scrollY - 8,
    text,
    loading: true
  })

  const result = await chrome.runtime.sendMessage({
    type: 'TRANSLATE_SELECTION',
    text
  })

  updateBubble(result.translation)
}, 300))
```

### 4.6 MutationObserver — 支持 SPA

```typescript
// content/spa-observer.ts
const mo = new MutationObserver(mutations => {
  const newNodes: Element[] = []

  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        newNodes.push(node as Element)
      }
    }
  }

  if (newNodes.length === 0) return

  // 仅处理新增节点，避免全量重扫
  const newSegments = newNodes.flatMap(el => extractSegments(el))
  if (newSegments.length > 0 && translationState.isActive) {
    viewportScheduler.schedule(newSegments)
  }
})

mo.observe(document.body, {
  childList: true,
  subtree: true
})
```

---

## 五、Popup UI

```
┌─────────────────────────────┐
│  🌐 智能翻译                 │
├─────────────────────────────┤
│  中文  ⇄  英文              │
│  [自动检测]   [English  ▼]  │
├─────────────────────────────┤
│  ● 双语对照   ○ 仅译文        │
├─────────────────────────────┤
│  [    翻译此页面    ]         │
│  [    还原原文      ]         │
├─────────────────────────────┤
│  已翻译 128 段 · 耗时 2.3s   │
└─────────────────────────────┘
```

Popup 与 Content Script 通过 `chrome.tabs.sendMessage` 通信，状态持久化到 `chrome.storage.sync`。

---

## 六、翻译 Prompt 工程

```typescript
const TRANSLATE_SYSTEM_PROMPT = `
你是专业翻译引擎。规则：
1. 仅输出译文，不解释、不加前缀
2. 保留原文格式：换行、缩进、标点风格
3. 专有名词、代码、URL 不翻译
4. 多段输入用 <SEP> 分隔，输出同样用 <SEP> 分隔
5. 保持语气与原文一致（正式/口语）
`

// 批次输入格式（8段合一请求）
function buildPrompt(segments: Segment[], tgtLang: string): string {
  const texts = segments.map(s => s.text).join('\n<SEP>\n')
  return `将以下内容翻译成${tgtLang}：\n\n${texts}`
}
```

---

## 七、性能指标

| 指标 | 目标 | 实现手段 |
|------|------|---------|
| 首屏段落翻译延迟 | <1.5s | 视口优先 + 并发 4 请求 |
| 流式首字节 (TTFB) | <800ms | SSE 流式，后端不等全部完成 |
| 页面注入 CLS | <0.02 | 预占位 `min-height` + 渐入动画 |
| 内存占用 | <30MB | Text节点操作，不克隆DOM |
| 翻译缓存命中率 | >60% | chrome.storage.local，按域名+hash |

---

## 八、工程化 & 构建

```
browser-extension/
├── manifest.json
├── src/
│   ├── background/
│   │   ├── index.ts          # Service Worker 入口
│   │   ├── translator.ts     # MiniMax API 调用
│   │   └── cache.ts          # 翻译缓存（chrome.storage）
│   ├── content/
│   │   ├── index.ts          # Content Script 入口
│   │   ├── dom-walker.ts     # 文本提取
│   │   ├── viewport-scheduler.ts  # 视口调度
│   │   ├── injector.ts       # 双语注入
│   │   ├── selection-handler.ts   # 划词翻译
│   │   └── spa-observer.ts   # SPA 动态内容
│   ├── popup/
│   │   ├── App.tsx           # Popup React UI
│   │   └── popup.html
│   └── shared/
│       ├── types.ts
│       └── constants.ts
├── vite.config.ts            # CRXJS 插件（MV3 热更新）
└── test/
    ├── unit/                 # Vitest
    └── e2e/                  # Playwright + extension fixture
```

**构建工具**：`Vite + @crxjs/vite-plugin`（MV3 最佳 DX，支持 HMR）

---

## 九、TDD 测试策略

```
单元测试（Vitest）
  ├── dom-walker: 提取准确性、跳过规则、inline合并
  ├── injector: 双语注入不破坏原文、流式更新、还原
  ├── translator: Prompt构造、SEP分隔解析、缓存命中
  └── selection-handler: 防抖、边界条件（纯数字/代码）

E2E（Playwright + Chrome Extension）
  ├── 加载插件 → 访问英文页面 → Alt+T → 双语出现
  ├── 模式切换：双语 → 译文 → 还原
  ├── 划词翻译气泡出现 + 正确译文
  ├── SPA页面（React/Vue路由切换）新内容自动翻译
  └── 离线/API失败降级提示

UI 回归
  └── 双语注入前后截图对比，CLS 验证
```

---

## 十、分阶段交付

| 阶段 | 内容 | 验收 |
|------|------|------|
| **M1** | DOM提取 + Background API代理 + 最简双语注入 | 静态页面翻译跑通 |
| **M2** | 视口调度 + 流式渐显 + Popup UI | 长页面体验流畅 |
| **M3** | 划词翻译 + SPA支持 + 翻译缓存 | 主流 SPA 兼容 |
| **M4** | 性能调优 + CLS优化 + Firefox适配 | Lighthouse ≥90 |
| **M5** | 标注功能扩展接口预留 | 可叠加标注层 |
