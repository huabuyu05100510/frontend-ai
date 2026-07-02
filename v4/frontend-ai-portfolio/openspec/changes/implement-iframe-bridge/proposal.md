## Why

当前项目没有可用的跨 iframe 通信基础设施。各子应用（Streamlit/Gradio/WebGL）需要与基座进行 Token 获取、API 代理、UI 越权和尺寸同步等双向通信，但缺少统一的、类型安全的、支持超时熔断的 RPC 总线。JSON-RPC 2.0 协议封装是后续所有模块（预热池、布局同步、渲染嗅探）的依赖基础，必须先落地。

## What Changes

- 新增 `IframeBridge` 类，基于 JSON-RPC 2.0 规范封装 `postMessage`
- 支持三种消息类型：Request（需响应）、Response（携带 result/error）、Notification（单向广播）
- 实现 Promise 化的异步 RPC 调用 `bridge.request(method, params, timeoutMs?)`
- 实现超时熔断机制 `BridgeTimeoutError`
- 实现 `bridge.on(method, handler)` / `bridge.off(method)` 动态能力注册
- 实现 `bridge.handshake()` 版本协商握手
- 生产环境强制显式 `targetOrigin`，禁用 `'*'` 通配符
- 收到未注册 method 时返回标准 JSON-RPC error `-32601`
- 预定义 Host 侧能力清单（`auth.getToken`, `api.fetch`, `ui.showModal`, `ui.showToast`）和 Guest 侧能力清单（`app.health`, `app.ready`, `layout.contentHeight`, `app.getState`）

## Capabilities

### New Capabilities
- `iframe-bridge`: JSON-RPC 2.0 双向通信总线，封装 postMessage 实现基座与子应用之间的 Promise 异步 RPC 调用，支持超时熔断、版本协商、安全 origin 校验

### Modified Capabilities
<!-- None - this is the first implementation -->

## Impact

- 新增文件：`src/bridge/IframeBridge.ts`（核心实现）
- 新增文件：`src/bridge/types.ts`（协议类型定义）
- 新增文件：`src/bridge/errors.ts`（BridgeTimeoutError 等自定义错误）
- 新增文件：`src/bridge/constants.ts`（方法枚举、错误码常量）
- 依赖：无外部依赖，仅使用 `postMessage` API
- 被依赖：`iframe-pool`, `layout-sync`, `render-sniffer`, `micro-app-container` 均依赖 Bridge