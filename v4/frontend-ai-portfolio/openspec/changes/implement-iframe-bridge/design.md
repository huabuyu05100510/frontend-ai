## Context

星轨 Orbit v2.0 需要基座 (Host) 与 iframe 子应用 (Guest) 之间进行多种双向通信：Token 获取、API 代理、UI 越权（弹窗/Toast）、尺寸同步、健康检查等。`postMessage` 是浏览器原生支持的跨 iframe 通信 API，但其本身是单向、无类型、无超时机制的消息通道。需要在 `postMessage` 之上构建一层轻量 RPC 协议。

当前项目处于初始化阶段，无任何 Bridge 实现。该模块是后续所有模块的基础依赖。

## Goals / Non-Goals

**Goals:**
- 实现 JSON-RPC 2.0 规范的 Request/Response/Notification 三种消息类型
- Promise 化异步调用，支持类型推断（泛型）
- 超时熔断，默认 30s，可配置
- 生产环境 `targetOrigin` 强制显式指定（安全要求）
- 版本协商握手 `handshake()`
- 动态能力注册/移除 `on()` / `off()`
- 标准 JSON-RPC 错误码 + 自定义扩展（Timeout, Origin Blocked）

**Non-Goals:**
- 不做二进制数据传输（v1 只传 JSON）
- 不做消息队列/重试机制
- 不做 message batching（单条单发）
- 不处理 iframe 本身的创建/销毁（那是 Pool 的职责）

## Decisions

### Decision 1: JSON-RPC 2.0 而非自定义协议

**选择:** 严格遵循 JSON-RPC 2.0 规范
**理由:**
- 业界标准，未来可接入现成的 JSON-RPC 工具链（调试、测试、mock）
- 消息结构自带 `jsonrpc` 版本号，协议升级时可做兼容判断
- `method`/`params` 语义清晰，区别于 `postMessage` 原始字段
- 标准错误码体系（-32700 ~ -32603）减少沟通成本

**替代方案:**
- 自定义 `{action, payload}` 协议：简单但缺少版本号，未来无法平滑升级
- 基于 MessageChannel API：浏览器兼容性不如 postMessage

### Decision 2: 每个 Bridge 实例绑定单个 targetWindow

**选择:** 构造函数接收 `(targetWindow, targetOrigin)`，1 Bridge ↔ 1 iframe
**理由:**
- 每个子应用有独立的 origin 和生命周期
- `on()` 注册的 handler 作用域天然隔离，无需在消息路由中做 namespace 分发
- 销毁时只需 disconnect 一个 window 的关系

**替代方案:**
- 单例 Bridge 管理所有 iframe：需要消息 namespace 路由，复杂度高

### Decision 3: 超时机制在调用侧实现

**选择:** `Promise.race` + `setTimeout`，超时后 reject `BridgeTimeoutError`
**理由:**
- 超时 Promsie reject 后，忽略该 id 后续到达的响应（旧响应不会 resolve 已拒绝的 Promise）
- 不需要全局 timer 管理器，实现简单

**替代方案:**
- 全局超时管理器统一清理：过度设计，当前场景 unnecessary

### Decision 4: `targetOrigin` 不设默认值

**选择:** 构造函数强制要求显式传入 `targetOrigin`
**理由:**
- `'*'` 在生产环境是安全漏洞（任何页面都可以接收消息）
- 开发环境下可以通过环境变量 `TARGET_ORIGIN` 注入，不影响 DX
- 编译时 TypeScript 强制，不会遗漏

**替代方案:**
- 默认 `'*'` + 生产构建时替换：依赖构建工具配置，不够直接

### Decision 5: 版本协商通过握手实现

**选择:** `handshake()` 发送 `{jsonrpc:"2.0", method:"bridge.handshake", params:{version:"2.0"}}`
**理由:**
- 初始化时即可发现版本不兼容，fail fast
- 响应中携带 `capabilities` 列表，供 Host 侧做能力检测

## Risks / Trade-offs

- **[兼容性]** iOS Safari ≤ 15 对 `postMessage` 的 `targetOrigin` 校验更严格 → 使用 `'*'` 仅限本地开发 localhost
- **[内存泄漏]** 如果 `on()` 注册的 handler 闭包持有外部引用 → Bridge 暴露 `destroy()` 方法清除所有 handler
- **[消息丢失]** 浏览器可能静默丢弃不匹配 origin 的消息 → `handshake()` 超时机制可以探测此问题
- **[时序问题]** Guest iframe 尚未加载完成时 Host 发送消息 → 消息可能丢失。解决方案：Pool 预加载 + Bridge 初始化后 Guest 主动发送 `bridge.ready` 通知