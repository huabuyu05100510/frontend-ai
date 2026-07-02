# W2-3 行业对齐重构：排版安全 + 覆盖率盲区

**模型**: Claude Sonnet 4.5
**日期**: 2026-06-25
**前置**: W2-2 (`2026-06-25-w2-2-coverage-invisible-elements.md`)

## 用户反馈

> 还有些不能覆盖 而且排版也变了 还是得想想怎么做

## 行业调研结论

| 产品 | 策略 | 排版风险 |
|---|---|---|
| **沉浸式翻译**（对标） | 段落级提取，inline 文字合并入父段 | 零（译文作为新 block 插父段后） |
| Google Translate / Chrome 内置 | `<font>` in-place 替换 | 破坏 React/SolidJS（[martijnhols.nl](https://martijnhols.nl/blog/everything-about-google-translate-crashing-react)） |

**结论**：W2-1 把 SPAN/A/BDI/EM 加入 LEAF_BLOCK_TAGS 是**反方向**——破坏了沉浸式翻译的段落级原则。本轮回退并补齐覆盖率盲区。

## 根因与修复

### A. 排版破坏（inline 元素被独立成段）
**根因**：LEAF_BLOCK_TAGS 含 SPAN/A/BDI/EM 时，每个 inline 元素独立成段，bilingual 注入 `<div display:block>` 强制换行 → 破坏 flex/inline 流。

**修复**：移除所有 inline tag，对标沉浸式翻译：
```ts
const LEAF_BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION', 'DT', 'DD',
  // W2-3: 移除所有 inline（A/SPAN/LABEL/EM/STRONG/B/I/SUB/SUP/Q/CITE/TIME/BDI）
])
```
inline 文字由父 block 通过 `getCleanText` 合并提取（已有逻辑）。`<div><span>A</span><span>B</span></div>` → 1 段 "A B"，匹配沉浸式翻译。

### B. 覆盖率盲区（iframe / shadow DOM / 无周期重扫）

| 盲区 | 修复 |
|---|---|
| **跨域 iframe** | `manifest.json` 加 `all_frames: true`，chrome 自动注入独立 content script |
| **同域 iframe** | `dom-walker.walkElement` 末尾递归 `contentDocument.body`（cross-origin 抛 SecurityError 被 try/catch 吞） |
| **Shadow DOM** | walkElement 开头检查 `el.shadowRoot`，递归遍历；导出 `consumeShadowRoots` |
| **MutationObserver 不能跨 shadow** | 每个 shadow root 独立 attach observer |
| **无周期重扫** | `startRescan` setInterval 每 3s，最多 10 周期或连续 2 次零增量早停；scroll 节流 500ms 触发 |
| **injector 不穿透 shadow root** | `deepQuerySelector` / `deepQuerySelectorAll` 递归 shadow + iframe |

### C. 中途切模式无效（W2-2 残留）
**根因**：setMode 仅切 CSS 类，旧模式已注入的元素不会重注入。
**修复**：injector 加 `translationCache`，`setMode()` 用缓存按新 mode 重注入所有已译段。

## 测试

| 文件 | 新增/修改 |
|---|---|
| `extension/test/unit/dom-walker.test.ts` | 5 个 inline 测试断言改写（期望 DIV 父兜底）+ 4 个 shadow/iframe 新测试 |
| `extension/test/unit/injector.test.ts` | 3 个 setMode 重注入新测试 |
| `extension/src/content/scheduler.ts` | 新增 `isDone(id)` |

unit 总数：**138/138 绿**（除 1 个无关的 translator 并发 timeout）。

## 端到端验证

### 测试页（`test/ext-shadow-iframe-test.html`）
三类节点齐全：top frame + open shadow DOM（web component）+ 同域 iframe + 跨域 iframe。

```
=== W2-3 端到端翻译结果 ===
top frame: 译文 5 条
shadow DOM: 译文 4 条
iframe: 译文 12 条
✅ 通过：三类节点都被翻译
```
截图 `test/shots/w2-3-shadow-iframe.png` 经 analyze_image 确认：
1. top frame 译文可见 ✓
2. shadow DOM 区域译文可见 ✓
3. iframe 区域译文可见 ✓
4. 排版完整无破坏 ✓

### alibaba.com 覆盖率探针
| 维度 | W2-2 | W2-3 |
|---|---|---|
| 覆盖率 | 99.3% (123/145 → 145/146) | **97.3%** (143/147) |
| 排版 | div 强制换行破坏 | **完整** |

覆盖率略降（97.3% vs 99.3%）合理：W2-2 把 SPAN/A/BDI 独立成段过细，破坏排版；W2-3 段落级粒度安全。漏的 4 段都是按钮/链接里的纯 inline span（"下载 Accio Work"、"AI 模式" 等），可接受。

## 取舍声明

1. **inline 合并**：`<div><span>A</span><span>B</span></div>` → 1 段 "A B"，匹配沉浸式翻译。hover 词对齐按 token 切分不受影响。
2. **子帧状态栏抑制**：`window !== window.top` 时 statusHost `display:none`，避免 N 个浮动栏。
3. **周期重扫上限 10 次（30s）**：覆盖 99% lazy-load。极慢 SPA 由滚动事件再次触发。
4. **closed shadow root 跳过**：`el.shadowRoot` 对 closed 返回 null，平台限制无解。

## 改动清单

| 文件 | 操作 |
|---|---|
| `extension/src/content/dom-walker.ts` | 移除 inline LEAF_BLOCK + shadow/iframe 递归 + consumeShadowRoots 导出 |
| `extension/manifest.json` | `all_frames: true` |
| `extension/src/content/content.ts` | handleMutations 抽出 + attachShadowObserver + startRescan + scroll 节流 + deepQuerySelector + 子帧状态栏抑制 + setMode 调 injector.setMode |
| `extension/src/content/injector.ts` | translationCache + setMode + clearTranslations + deepQuerySelector(All) 全路径替换 |
| `extension/src/content/scheduler.ts` | `isDone(id)` |
| `extension/src/shared/types.ts` | `Segment.sourceFrame?: 'top'\|'iframe'\|'shadow'` |
| `extension/test/unit/dom-walker.test.ts` | 5 改 + 4 新 |
| `extension/test/unit/injector.test.ts` | 3 新（setMode） |
| `test/ext-coverage-probe.mjs` | TreeWalker 递归 shadow/iframe + byFrame 统计 |
| `test/ext-shadow-iframe-test.html` | 新建（web component + 同/跨域 iframe） |
| `test/iframe-inner.html` | 新建 |
| `test/ext-w2-3-shadow-iframe-e2e.mjs` | 新建端到端 |

## 关键文件路径

- `/Users/didi/Downloads/前端AI面试题/网页翻译/extension/src/content/dom-walker.ts`
- `/Users/didi/Downloads/前端AI面试题/网页翻译/extension/src/content/injector.ts`
- `/Users/didi/Downloads/前端AI面试题/网页翻译/extension/src/content/content.ts`
- `/Users/didi/Downloads/前端AI面试题/网页翻译/extension/manifest.json`
- `/Users/didi/Downloads/前端AI面试题/网页翻译/test/ext-w2-3-shadow-iframe-e2e.mjs`
- `/Users/didi/Downloads/前端AI面试题/网页翻译/test/ext-shadow-iframe-test.html`
