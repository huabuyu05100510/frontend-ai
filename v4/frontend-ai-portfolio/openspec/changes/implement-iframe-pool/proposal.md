## Why

Streamlit / Gradio 等 Python AI 框架的 iframe 冷启动时间长达 5s+（HTML 解析 + JS 加载 + WebSocket 握手），严重拖慢用户切换模型时的首帧体验。通过 LRU 策略在后台静默预加载和预热 iframe 实例，将用户感知的加载时间从 5s 降至 300ms 以内（命中池时）。Bridge SDK 已就绪，Pool 是第二个核心模块。

## What Changes

- 新增 `IframePoolManager` 类，管理 LRU 策略的 iframe 预热池
- 默认容量 `maxSize: 3`，按最近最少使用（LRU）淘汰
- 后台预热使用 `position:absolute; left:-9999px` 挂载 iframe（非 `visibility:hidden`）
- 实例取出后自动异步补充 `preload()`
- 闲置超过 5 分钟的实例自动销毁（`evictStaleNodes`）
- 销毁流程：`removeChild` + 清空 listener + `src='about:blank'`
- `document.hidden` 时暂停预加载，避免后台消耗资源
- 暴露 `getStats()` 接口用于监控

## Capabilities

### New Capabilities
- `iframe-pool`: LRU 策略的 iframe 预热池，负责子应用 iframe 的静默预加载、按需分配、老化清理和生命周期管理，已通过 Bridge SDK 握手验证的实例优先复用

### Modified Capabilities
<!-- None -->

## Impact

- 新增文件：`src/pool/IframePoolManager.ts`
- 新增文件：`src/pool/__tests__/IframePoolManager.test.ts`
- 新增文件：`src/pool/index.ts`
- 依赖：`src/bridge/IframeBridge.ts`（已实现）— Pool 通过 Bridge 进行握手验证
- 被依赖：`micro-app-container`（顶层容器组件）