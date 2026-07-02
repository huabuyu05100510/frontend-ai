## 1. 项目结构与类型定义

- [x] 1.1 创建 `src/bridge/` 目录结构
- [x] 1.2 实现 `src/bridge/types.ts`：JsonRpcRequest, JsonRpcSuccessResponse, JsonRpcErrorResponse, JsonRpcNotification, JsonRpcMessage 类型定义
- [x] 1.3 实现 `src/bridge/constants.ts`：HostMethods 枚举, GuestMethods 枚举, BridgeErrorCode 枚举, BRIDGE_PROTOCOL_VERSION 常量

## 2. 错误体系

- [x] 2.1 实现 `src/bridge/errors.ts`：BridgeTimeoutError（code: -32000）, BridgeOriginBlockedError（code: -32001）, BridgeDestroyedError（code: -32002）

## 3. 核心 IframeBridge 类

- [x] 3.1 实现构造函数：接收 `(targetWindow, targetOrigin)`，创建 `message` 事件监听，初始化 pendingRequests Map 和 handlers Map
- [x] 3.2 实现 `generateId()`：UUID v4 生成器
- [x] 3.3 实现 `handleMessage()`：解析消息 → 区分 Request/Response/Notification → 路由到 handler 或 resolve pending Promise
- [x] 3.4 实现 `request<T>(method, params?, timeoutMs?)`：构建 JsonRpcRequest → pendingRequests.set(id, {resolve, reject, timer}) → postMessage → 返回 Promise<T>
- [x] 3.5 实现 `notify(method, params?)`：构建 JsonRpcNotification（无 id）→ postMessage
- [x] 3.6 实现 `on(method, handler)`：handlers.set(method, handler)
- [x] 3.7 实现 `off(method)`：handlers.delete(method)
- [x] 3.8 实现 `handshake()`：发送 bridge.handshake request → 校验版本 → 返回 capabilities

## 4. 超时与清理

- [x] 4.1 实现 `clearRequest(id)`：clearTimeout + pendingRequests.delete(id)
- [x] 4.2 在 request() 中集成超时：`setTimeout` → reject BridgeTimeoutError → clearRequest
- [x] 4.3 实现 `destroy()`：removeEventListener + 清空所有 handlers + reject 所有 pending promises 为 BridgeDestroyedError

## 5. 异常处理

- [x] 5.1 handleMessage 中 try/catch 包裹 JSON.parse → Parse Error 返回 -32700
- [x] 5.2 handleMessage 中未注册 method → 返回 -32601
- [x] 5.3 handleMessage 中 handler 执行异常 → 返回 -32603 Internal error
- [x] 5.4 handleMessage 中消息格式校验（缺少 jsonrpc 字段等）→ 返回 -32600 Invalid Request

## 6. 测试

- [x] 6.1 单元测试：request/response 正常通信流程
- [x] 6.2 单元测试：notification 单向广播（验证无 id、无响应）
- [x] 6.3 单元测试：超时熔断（Promise.race + jest.useFakeTimers）
- [x] 6.4 单元测试：Method Not Found (-32601)
- [x] 6.5 单元测试：on/off 动态注册和移除
- [x] 6.6 单元测试：handshake 版本协商
- [x] 6.7 单元测试：destroy 清理验证（handler 清空、pending reject）
- [x] 6.8 单元测试：targetOrigin 不匹配场景