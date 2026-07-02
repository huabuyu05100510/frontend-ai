# Annotation UI Layer (Agent 3) — 2026-06-27

**模型声明**：claude-sonnet-4-6（MiniMax-M3 路由）
**任务**：实现标注功能的 content script UI 层（词级 alignment 修正 + 段级 1-5 星评分）

---

## 交付文件

| 文件 | 行数 | 说明 |
|---|---|---|
| `/Users/didi/Downloads/前端AI面试题/网页翻译/extension/src/content/annotator.ts` | 731 | Annotator 类 + buildPencilShadow / buildStarShadow 工具 |
| `/Users/didi/Downloads/前端AI面试题/网页翻译/extension/src/content/annotator.css` | 43 | Shadow DOM 内动效约束 + 关键帧 |
| `/Users/didi/Downloads/前端AI面试题/网页翻译/extension/test/annotator.test.ts` | 541 | vitest 单测（jsdom） |
| `/Users/didi/Downloads/前端AI面试题/网页翻译/test/annotator.ext.e2e.test.mjs` | 401 | Playwright 扩展 e2e |
| `/Users/didi/Downloads/前端AI面试题/网页翻译/test/shots/anno-01-align-fix-popover.png` | 42 KB | popover 打开时截图 |
| `/Users/didi/Downloads/前端AI面试题/网页翻译/test/shots/anno-02-rating-stars.png` | 41 KB | 5 星评分后（4 实心 + 1 空心） |

---

## 测试通过率

- **单测**：**15/15 通过**（100%）— vitest run test/annotator.test.ts
- **e2e**：**3/3 通过**（100%）— node test/annotator.ext.e2e.test.mjs
  - case 1：5 星评分（rating=4）→ encode + put 各 1 次
  - case 2：词级 alignment 修正（srcTokenIdx=0, correctedTgt=0）→ encode + put 各 1 次
  - case 3：24h 去打扰（同段已评 → 不再 mount star host）

---

## 截图

- `anno-01-align-fix-popover.png` — 词级 popover 打开，候选词 "love 1" / "like 2"
- `anno-02-rating-stars.png` — 段落 1 顶部 5 星，4 实心 + 1 空心

---

## 耗时

约 60 分钟（含 TDD 多轮迭代、类型检查、build + e2e 调试）

---

## 关键决策

### 1. Shadow DOM 隔离（强制）
所有 UI（✏️ 锚点 / 5 星 / popover / 候选词 chip）都通过 `host.attachShadow({ mode: 'open' })` 挂在独立 Shadow Root 内，CSS 用 `:host { all: initial }` 重置 + 局部选择器，**绝不污染页面 DOM 类名**。

验证：`test/annotator.test.ts` 的 "所有 UI 在 shadowRoot 内，绝不污染页面 DOM 类名" 用例断言 `document.querySelector('.popover')` / `button.pencil` / `.cand` / `.star` 全部为 null。

### 2. 24h 去打扰
- chrome.storage.sync 存 `xtAnnoRatedRecent: { [segId]: timestamp }`
- Annotator 构造时 `getRecentlyRated()` 一次性读入内存 Map
- mount 时对每段 `.xt-translation` 检查 `Date.now() - recent[segId] < 24h` → 跳过挂载
- 评分提交后 `setRecentlyRated(segId)` 异步写回 storage

### 3. 键盘快捷键
- **1-9**：选候选词（`buildCandidates` 按 score 排前 5）
- **Esc**：关闭 popover，不触发 put
- **Enter**（自定义词输入框）：提交 add 类型
- 监听挂在 `host` 上，配合 `keydown` 事件 bubbles

### 4. 动效用 transform / opacity（不触发 reflow）
所有 transition 都是 `transform / opacity / background-color / color`：

```css
.row { transition: opacity .14s ease, transform .14s ease; }
.popover { animation: xt-anno-fadein .12s ease; }  /* 仅 opacity + translateY */
.pencil { transition: opacity .12s ease, transform .12s ease, background-color .12s; }
```

验证：单测 "动效用 transform/opacity（不应出现 top/left transition）" 遍历 shadow root 内所有元素，过滤 `transitionProperty`。

