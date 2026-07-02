# iframe-pool Specification

## Purpose

LRU 策略的 iframe 预热池。在后台静默预加载子应用 iframe，将框架解析、JS 加载、WebSocket 握手等耗时操作前置到用户闲置时段，实现 `getSandbox()` 调用时的极速响应。管理实例生命周期，防止内存泄漏。

## Requirements

### Requirement: LRU 容量与淘汰
系统 SHALL 维护最大容量为 `maxSize`（默认 3）的预热池，按最近最少使用策略淘汰。

#### Scenario: 池未满时获取实例
- GIVEN 池中已有 2 个实例（url-A, url-B）
- WHEN 请求 url-C 的实例
- THEN 池中增加 url-C 实例
- AND 池大小为 3

#### Scenario: 池满时淘汰最久未使用
- GIVEN 池满（3 个实例），访问顺序为 url-A → url-B → url-C
- WHEN 请求 url-D 的实例
- THEN url-A（最久未使用）被销毁
- AND url-D 实例加入池中
- AND 池大小保持 3

#### Scenario: 命中 LRU 更新时间戳
- GIVEN 池中有 url-A, url-B, url-C，url-A 为最久未使用
- WHEN `getSandbox('url-A')` 被调用
- THEN url-A 的访问时间戳更新为当前时间
- AND url-A 不再是最久未使用的

### Requirement: 后台预热加载
预热实例 SHALL 使用 `position:absolute; left:-9999px` 挂载，非 `visibility:hidden` 或 `display:none`。

#### Scenario: 实例在 DOM 中但不可见
- GIVEN 调用 `pool.preload(url)`
- WHEN 查看 iframe 的 CSS 属性
- THEN `position` 为 `absolute`
- AND `left` 为 `-9999px`
- AND iframe 正常加载和解析（浏览器不降级渲染优先级）

### Requirement: 池自动补充
当实例被取出时，池 SHALL 异步补充新实例。

#### Scenario: 取出实例后自动补充
- GIVEN 池中有 3 个实例，maxSize=3
- WHEN `getSandbox()` 从池中取出 1 个实例
- THEN 池中剩余 2 个
- AND 异步触发 `preload()` 补充至 3 个

### Requirement: 实例老化清理
系统 SHALL 定期清理超过 `staleTimeoutMs`（默认 5 分钟）未使用的实例。

#### Scenario: 超时实例被销毁
- GIVEN 池中 url-A 实例最后访问时间为 6 分钟前
- WHEN `evictStaleNodes()` 定时器触发
- THEN url-A 实例被销毁：
  - `removeChild` 从 DOM 移除
  - 清空所有事件监听
  - `src` 设为 `about:blank`
- AND 池大小减 1

#### Scenario: 未超时实例保留
- GIVEN 池中 url-B 实例最后访问时间为 3 分钟前
- WHEN `evictStaleNodes()` 定时器触发
- THEN url-B 实例不受影响

### Requirement: 销毁完整性
销毁实例时 SHALL 执行完整清理流程，防止内存泄漏。

#### Scenario: 销毁实例的完整清理
- GIVEN 一个活跃的 iframe 实例
- WHEN 调用 `destroyEntry()`
- THEN 执行以下步骤：
  1. 移除所有 event listener
  2. `iframe.src = 'about:blank'`
  3. `iframe.parentNode.removeChild(iframe)`
  4. 清空对 iframe 的引用

### Requirement: 后台节能
当 `document.hidden` 为 `true` 时，系统 SHALL 暂停预加载。

#### Scenario: 页面不可见时暂停预加载
- GIVEN 用户切换到其他浏览器 tab
- WHEN `document.hidden` 变为 `true`
- THEN `preload()` 为 no-op，不产生网络请求

#### Scenario: 页面重新可见时恢复
- GIVEN 池中实例数 < maxSize 且之前因 hidden 暂停预加载
- WHEN `document.hidden` 变为 `false`
- THEN 恢复预加载逻辑

### Requirement: 池状态监控
系统 SHALL 暴露池状态用于监控和调试。

#### Scenario: 获取池状态
- GIVEN 池中有 2 个实例
- WHEN 调用 `pool.getStats()`
- THEN 返回 `{size:2, entries:[{url:"...", idleMs:120000}, ...]}`