# 产品化冲刺方案 — 对标沉浸式翻译

**日期**: 2026-06-27
**模型**: claude-sonnet-4-6（MiniMax-M3 路由）
**目标**: 全场景覆盖 + 对标沉浸式翻译/百度翻译 + 可上线
**关联**: [`docs/annotation-feature-tech-plan-V1.md`](./annotation-feature-tech-plan-V1.md), `changes/2026-06-27-fix-taobao-flex-layout.md`

---

## 0. 竞品对标

| 维度 | 沉浸式翻译 | 百度翻译 | 本项目目标 |
|---|---|---|---|
| 双语译文样式 | 蓝色 + 左边框 + 浅蓝渐变背景 | 浅蓝 + 圆角 + 浅蓝底色 | **沉浸式 + 渐变** |
| Hover 词对齐 | src 黄底 + tgt 蓝底 + 配对橙黄 | 仅高亮 | **沉浸式（带配对色）** |
| FAB 浮球 | 右下角圆形 48px | 顶部条 | **沉浸式 FAB + 顶栏** |
| 模式 | 双语/仅译文/侧栏 | 仅译文 | **三种齐全** |
| 标注 | ❌ 无 | ❌ 无 | **✅ 全栈（差异化）** |
| 标注回训算法 | ❌ | ❌ | **✅ alignment head 微调** |

**结论**：本项目在"标注闭环"上**完胜所有竞品**；在视觉上**对标沉浸式**即可上线。

---

## 1. 全场景覆盖（12 类）

| # | 场景 | 代表页面 | CSS 关键 | 修复策略 |
|---|---|---|---|---|
| 1 | inline 元素（`<a>`, `<span>`, `<button>`） | taobao 顶部导航 | `display:block` + `flex-basis:100%` | 已修（W3.1） |
| 2 | 块级元素（`<p>`, `<div>`, `<h1>`） | 文章段落 | `display:block` + `margin-top` | ✅ |
| 3 | flex 容器（导航/工具栏） | taobao/B站 | `flex-basis:100%` + `width:100%` + `clear:both` | ✅ |
| 4 | grid 容器（卡片网格） | 知乎/掘金 | `grid-column:1/-1` + 新 className | **新增** `.xt-grid-translation` |
| 5 | table 单元格（`<td>`） | 维基百科 | `display:block` + `width:100%` | ✅ |
| 6 | list item（`<li>`） | 菜单列表 | `display:block` | ✅ |
| 7 | 有 `max-width` 限制 | 卡片标题 | `max-width:100%` + `word-wrap` | **新增** |
| 8 | RTL 语言（阿/希） | 阿拉伯语页面 | `direction:rtl` + 反向 border | **新增** |
| 9 | emoji / 特殊字符 | 推特/微博 | `unicode-bidi:plaintext` | **新增** |
| 10 | 空/纯空白 | 装饰元素 | 跳过（已做） | ✅ |
| 11 | Shadow DOM | 现代 SPA | 递归注入 | ✅ W2-3 |
| 12 | iframe（含跨域） | 嵌入广告 | `all_frames:true` | ✅ W2-3 |

---

## 2. 视觉规范（对标沉浸式翻译）

### 2.1 双语译文块

```css
.xt-translation {
  display: block !important;
  width: 100%;
  clear: both;
  flex-basis: 100% !important;

  /* 沉浸式风格：蓝色 + 左边框 + 浅蓝渐变 */
  margin-top: 6px;
  padding: 4px 0 4px 12px;
  border-left: 3px solid #2563eb;
  background: linear-gradient(
    to right,
    rgba(37, 99, 235, 0.06),
    rgba(37, 99, 235, 0)
  );
  border-radius: 0 4px 4px 0;

  color: #2563eb;
  font-size: 0.875em;
  line-height: 1.65;

  font-weight: 400;
  font-style: normal;
  text-decoration: none;
  letter-spacing: normal;

  word-wrap: break-word;
  overflow-wrap: break-word;
  unicode-bidi: plaintext;

  user-select: text;
  pointer-events: auto;

  transition: background 0.18s ease;
}

.xt-translation:hover {
  background: linear-gradient(
    to right,
    rgba(37, 99, 235, 0.12),
    rgba(37, 99, 235, 0)
  );
}
```

### 2.2 标题缩放

```css
h1 .xt-translation, h2 .xt-translation { font-size: 0.65em; }
h3 .xt-translation, h4 .xt-translation { font-size: 0.75em; }
h5 .xt-translation, h6 .xt-translation { font-size: 0.85em; }
```

