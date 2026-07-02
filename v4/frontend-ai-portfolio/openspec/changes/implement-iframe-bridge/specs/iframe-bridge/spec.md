## ADDED Requirements

### Requirement: JSON-RPC 2.0 协议规范
系统 SHALL 严格遵循 JSON-RPC 2.0 规范封装 postMessage 通信。每条消息携带 `jsonrpc:"2.0"` 版本号，支持 Request（含 id + method）、Response（含 id + result/error）和 Notification（无 id）三种类型。

#### Scenario: 发起 RPC 请求并收到成功响应
- **WHEN** Host 调用 `bridge.request('app.health', {})`
- **THEN** 发送消息体 `{jsonrpc:"2.0", id:<UUID>, method:"app.health", params:{}}`
- **AND** Guest 处理后返回 `{jsonrpc:"2.0", id:<相同UUID>, result:{status:"ok"}}`
- **AND** Host 的 Promise resolve 为 `{status:"ok"}`

#### Scenario: 发送单向通知不等待响应
- **WHEN** Host 调用 `bridge.notify('layout.resize', {width:1200})`
- **THEN** 消息体不含 id 字段
- **AND** 不创建 Promise，不等待任何响应

#### Scenario: 收到未注册 method 返回标准错误
- **WHEN** Host 收到 method 为 `unknown.method` 的 Request
- **AND** 该 method 未通过 `bridge.on()` 注册 handler
- **THEN** 返回 `{jsonrpc:"2.0", id:<原id>, error:{code:-32601, message:"Method not found"}}`

### Requirement: 超时熔断
request 调用 SHALL 支持可配置超时，超时后 reject `BridgeTimeoutError`，且忽略该 id 后续到达的响应。

#### Scenario: 请求在超时内完成
- **WHEN** `bridge.request('api.fetch', params, 5000)` 调用后 Guest 在 3000ms 内返回
- **THEN** Promise resolve 为正常 result

#### Scenario: 超时后 reject
- **WHEN** `bridge.request('api.fetch', params, 500)` 调用后 Guest 在 600ms 内未响应
- **THEN** Promise reject 为 `BridgeTimeoutError`
- **AND** 该 id 后续到达的响应被静默丢弃

### Requirement: 安全 origin 校验
生产环境 SHALL 显式指定 `targetOrigin`，构造函数不提供默认值。

#### Scenario: targetOrigin 显式传入
- **WHEN** 构造 `new IframeBridge(iframe.contentWindow, 'https://models.example.com')`
- **THEN** 所有 `postMessage` 调用使用 `targetOrigin='https://models.example.com'`

#### Scenario: origin 不匹配导致握手超时
- **WHEN** `targetOrigin` 与实际 iframe origin 不一致
- **THEN** `handshake()` 在默认超时后 reject `BridgeTimeoutError`
- **AND** console 输出 warning 含 `targetOrigin` 值

### Requirement: 版本协商握手
Bridge 初始化时 SHALL 执行 `handshake()` 握手，确认双方版本兼容并交换能力列表。

#### Scenario: 握手成功
- **WHEN** Host 调用 `bridge.handshake()`
- **AND** Guest Bridge 版本为 `"2.0"`
- **THEN** Promise resolve `{version:"2.0", capabilities:["app.health","app.ready",...]}`

#### Scenario: 版本不兼容
- **WHEN** Host 版本 `"3.0"` 与 Guest 版本 `"2.0"` 不兼容
- **THEN** `handshake()` reject
- **AND** Host 记录 error 日志

### Requirement: 动态能力注册与移除
系统 SHALL 支持 `on(method, handler)` 注册和 `off(method)` 移除方法处理器。

#### Scenario: 注册后方法可被调用
- **WHEN** Guest 调用 `bridge.on('app.health', async () => ({status:'ok'}))`
- **AND** Host 调用 `bridge.request('app.health')`
- **THEN** Guest handler 被执行，返回 `{status:'ok'}`

#### Scenario: 移除后方法不可达
- **WHEN** Guest 先注册 handler 再调用 `bridge.off('app.health')`
- **AND** Host 调用 `bridge.request('app.health')`
- **THEN** Guest 返回 `{error:{code:-32601, message:"Method not found"}}`

### Requirement: 标准错误码
系统 SHALL 使用 JSON-RPC 标准错误码体系 + 自定义扩展 `-32000` (Timeout) 和 `-32001` (Origin Blocked)。

#### Scenario: 各类错误返回对应错误码
- **WHEN** 发生 Parse Error
- **THEN** 返回 `error.code = -32700`
- **WHEN** 请求超时
- **THEN** reject `BridgeTimeoutError` 含 `code: -32000`
- **WHEN** handshake 因 origin 被浏览器阻止
- **THEN** 错误含 `code: -32001`

### Requirement: 预定义能力清单
系统 SHALL 预定义 Host 侧和 Guest 侧的标准 method 枚举。

#### Scenario: Host 侧方法
- **WHEN** 子应用需要鉴权 Token
- **THEN** 调用 `bridge.request('auth.getToken')` → Host 返回 JWT

#### Scenario: Guest 侧方法
- **WHEN** 基座需要检测子应用存活
- **THEN** 调用 `bridge.request('app.health')` → Guest 返回 `{status:'ok'}`

### Requirement: Bridge 销毁清理
系统 SHALL 提供 `destroy()` 方法清除所有 handler、移除 message listener、拒绝所有 pending Promise。

#### Scenario: 组件卸载时销毁 Bridge
- **WHEN** 调用 `bridge.destroy()`
- **THEN** 移除 `window.removeEventListener('message', ...)`
- **AND** 清空所有注册的 handler
- **AND** 所有 pending 的 request Promise reject `BridgeDestroyedError`