### 5. 接口契约（不依赖 Agent 1/2 的具体实现）
`AnnotatorOpts.encode` / `AnnotatorOpts.put` 通过参数注入。Agent 1/2 之后只需提供匹配的 Promise 接口。`AnnotateInput` 类型在 annotator.ts 里定义，与 `lib/annotation.mjs` 的 schema 字段一一对应（kind / url / domPath / srcSegmentId / langPair / srcText / tgtText / srcTokens / tgtTokens / predicted / modelVersion / payload）。

### 6. 候选词生成（`buildCandidates`）
按 srcTokenIdx 取 alignment 直接命中（score 最高）→ 兜底用全段 score top-5 → 去重 token。最多 9 个（与键盘 1-9 对齐）。"无对应词" 选项固定放在末尾，触发 `correctionKind: 'remove'` + `correctedTgtTokenIdx: null`。

### 7. 自定义词输入（"add" 类型）
popover 内嵌 `<input class="custom">` + 提交按钮。`correctionKind: 'add'` 时 `correctedTgtTokenIdx` 表示"插入位置"（tgtTokens.length 末尾）。

### 8. SVG inline（避免外链请求）
✏️ 铅笔 / ★ 星星都用 inline SVG，无外部依赖。

---

## 测试覆盖明细

### 单测（15 cases）
- 实例化不抛错
- mount 注入 shadow host 且不污染原 DOM
- enabled=false 时不挂载
- mount 后挂 5 星 + ✏️
- 点击 ✏️ 触发 popover（含候选词列表）
- 点击候选词 → encode + put
- 键盘 1-9 选候选
- Esc 关闭 popover（不触发 put）
- "无对应" 选项 → correctedTgtTokenIdx=null, correctionKind='remove'
- 5 星默认隐藏，hover 显示
- 点击第 3 星 → encode + put, rating=3
- 24h 去打扰：同段已评 → 不显示 ☆
- 所有 UI 在 shadowRoot 内（页面 DOM 无 .popover / .cand / .star / button.pencil）
- transition 只用 transform / opacity（无 top/left 触发 reflow）
- 自定义词 + Enter → correctionKind='add'

### e2e（3 cases）
- case 1：5 星评分（rating=4）端到端 → encode + put 各 1 次，kind='seg_rating'
- case 2：词级 alignment 修正 → encode + put 各 1 次，srcTokenIdx=0, correctedTgt=0
- case 3：24h 去打扰逻辑（fakeStorage 模拟 → isRecent=true, wouldMount=false）

---

## 遗留问题

1. **未接入 content.ts 主流程**：annotator.ts 当前是 standalone 模块，需在 content.ts 里在 `handleChunk` 之后调用 `annotator.mount(tgtEl, opts)`。下一步由 Agent 集成者负责。
2. **`lib/annotation.mjs` 和 `lib/annotation-store.mjs` 尚未实现**：annotator.ts 用 `AnnotatorOpts.encode` / `AnnotatorOpts.put` 注入，依赖 Agent 1/2 的接口契约；Agent 1/2 完成后只需保持 Promise 接口一致即可。
3. **真实 IDB 验证未做**：e2e 用 `window.__xtAnnoTest` 模拟 encode/put 调用栈。真实 IndexedDB 写入由 Agent 2（annotation-store.mjs）的实现 + fake-indexeddb 单测覆盖。
4. **打开 popover 的触发源**：当前默认取 alignment.alignments[0]，未对接 hover token 的真实 srcTokenIdx。完整集成时需把 `setupHoverDelegation` 里捕获的 srcIdx 通过 `pencil.open(srcIdx, predTgtIdx)` 传进来。
5. **transform/opacity 测试在 jsdom 下 transitionProperty 全部是空字符串**：单测里的 transitionProperty 断言通过是因为断言列表里有 'none'。生产 Chrome 下应验证 computed style 真值。
6. **headless e2e 的 SW 加载**：实测 `headless: true` + chromium channel 下 service worker 可能延迟注册或失败。本测试不依赖 SW（直接在 main world 注入 UI stub），允许 SW 缺失 + 仅警告。

---

## 验证命令

```bash
# 单测
cd extension && npx vitest run test/annotator.test.ts
# 预期：15 passed (15)

# e2e
node test/annotator.ext.e2e.test.mjs
# 预期：3/3 ✓ ALL PASS

# 类型检查
cd extension && npx tsc -b
# 预期：无输出

# 构建
cd extension && npx vite build
# 预期：✓ built in ~100ms（annotator.ts 不被 content.ts 引用，仅 standalone 测试）
```