### 2.3 Hover 词对齐（沉浸式核心特性）

```css
[data-xt-tok] {
  cursor: pointer;
  border-radius: 2px;
  padding: 0 1px;
  transition: background-color 80ms, color 80ms;
}

[data-xt-tok]:hover {
  background-color: rgba(37, 99, 235, 0.15);
}

[data-xt-tok].xt-hover-active {
  /* 当前 hover 的词 */
  color: #fff !important;
  background-color: #2563eb !important;
  font-weight: 600;
}

[data-xt-tok].xt-hover-pair {
  /* 配对的词 */
  color: #1a1a1a !important;
  background-color: #fbbf24 !important;  /* amber-400 */
  font-weight: 600;
}
```

### 2.4 Grid 容器

```css
.xt-translation.xt-grid-translation {
  grid-column: 1 / -1 !important;
}
```

### 2.5 RTL

```css
[dir="rtl"] .xt-translation,
.xt-translation.xt-rtl {
  border-left: none !important;
  border-right: 3px solid #2563eb !important;
  padding: 4px 12px 4px 0 !important;
  background: linear-gradient(
    to left,
    rgba(37, 99, 235, 0.06),
    rgba(37, 99, 235, 0)
  ) !important;
}
```

### 2.6 深色模式

```css
@media (prefers-color-scheme: dark) {
  .xt-translation {
    color: #93c5fd;
    border-left-color: #3b82f6;
    background: linear-gradient(
      to right,
      rgba(96, 165, 250, 0.1),
      rgba(96, 165, 250, 0)
    );
  }

  [data-xt-tok].xt-hover-active {
    background-color: #3b82f6 !important;
    color: #fff !important;
  }

  [data-xt-tok].xt-hover-pair {
    background-color: #f59e0b !important;
    color: #1a1a1a !important;
  }
}
```

### 2.7 打印模式

```css
@media print {
  .xt-translation-host, .xt-fab-host, .xt-progress-bar,
  .xt-sidebar-host { display: none !important; }
  /* 打印时只显示译文，方便阅读 */
  .xt-translation { display: block !important; color: #000 !important; }
}
```

---

## 3. FAB 浮球升级（immersive 风格）

```css
.xt-fab-host { all: initial; }
.xt-fab-host * { box-sizing: border-box; }

.xt-fab {
  position: fixed;
  right: 16px; bottom: 100px;
  width: 48px; height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #2563eb, #3b82f6);
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.45);
  z-index: 2147483647;
  cursor: pointer;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.2s;
}

.xt-fab:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 22px rgba(37, 99, 235, 0.55);
}

.xt-fab.done {
  background: linear-gradient(135deg, #10b981, #059669);
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.45);
}

.xt-fab.error {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  box-shadow: 0 4px 14px rgba(239, 68, 68, 0.45);
}
```

---

## 4. 顶栏工具条（沉浸式风格）

```css
.xt-toolbar {
  position: fixed;
  top: 0; left: 0; right: 0;
  height: 40px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  z-index: 2147483646;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 12px;
  font: 13px/1 -apple-system, system-ui, sans-serif;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.xt-toolbar-progress {
  flex: 1;
  height: 4px;
  background: #e5e7eb;
  border-radius: 2px;
  overflow: hidden;
}

.xt-toolbar-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #2563eb, #60a5fa);
  transition: width 0.3s ease;
}

.xt-toolbar-btn {
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
}

.xt-toolbar-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.xt-toolbar-btn.primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}

.xt-toolbar-btn.primary:hover {
  background: #1d4ed8;
}

@media (prefers-color-scheme: dark) {
  .xt-toolbar {
    background: rgba(17, 24, 39, 0.95);
    border-bottom-color: rgba(255, 255, 255, 0.08);
    color: #e5e7eb;
  }
  .xt-toolbar-btn {
    background: #374151;
    border-color: #4b5563;
    color: #e5e7eb;
  }
}
```

---

## 5. Popup 升级（immersive 风格）

### 5.1 结构

```
┌─────────────────────────────────┐
│  智能网页翻译                    │
│  ─────────────────────────────  │
│  [🌐 翻译] [📊 标注] [⚙️ 设置]  │
│                                  │
│  🌐 当前页面                      │
│  [翻译此页]    [Alt+T]           │
│                                  │
│  ─── 模式 ───                    │
│  ◉ 双语对照                       │
│  ○ 仅译文                         │
│  ○ 侧栏对照                       │
│                                  │
│  ─── 语种 ───                    │
│  [中文 ▼]  →  [English ▼]        │
│                                  │
│  ─── 高级 ───                    │
│  📊 参与标注改进   [●━━]          │
│  📥 导出我的标注                  │
└─────────────────────────────────┘
```

