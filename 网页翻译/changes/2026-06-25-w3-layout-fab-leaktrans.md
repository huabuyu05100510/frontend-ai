# W3: 排版修复 + FAB 浮球 + 漏翻根治

**日期**: 2026-06-25  
**模型**: claude-sonnet-4-6

## 问题

1. **排版乱掉** — bilingual 模式将译文插为兄弟节点，破坏 flex/grid/table 等布局容器
2. **交互体验差** — 状态浮层不固定，消失后无法触发翻译/回滚
3. **漏翻严重** — `tryExtract` 每次 rescan 生成新 ID 覆盖旧 ID，rescan/mutation 过滤器逻辑反向

## 根因分析

### 漏翻
```typescript
// BUG: tryExtract 无论何时都生成新 id 并覆盖元素上已有的 data-xt-id
const id = nextId()
el.setAttribute('data-xt-id', id)  // 覆盖旧 ID → injector 关联断裂
```
同时 rescan 过滤器逻辑反向：
```typescript
.filter(s => !document.querySelector(`[data-xt-id="${s.id}"]`))
// tryExtract 刚设了这个 id → querySelector 总找到 → !true → 全部过滤掉 → rescan 永远不添加新段
```

### 排版
bilingual 注入为兄弟节点：
- flex 容器：多一个 flex item，破坏行布局
- table：多一个 `<td>` 列，错位
- list：多一个 `<li>`，条目数翻倍

## 修复

### 1. dom-walker.ts — tryExtract 保护已标记元素
```typescript
if (el.hasAttribute('data-xt-id')) return null  // 跳过已注册元素
```

### 2. content.ts — 移除反向过滤器
```typescript
// startRescan 和 handleMutations 中移除：
- .filter(s => !document.querySelector(`[data-xt-id="${s.id}"]`))
```

### 3. injector.ts — 注入策略改为"注入内部"
对标沉浸式翻译：将译文 `<span>` append 进原文元素内部，不改变父容器子元素集合：
```typescript
const tgtEl = document.createElement('span')
srcEl.appendChild(tgtEl)  // 不再 insertBefore(tgtEl, srcEl.nextSibling)
```
- 保留 TBODY/THEAD/TFOOT/TR 的安全跳过（这些元素不持有文本）
- 删除 `chooseWrapper`（兄弟模式专用，现在不需要）

### 4. content.ts — FAB 浮球（Shadow DOM）
替代旧版状态浮层，全时可见：
- **idle**: 地球仪图标 + tooltip「翻译此页」→ 点击读取存储设置并翻译
- **working**: 旋转圈 + 进度百分比环
- **done**: 绿色复原箭头 + tooltip「还原原文」→ 点击还原
- **error**: 红色 X + 5s toast

### 5. content.css — 样式更新
```css
.xt-translation { display: block !important; font-weight: normal; /* 重置继承 */ }
h1 .xt-translation, h2 .xt-translation { font-size: 0.6em; }  /* 标题缩放 */
```

## 测试
- injector 单测：全部 20 个重写通过 ✓
- 全套：134/135 通过（1 个 translator 超时为已知 MiniMax rate-limit 问题，非本次引入）
- Build: 0 错误 ✓
