# iframe-bridge Specification

## Purpose

双向 JSON-RPC 2.0 通信总线。封装 `postMessage` 实现基座 (Host) 与子应用 (Guest iframe) 之间的 Promise 异步 RPC 调用，支持超时熔断、版本协商、安全 origin 校验。提供统一的消息类型（Request / Response / Notification）和标准错误码。

## Requirements

### Requirement: JSON-RPC 2.0 协议规范
系统 SHALL 严格遵循 JSON-RPC 2.0 规范封装 postMessage 通信。

#### Scenario: 发起 RPC 请求并收到响应
- GIVEN Host 与 Guest 已通过 Bridge 建立连接
- WHEN Host 调用 `bridge.request('app.health', {})`
- THEN 发送消息体包含 `{jsonrpc:"2.0", id:<UUID>, method:"app.health", params:{}}`
- AND Guest 处理后返回 `{jsonrpc:"2.0", id:<same UUID>, result:{status:"ok"}}`
- AND Host 的 Promise resolve 为 `{status:"ok"}`

#### Scenario: 发送单向通知
- GIVEN 尺寸同步场景
- WHEN Host 调用 `bridge.notify('layout.resize', {width:1200, height:800})`
- THEN 发送消息体包含 `{jsonrpc:"2.0", method:"layout.resize", params:{...}}`
- AND 消息中 **不包含** id 字段
- AND 不等待任何响应

#### Scenario: 收到未注册的 method
- GIVEN Host 收到了一个未注册 method 的 Request
- WHEN Host 的 Bridge 无法匹配任何 handler
- THEN 返回 `{jsonrpc:"2.0", id:<原id>, error:{code:-32601, message:"Method not found"}}`

### Requirement: 超时熔断
系统 SHALL 在请求超时后拒绝 Promise，防止无限 pending。

#### Scenario: 请求在超时时间内完成
- GIVEN 调用 `bridge.request('api.fetch', params, 5000)`
- WHEN Guest 在 3000ms 内返回结果
- THEN Promise resolve 为正常结果

#### Scenario: 请求超时
- GIVEN 调用 `bridge.request('api.fetch', params, 500)`
- WHEN Guest 在 600ms 内未响应
- THEN Promise reject 为 `BridgeTimeoutError`
- AND 超时 Promise 不再响应后续到达的消息

### Requirement: 安全 origin 校验
生产环境 SHALL 显式指定 `targetOrigin`，禁止通配符。

#### Scenario: 生产环境 origin 匹配
- GIVEN `targetOrigin` 配置为 `"https://models.example.com"`
- WHEN 调用 `bridge.request(...)`
- THEN `postMessage` 的 `targetOrigin` 参数为 `"https://models.example.com"`

#### Scenario: origin 不匹配导致消息被丢弃
- GIVEN `targetOrigin` 配置为 `"https://valid.example.com"`
- WHEN 子应用的实际 origin 为 `"https://other.example.com"`
- THEN 消息被浏览器静默丢弃
- AND `handshake()` 超时 → reject `BridgeTimeoutError`

### Requirement: 版本协商
Bridge 初始化时 SHALL 执行握手协议，确认双方版本兼容。

#### Scenario: 版本兼容握手成功
- GIVEN Host Bridge 版本为 `"2.0"`
- WHEN Guest Bridge 版本同样为 `"2.0"`
- THEN `handshake()` 返回 `{version:"2.0", capabilities:["auth.getToken","api.fetch",...]}`

#### Scenario: 版本不兼容
- GIVEN Host Bridge 版本为 `"3.0"`
- WHEN Guest Bridge 版本为 `"2.0"`（不兼容）
- THEN `handshake()` reject
- AND Host 侧记录 warning 日志

### Requirement: 能力注册
Bridge SHALL 支持动态注册和移除方法处理器。

#### Scenario: 注册方法处理器
- GIVEN Guest 侧 Bridge 初始化完成
- WHEN Guest 调用 `bridge.on('app.health', handler)`
- THEN Host 可通过 `bridge.request('app.health')` 调用该 handler

#### Scenario: 移除方法处理器
- GIVEN `bridge.on('app.health', handler)` 已注册
- WHEN Guest 调用 `bridge.off('app.health')`
- THEN 后续 `bridge.request('app.health')` 返回 `-32601 Method not found`

### Requirement: 标准错误码
系统 SHALL 使用 JSON-RPC 标准错误码 + 自定义扩展。

#### Scenario: 各类错误返回对应错误码
- GIVEN 不同错误场景
- WHEN 发生错误
- THEN 返回标准错误码：
  - `-32700` Parse error
  - `-32600` Invalid Request
  - `-32601` Method not found
  - `-32602` Invalid params
  - `-32603` Internal error
  - `-32000` Timeout (自定义)
  - `-32001` Target Origin Blocked (自定义)