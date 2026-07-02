## ADDED Requirements

### Requirement: LRU 容量与淘汰
系统 SHALL 维护最大容量为 `maxSize`（默认 3）的预热池，按最近最少使用策略淘汰。Pool 内部使用 `Map<string, PoolEntry>` 存储，key 为 url，entry 包含 `lastAccessedAt` 时间戳。

#### Scenario: 池未满时获取实例
- **WHEN** 池中有 2 个实例，请求第 3 个不同 url 的实例
- **THEN** 池中增加新实例，size 变为 3

#### Scenario: 池满时淘汰最久未使用
- **WHEN** 池满（3 个实例），访问顺序为 url-A → url-B → url-C
- **AND** 请求 url-D 的实例
- **THEN** url-A（最久未使用）被销毁
- **AND** url-D 实例加入池中
- **AND** 池大小保持 3

#### Scenario: 命中 LRU 更新时间戳
- **WHEN** `getSandbox('url-A')` 被调用且 url-A 在池中
- **THEN** url-A 的 `lastAccessedAt` 更新为当前时间
- **AND** url-A 不再是淘汰候选

### Requirement: 后台预热加载
预热实例 SHALL 使用 `position:absolute; left:-9999px; opacity:0; pointer-events:none` 挂载到 `document.body`，确保浏览器正常解析但不显示、不可交互。

#### Scenario: 实例以不可见方式挂载
- **WHEN** 调用 `pool.preload(url)`
- **THEN** iframe 的 CSS 包含 `position:absolute; left:-9999px; opacity:0; pointer-events:none`
- **AND** iframe 在 DOM 中正常加载（浏览器不降级渲染优先级）

#### Scenario: iframe 挂载到 document.body
- **WHEN** 调用 `pool.preload(url)`
- **THEN** iframe 通过 `document.body.appendChild()` 挂载到 DOM

### Requirement: 池自动补充
当实例被 `getSandbox()` 取出时，池 SHALL 异步触发 `preload()` 补充至 `maxSize`。

#### Scenario: 取出实例后自动补充
- **WHEN** 池中有 3 个实例且 `getSandbox()` 取出 1 个
- **THEN** 池中剩余 2 个
- **AND** 异步调用 `preload()` 补充至 3 个

#### Scenario: 池未满时不需要补充
- **WHEN** 池中已有 2 个实例且 maxSize=3
- **AND** 没有正在进行的补充操作
- **THEN** 不触发额外的 `preload()`

### Requirement: 实例老化清理
系统 SHALL 每隔 60s 运行 `evictStaleNodes()`，销毁超过 `staleTimeoutMs`（默认 5 分钟）未使用的实例。

#### Scenario: 超时实例被销毁
- **WHEN** url-A 实例的 `lastAccessedAt` 为 6 分钟前
- **AND** `evictStaleNodes()` 定时器触发
- **THEN** url-A 实例被销毁
- **AND** 池大小减 1

#### Scenario: 未超时实例保留
- **WHEN** url-B 实例的 `lastAccessedAt` 为 3 分钟前
- **AND** `evictStaleNodes()` 定时器触发
- **THEN** url-B 实例不受影响

### Requirement: 销毁完整性
销毁实例时 SHALL 执行完整清理流程：1) 移除所有 event listener，2) 设置 `src='about:blank'`，3) `removeChild` 从 DOM 移除，4) 清空引用。

#### Scenario: 销毁实例的完整清理
- **WHEN** 调用 `destroyEntry(entry)`
- **THEN** 执行步骤：
  - `iframe.src = 'about:blank'`
  - `iframe.parentNode?.removeChild(iframe)`
  - 清空 entry 引用

### Requirement: 后台节能
当 `document.hidden` 为 `true` 时，`preload()` SHALL 为 no-op，不产生网络请求。

#### Scenario: 页面不可见时暂停预加载
- **WHEN** `document.hidden` 为 `true`
- **AND** 调用 `pool.preload(url)`
- **THEN** 不创建 iframe，不发起网络请求

#### Scenario: 页面重新可见时恢复
- **WHEN** `document.hidden` 变为 `false`
- **AND** 池中实例数 < maxSize 且之前因 hidden 暂停预加载
- **THEN** 恢复预加载逻辑

### Requirement: 池状态监控
系统 SHALL 暴露 `getStats()` 接口，返回当前池大小、各实例 url 和空闲时长。

#### Scenario: 获取池状态
- **WHEN** 池中有 2 个实例
- **AND** 调用 `pool.getStats()`
- **THEN** 返回 `{size:2, maxSize:3, entries:[{url:"...", idleMs:120000}, ...]}`

### Requirement: Pool 生命周期管理
系统 SHALL 提供 `destroy()` 方法，销毁所有池中实例并清除定时器。

#### Scenario: destroy 清理所有资源
- **WHEN** 调用 `pool.destroy()`
- **THEN** 所有池中实例被销毁
- **AND** `evictStaleNodes` 定时器被 `clearInterval`
- **AND** 池 entries Map 被清空