## Context

AI 模型子应用（Streamlit、Gradio 等）的冷启动耗时主要在三个方面：HTML 下载与解析、JS Bundle 加载与执行、WebSocket 连接建立。这些操作在用户点击切换模型时才开始，导致 5s+ 的白屏。预热池将这些耗时操作前置到用户闲置时段，在后台 DOM 中静默加载 iframe，用户点击时直接复用已就绪的实例。

Bridge SDK 已在 `src/bridge/` 实现，Pool 可通过 `IframeBridge.handshake()` 验证实例是否真正就绪。

## Goals / Non-Goals

**Goals:**
- 实现 LRU 策略的 iframe 预热池，maxSize 可配置，默认 3
- 后台预热使用 `position:absolute; left:-9999px` 挂载（浏览器正常解析）
- 取出实例后自动异步补充
- 闲置 >5min 的实例自动销毁释放内存
- `document.hidden` 时暂停预加载，节省资源
- 暴露 `getStats()` 监控接口

**Non-Goals:**
- 不做跨 tab 共享池（v1 单 tab 单池）
- 不做实例的 content 快照/恢复（v1 仅保持 DOM 存活）
- 不做按 URL 的优先级队列（v1 纯 LRU，无权重）
- 不处理 iframe 内部导航后的状态（v1 假设 src 不变）

## Decisions

### Decision 1: 使用 `left:-9999px` 而非 `visibility:hidden`

**选择:** `position:absolute; left:-9999px` 挂载到 document.body
**理由:**
- `visibility:hidden` 和 `display:none` 会让 Chromium 降级渲染优先级，可能延迟或跳过 iframe 内部的 JS 解析和 WebSocket 握手
- `left:-9999px` 保持元素在渲染树中，浏览器正常解析但不显示
- 已有多篇 Chromium bug report 证实 `visibility:hidden` iframe 的资源加载优先级被降低

**替代方案:**
- `display:none`：最差，iframe 完全不加载
- `position:fixed; top:-100%`：可行但可能触发滚动，不如 `left:-9999px` 稳定

### Decision 2: 使用 Map 存储而非数组

**选择:** `Map<string, PoolEntry>` 其中 key 为 url
**理由:**
- O(1) 查找命中
- LRU 时间戳记录在 `PoolEntry.lastAccessedAt`，淘汰时遍历所有 entries 找最小值
- maxSize 为 3，遍历开销可忽略

**替代方案:**
- 双向链表 + Map 实现 O(1) LRU：过度设计，size=3 时无收益
- 数组：O(n) 查找，但 n=3 也可以接受

### Decision 3: 定时器驱动老化清理

**选择:** `setInterval` 每 60s 运行 `evictStaleNodes()`
**理由:**
- 简单可靠，不需要在每个操作中判断老化
- 60s 粒度对于 5min 超时足够（误差在 20% 以内）
- `clearInterval` 在 `destroy()` 中清理

**替代方案:**
- 每次 `getSandbox()` 时判断：增加操作延迟
- `requestIdleCallback`：浏览器空闲时清理，但可能导致长期不清理

### Decision 4: 实例归还策略

**选择:** `releaseSandbox()` 重置 iframe 状态后放回池中
**步骤:**
1. 清空 iframe `src` 为 `about:blank`
2. 恢复 `src` 为目标 url
3. 更新 `lastAccessedAt` 时间戳
4. 放入池中

**理由:**
- 重置确保子应用状态干净
- 重新加载触发新的 WebSocket 握手（预热效果）

### Decision 5: 池与 Bridge 的关系

**选择:** Pool 不直接依赖 Bridge，Bridge 验证由上层 MicroAppContainer 完成
**理由:**
- Pool 职责单一：管理 iframe DOM 生命周期
- Bridge 握手是业务逻辑，应在容器层做
- 降低耦合，Pool 可独立测试

## Risks / Trade-offs

- **[内存]** 3 个预热 iframe 可能占用 100-150MB → `maxSize` 可配置，默认 3 经过实测
- **[网络]** 预加载时 iframe 发起 WebSocket 连接，可能被后端判定为无效连接 → 后端需配置合理的 WebSocket idle timeout
- **[布局]** `left:-9999px` 可能在某些极端情况下被 CSS 动画/transform 意外暴露 → 增加 `opacity:0; pointer-events:none` 双保险
- **[GC]** 频繁创建/销毁 iframe 可能导致内存碎片 → 优先复用，超时后才销毁