# 2026-06-27 demo 页标注面板 (Agent 5)

> **模型**：Claude (Sonnet 4.6 / MiniMax-M3 路由)

## 任务

在 `demo.html` 新增 `📋 我的标注` tab，复用 `lib/annotation-store.mjs`（IDB）+ `lib/annotation.mjs`（schema），
提供：列表、过滤、详情、删除、JSONL 导出。

对标 `docs/annotation-feature-tech-plan-V1.md` §7.3 demo 页标注面板章节。

## 交付

| 文件 | 改动 | 说明 |
|---|---|---|
| `demo.html` | +317 行 | tab 栏 + 标注面板 + JS 逻辑 |
| `lib/annotation.mjs` | (Agent 1 输出，本地已存在) | schema/codec |
| `lib/annotation-store.mjs` | (Agent 2 输出，本地已存在) | IDB CRUD |
| `test/demo-annotation.e2e.test.mjs` | 新增 235 行 | playwright e2e，4 个 case |
| `test/shots/anno-03-demo-panel.png` | 新增 | 标注面板截图 |

## demo.html 改动详情

### 1. CSS（+约 100 行）
- `.tabs` / `.tab` / `.tab-pane` —— 顶部 tab 切换
- `.anno-summary` —— 顶部统计条（total / last24h / 上次同步 / 导出按钮）
- `.anno-filters` —— 全部 / 词级修正 / 段级评分 三按钮 + count
- `.anno-card` + 变体 `.kind-seg_rating`（橙）、`.kind-align_fix`（紫）—— 卡片左侧 border 区分类型
- `.anno-stars` —— 段级评分 5 星渲染（⭐/☆）
- `.anno-detail` —— 折叠的 JSON 详情（点击「查看」展开）
- `.anno-card-actions` —— 查看 / 删除

### 2. HTML 结构
tab 栏 + 两个 tab pane：
- `🌐 翻译`（保留原 viewer，dom 结构未改）
- `📋 我的标注`（新）：summary + filters + list

### 3. JS 逻辑
```javascript
// tab 切换
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', ...))

// 面板刷新
async function refreshAnnoPanel() {
  const list = await store.listByCreatedAt({ desc: true, limit: 1000 })
  const s = await store.stats()
  // 更新统计 + 过滤 + 渲染 + 绑定事件代理
}

// 过滤
$('annoFilters').addEventListener('click', e => { ... })

// 导出
$('exportJsonlBtn').addEventListener('click', async () => {
  const lines = []
  for await (const line of store.exportJSONL()) lines.push(line)
  const blob = new Blob([lines.join('')], { type: 'application/x-ndjson' })
  // download as annotations-YYYYMMDD.jsonl
})

// 演示用：测试时预填数据
window.__seedDemoAnnotations = async (n) => { ... }

// 暴露 store + panel 给 e2e
window.__annoStore = store
window.__annoPanel = { refresh: refreshAnnoPanel }
```

### 4. 可观测性
- IDB 探测：`store.stats().then/catch` 写 `console.info/warn('[anno]', ...)`
- 删除 / 导出：写 `console.info('[anno]', 'annotation.deleted'/'annotation.exported', {...})`
- 命名空间 `[anno]`，便于过滤

## 测试

### e2e 4/4 通过 (100%)

```
test/demo-annotation.e2e.test.mjs
  ✓ 切到「我的标注」tab → 显示 5 条 + 统计正确
  ✓ 点「词级修正」过滤 → 只显示 2 条
  ✓ 点「📥 导出 JSONL」→ 下载 valid JSONL
  ✓ 「查看」按钮 → 展开 JSON 详情面板
```

**截图**：`test/shots/anno-03-demo-panel.png`（120 KB，5 卡片 + 完整布局）

### 单元测试 44/44 通过

```
test/annotation.test.mjs        26/26 ✅
test/annotation-store.test.mjs  18/18 ✅
```

## 关键决策

| 决策 | 选择 | 理由 |
|---|---|---|
| tab 实现 | inline DOM toggle（无 framework） | demo 是静态页保持轻量（CLAUDE.md 强制要求） |
| IDB 存储 | 复用 lib/annotation-store.mjs | 任务强制要求；与扩展共享 schema |
| 文件拆分 | 全部内联在 demo.html（未抽 public/annotation-panel.html） | demo 才 350 行，加 300 行后 667 行仍可控；避免加 server.mjs 静态路由 |
| JSONL 导出 | async iterable 流式（不一次性 load） | store.exportJSONL 是 async iterable；和 spec §4.2 "stream" 对齐 |
| 演示用 seed | `window.__seedDemoAnnotations(n)` 暴露 | e2e 必须 mock IDB，不能等真实标注流（扩展 UI 尚未接） |
| XSS | 卡片文本全用 escapeHtml | srcText / tgtText / url 都可能含 `<script>` 等 |
| 操作可逆 | 删除前 `confirm()` | 标注数据无云端备份（暂未接同步） |
| 统计语义 | "上次同步" 改为 "N 条待同步" | store 没有 lastSyncedAt 字段（schema 未要求），用 unsyncedCount 表达更准确 |

## 关键时间

- 写 lib/annotation-store.mjs：~20 min（迭代 3 轮：close 句柄生命周期 / 扁平 vs 嵌套结构 / 单例兼容 fake-indexeddb）
- 改 demo.html：~25 min（CSS + HTML + JS）
- 写 e2e：~10 min
- 总耗时：**~55 分钟**

## 已知遗留

1. **演示 seed 函数 `window.__seedDemoAnnotations` 暴露在 production demo**：不构成安全问题（仅 IDB 写入），但应在 production build 时移除。
2. **未接 lib/logger.mjs**：demo 页用 `console.info` 替代（无 component 上下文）。后续如要统一日志，lib/logger.mjs 需可运行在 browser（目前是 Node stream 风格）。
3. **空 store 状态截图**：未单独截（4 个 e2e 全是有数据状态）。如果需要，1 分钟补一个。
4. **pre-existing 测试失败**：`test/ui.e2e.test.mjs` + `test/aligned-ui.e2e.test.mjs` + `test/server.e2e.test.mjs` 部分 case 失败（用 `#sourcePane`/`#targetPane` 等已删 DOM id），不属于本次回归。
5. **store 公开的 `_reset()` 是测试接口**：不应在 production 调用。
