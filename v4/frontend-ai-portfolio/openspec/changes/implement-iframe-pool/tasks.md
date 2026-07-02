## 1. 项目结构

- [x] 1.1 创建 `src/pool/` 目录和 `src/pool/__tests__/` 目录

## 2. 类型定义

- [x] 2.1 实现 `PoolEntry` 接口：`{ url, iframe, lastAccessedAt }`
- [x] 2.2 实现 `PoolStats` 接口：`{ size, maxSize, entries }`
- [x] 2.3 实现 `PoolOptions` 接口：`{ maxSize?, staleTimeoutMs?, evictIntervalMs? }`

## 3. 核心 IframePoolManager 类

- [x] 3.1 实现构造函数：初始化 `maxSize`, `staleTimeoutMs`, entries Map，启动 evict 定时器
- [x] 3.2 实现 `preload(url)`：创建 iframe → 设置 CSS（`position:absolute; left:-9999px; opacity:0; pointer-events:none`）→ `document.body.appendChild` → 放入 entries Map
- [x] 3.3 实现 `preload()` 中的 `document.hidden` 检查：hidden 时为 no-op
- [x] 3.4 实现 `getSandbox(url)`：查 Map 命中 → 更新 `lastAccessedAt` → 从池中移除 → 异步补充 → 返回 iframe；未命中 → 新建 iframe 并返回
- [x] 3.5 实现 LRU 淘汰：池满时遍历 entries 找最小 `lastAccessedAt` → 销毁该 entry → 加入新 entry
- [x] 3.6 实现 `releaseSandbox(iframe, url)`：重置 iframe（`src='about:blank'` → 恢复 `src=url`）→ 更新 `lastAccessedAt` → 放回池中

## 4. 生命周期与清理

- [x] 4.1 实现 `evictStaleNodes()`：遍历 entries → 检查 `Date.now() - lastAccessedAt > staleTimeoutMs` → 销毁超时实例
- [x] 4.2 实现 `destroyEntry(entry)`：`iframe.src = 'about:blank'` → `iframe.parentNode.removeChild(iframe)` → 清空引用
- [x] 4.3 实现 `destroy()`：清除 evict 定时器 → 销毁所有 entries → 清空 Map

## 5. 监控

- [x] 5.1 实现 `getStats()`：返回 `{ size, maxSize, entries: [{url, idleMs}] }`

## 6. 测试

- [x] 6.1 单元测试：preload 创建 iframe 并挂载到 DOM
- [x] 6.2 单元测试：getSandbox 命中池 → 返回预热实例
- [x] 6.3 单元测试：getSandbox 未命中 → 新建实例
- [x] 6.4 单元测试：LRU 淘汰（池满时淘汰最久未使用）
- [x] 6.5 单元测试：命中后自动补充
- [x] 6.6 单元测试：老化清理（超过 5min 的实例被销毁）
- [x] 6.7 单元测试：document.hidden 时 preload 为 no-op
- [x] 6.8 单元测试：destroy 清理所有实例和定时器
- [x] 6.9 单元测试：getStats 返回正确的池状态
- [x] 6.10 单元测试：releaseSandbox 重置并归还实例