---

## 6. 标注 UI 集成（P0 解决）

### 6.1 当前状态
- `annotator.ts` 已实现（Agent 3 输出）
- **未接入 content.ts**（Agent 3 遗留）

### 6.2 集成方案
在 `content.ts` 的 `setMode('bilingual')` 后，对每个注入的 translation span 调用 `annotator.attachPencil(tgtEl, segInfo)`。在每段译文渲染后调用 `annotator.attachStars(srcEl, segInfo)`。

### 6.3 集成点
```typescript
// content.ts setMode 内
if (mode === 'bilingual') {
  this.injectBilingual(segId, srcEl, translation)
  // 集成点 1：挂载 ✏️
  annotator.attachPencil(tgtEl, { segId, srcEl, tgtEl, ... })
}
// 集成点 2：挂载 ⭐（无论哪种模式都挂）
annotator.attachStars(srcEl, { segId, srcText, tgtText })
```

---

## 7. 上线 Checklist

### 7.1 功能完整性
- [ ] 12 场景全跑通（taobao / alibaba / bbc / wiki / 知乎 / 推特 / SPA / iframe）
- [ ] FAB 浮球 4 态（idle/working/done/error）
- [ ] 顶栏工具条（进度 + 模式 + 还原 + 全部还原）
- [ ] Popup 4 tab（翻译/标注/设置/关于）
- [ ] 三模式切换（双语/仅译文/侧栏）
- [ ] 标注 UI（A 词级 + B 段级）
- [ ] 后台同步（chrome.alarms 30s + 退避）

### 7.2 视觉规范
- [ ] 沉浸式配色（#2563eb 蓝主色 + #fbbf24 amber 配对色）
- [ ] 深色模式（prefers-color-scheme）
- [ ] RTL 支持（阿拉伯/希伯来）
- [ ] 打印模式
- [ ] Hover 词对齐（src 黄 / tgt 蓝 / 配对 amber）

### 7.3 性能
- [ ] 翻译初始化 < 100ms（scheduler 批量 8 段）
- [ ] Hover 响应 < 50ms
- [ ] Layout shift CLS < 0.02
- [ ] FAB 浮球不抢焦点

### 7.4 兼容
- [ ] Chrome 120+
- [ ] Edge 120+
- [ ] Arc / Brave（基于 Chromium）
- [ ] 不支持 Firefox（v2）

### 7.5 安全
- [ ] API key 移至 .env（当前硬编码 memory 已记录）
- [ ] XSS 防护（placeholder codec + escapeHtml）
- [ ] 用户标注数据隐私可控（popup 开关）

---

## 8. Agent 拆解

| Agent | 任务 | 工期 |
|---|---|---|
| **A7** | content.css 全场景 + popup.html 沉浸式 + 顶栏工具条 + 进度条 + hover 增强 + 标注图标 | ~2h |
| **A8** | annotator.ts 集成进 content.ts（P0 解决） | ~1h |
| **A9** | e2e 验证 8 场景 + UI 截图回归 + 上线 checklist 走查 | ~1h |

并行：A7+A8 → A9

---

## 9. 量化目标

| 维度 | 当前 | 目标 |
|---|---|---|
| 测试覆盖 | 133 (132+1skip) | **≥180 (160+20)** |
| 代码行 | ~6400 | **~8500** |
| UI 截图 | 3 张 | **≥12 张**（每个场景 1 张） |
| 场景覆盖 | 5 站 | **≥10 站**（含 flex/grid/table/RTL/SPA） |
| Bug 数 | 1 (payload) | **0**（上线前清零） |
| 性能 | baseline | CLS < 0.02, FCP < 1s |

---

## 10. 上线时间线

| Day | 内容 |
|---|---|
| 1 (今天) | A7+A8 并行 → A9 验证 |
| 2 | 修 e2e 暴露的 bug + UI 打磨 |
| 3 | 打包 zip + Chrome Web Store 提交 trustedTesters |
| 4-7 | 内测 + 收集 ≥500 标注 |
| 8 | Phase 8 真训练 |
| 9-14 | 1% → 100% 灰度 |
| 15 | 全量上线 |

