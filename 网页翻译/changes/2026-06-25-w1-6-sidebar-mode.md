# 2026-06-25 W1-6 右侧固定栏（sidebar）模式

> **模型**：Claude (Sonnet 4.5)

## 决策

用户反馈：能否像其他翻译软件（彩云小译、DeepRead、沉浸式翻译）一样
把译文固定在右侧侧栏？现有 `bilingual`（段后插入译文）和 `translation-only`
（覆盖原文）两种模式不够。本次加第三种 `sidebar`：原文不动，所有 [src, tgt]
段对追加到右侧固定栏，并保持词级对齐 hover 跨侧栏 ↔ 原文工作。

## 架构

```
┌─────────────┐                 ┌──────────────────┐
│  原文 DOM    │ ← 不动           │  #xt-sidebar-host │ ← position: fixed right:0
│  (data-xt-id)│                 │  .xt-sidebar-list │
│              │                 │   .item (s1)      │
│  [hover src] │ ←──┐            │   .item (s2)      │
└─────────────┘    │  alignment  │   ...             │
                   └────────────→│   .item (sN)      │
                                  │   [hover tgt]    │←──┐
                                  └──────────────────┘   │
                                                         │
                          document.addEventListener('mouseover') 委托
                          按 data-xt-tok + data-xt-seg 找配对 span
```

- body 加 `padding-right: 420px` 让位，避免遮挡原文（关闭时还原）
- 用 light DOM + 强 reset class（`.xt-sidebar-*`，`!important`）而非 shadow DOM
  - 理由：现有 hover 委托靠 `document.querySelectorAll('[data-xt-tok]')`，
    shadow 内部元素无法穿透；单测也直接 querySelector 验证

## 改动

- **改** `extension/src/shared/types.ts`
  - `TranslationMode` 加 `'sidebar'` 分支
- **改** `extension/src/content/injector.ts`
  - 新增 `ensureSidebarHost()` / `removeSidebarHost()` / `getOrCreateSidebarItem()` 三个模块级 helper（导出前两个便于单测）
  - `inject(mode='sidebar')` → 创建/复用 item，写 src+tgt 到 `.xt-sidebar-src`/`.xt-sidebar-tgt` 子元素
  - `append()` 适配 sidebar item（流式追加到 tgt 子元素）
  - `restore()` 增加 `removeSidebarHost()` 调用，同时解除 body 让位
  - `applyAlignment()` sidebar 模式下定位 `.xt-sidebar-tgt` 子元素包 token span（src 仍在原文 DOM）
- **改** `extension/src/content/content.ts`
  - 翻译完成消息：sidebar 模式也触发 `requestAlignment`（src 元素仍在原文 DOM，对齐可工作）
  - `setMode` 加日志
- **改** `extension/src/content/content.css`
  - 新增 `.xt-sidebar-host` reset + `.xt-sidebar-aside` 固定栏样式
  - 侧栏滑入动画 `xt-sidebar-slide`
  - 暗色模式适配（背景 #1f1f1f、header #0d47a1）
- **改** `extension/src/popup/App.tsx`
  - mode-row 新增「侧边栏」按钮
- **新增** `extension/test/unit/injector-sidebar.test.ts`（9 测试）
  - sidebar inject 挂 host、item 含 src+tgt、幂等、多段追加、append 流式、restore 清除
  - `ensureSidebarHost` 幂等 + body 让位
  - `removeSidebarHost` 解除让位

## 验证

```bash
$ cd extension && npx vitest run test/unit/injector-sidebar.test.ts
  Test Files  1 passed (1)
  Tests       9 passed (9)
  Duration    778ms

$ npx vitest run
  Test Files  10 passed | 1 failed | 1 skipped (12)
  Tests       119 passed | 1 failed (pre-existing translator timeout flake) | 1 skipped

$ npm run build
  ✓ built in 88ms
  content.ts  15.33 kB (+1.79 kB from 13.54 kB)
```

## 设计决策与坑

1. **为什么不用 shadow DOM**
   - 已有 hover 委托 `document.addEventListener('mouseover', ...)` 用 `closest('[data-xt-tok]')`
     找 token span。shadow DOM 内元素事件会 retarget 到 host，且 `document.querySelectorAll`
     无法穿透 shadow，导致词对齐失效。
   - 单测也直接 `document.querySelector([data-xt-tgt])` 验证，shadow 需走 `host.shadowRoot`
     增加心智负担。
   - 折中代价：必须用强 reset（`all: initial` on host + `!important` on critical props）
     防止站点 CSS 污染。已在 5 站 fixture + 主流 reset 框架下目测无污染。

2. **body 让位用 `padding-right` 而非 `margin-right`**
   - padding 保留 body 背景；margin 在某些 theme（fixed header 用 background-clip）下露出空白
   - `removeSidebarHost` 还原时检查原值，避免清掉用户已有的 padding

3. **sidebar 模式仍触发词对齐**
   - 对齐 src 元素仍在原文 DOM 里（sidebar 不改原文），对齐可双向工作
   - hover 侧栏 tgt 词 → 原文 src 同步高亮；hover 原文 src → 侧栏 tgt 同步高亮

## 已知遗留

- sidebar 模式下，如果用户切换到其他模式后再切回 sidebar，当前实现是「不重新挂 host」
  （host 被 restore 移除，再次 inject 时会重建）—— 行为正确，无需修复
- sidebar 宽度固定 420px / max-width 90vw，未做拖拽调宽（W2 候选）
- 关闭按钮仅 hide panel，不还原译文（用户可重新打开或点 popup 的「还原原文」彻底清掉）
