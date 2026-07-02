# W2-2 漏翻根因修复：display:none 元素 + inline 文字 + SPA 属性观察

**模型**: Claude Sonnet 4.5
**日期**: 2026-06-25
**前置**: 2026-06-25-w2-dom-walker-leak.md（W2-1 通用漏翻修复）

## 用户反馈

> 漏翻的还是很多

W2-1 修复后 coverage probe 显示 84.8% (123/145)，仍漏 22 段。

## 根因诊断

用 `test/ext-coverage-probe.mjs` 跑 alibaba.com 真实扩展，统计英文文字节点被 `[data-xt-id]` 覆盖率：

| 站点 | 文字节点 | 被覆盖 | 覆盖率 |
|---|---|---|---|
| alibaba.com (W2-1) | 145 | 123 | **84.8%** |
| alibaba.com (W2-2) | 146 | 145 | **99.3%** ✅ |

漏翻的 22 段按根因分类：

### 根因 A — display:none 子树被整体跳过（10 段）
旧 `shouldSkip` 检查 `getComputedStyle(el).display === 'none'` 直接返回。

但 alibaba 等电商站大量元素初始隐藏（dropdown / tooltip / tab 隐藏面板 / lazy-content），用户 hover/click 后才显示。**预翻译无害**：用户看到时已是中文。跳过则用户永远看到原文。

### 根因 B — `<bdi>` 等隔离方向性元素未列入 LEAF_BLOCK_TAGS（4 段）
alibaba "3 pieces" / RTL 嵌入用 `<bdi>`，旧版只识别 `<span>`，整段被容器兜底但容器文字过长污染上下文。

### 根因 C — SPA 属性变化（display:none → visible, class 切换 tab）未触发再提取（8 段）
旧 MutationObserver 只监听 `childList`。但 alibaba 切 tab / 展开 dropdown 是属性变化，节点早已存在 DOM，只是被隐藏 → 切换后内容翻译丢失。

## 修复

### `extension/src/content/dom-walker.ts`
1. **LEAF_BLOCK_TAGS 新增** `BDI`（电商 RTL 隔离片段）
2. **shouldSkip 移除 display:none / visibility:hidden 短路**：
   ```ts
   function shouldSkip(el: Element): boolean {
     if (SKIP_TAGS.has(el.tagName)) return true
     if (el.closest('script, style, noscript, code, pre, textarea, input, select, svg, math')) return true
     // W2-2: 不再跳过 display:none / visibility:hidden ——
     // 大量真实站点（alibaba 下拉菜单、tooltip、tab 隐藏面板、lazy-content）
     // 用 display:none 初始隐藏，用户 hover/click 后才显示。若跳过则用户永远
     // 看到原文。预翻译无害：用户看到时已是中文。
     return false
   }
   ```

### `extension/src/content/content.ts` — observeSpa 加属性观察
```ts
// W2-2: 属性变化（display:none → visible, class 切换 tab 等）
if (m.type === 'attributes' && m.target instanceof Element) {
  const t = m.target as Element
  if (!t.hasAttribute('data-xt-id') && !t.hasAttribute('data-xt-tgt') && !t.closest('[data-xt-id]')) {
    newEls.push(t)
  }
}
// ...
mutationObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['style', 'class', 'hidden'],
})
```

## 测试

### `extension/test/unit/dom-walker.test.ts`
- 更新 "跳过 display:none" → "提取 display:none 元素"（断言改为 length=2）
- 新增 "W2-2: `<bdi>` 文字被提取"
- 新增 "W2-2: 隐藏 dropdown 内的文字被提取"

### `extension/test/unit/scheduler.test.ts`
W2 修复后，rollback 自动 scheduleFlush → 测试断言更新：
- "onBatch 抛错时"：onBatch 调用 2 次（首次失败 + 自动重试），scheduled.size=1, pending.size=2
- "超时未返回"：onBatch 调用 2 次（首次超时回滚 + 自动重试）

### 端到端（`test/ext-final-verify.mjs`）
alibaba.com: sources=83, translations=83, samples 全部双语对照成功。
截图 `test/shots/ext-alibaba-final.png` 可见状态栏 337/382=88% + 中文弹窗。

## 已知遗留（不是漏翻，是翻译质量）

`test/ext-final-verify.mjs` samples 中观察到：
- `[3.4W+]` → `[3.4宽]` — DeepL 把 "W" 译成"宽"（width 缩写）
- `[5G智能手机]` → `[5G智能手机]` — 混合段本质中文，翻译=原文（用户感知"没翻"）

根因是混合 CJK+latin 段（"W"/"G" 等单字母品牌缩写）被放行给 LLM。这是**翻译质量**问题，不是漏翻。需后续 LLM prompt 调优（如品牌缩写保护列表）。

## 改动清单

- `extension/src/content/dom-walker.ts` — shouldSkip 移除隐藏短路 + BDI 加入 LEAF_BLOCK_TAGS
- `extension/src/content/content.ts` — observeSpa 加 attributes 观察
- `extension/test/unit/dom-walker.test.ts` — 3 个测试更新
- `extension/test/unit/scheduler.test.ts` — 2 个测试断言更新
- `test/ext-coverage-probe.mjs` — 新增覆盖率探针
- `test/ext-final-verify.mjs` — 新增端到端验证
- `test/shots/ext-alibaba-final.png` — 截图证据
