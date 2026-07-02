# render-sniffer Specification

## Purpose

复合型渲染就绪探测器。判断黑盒/白盒 AI 框架 (Streamlit, Gradio, WebGL) 是否在 iframe 内部真正渲染完成，驱动骨架屏的视觉交接。支持三层降级策略：L1 Bridge 主动信号、L2 网络嗅探 (PerformanceObserver)、L3 DOM 探测 (MutationObserver)，以及超时强制兜底。

## Requirements

### Requirement: 三层探测策略
系统 SHALL 实现 L1 → L2 → L3 三层探测，任意一层触发即完成。

#### Scenario: L1 主动信号优先触发
- GIVEN 白盒应用 SDK 集成了 Bridge
- WHEN 子应用渲染完成后发送 `app.ready` notification
- THEN Sniffer 在 50ms 内调用 `onRendered({level:'L1', reason:'bridge_signal'})`
- AND L2/L3 的 Observer 被立即 disconnect

#### Scenario: L2 网络嗅探触发
- GIVEN Gradio 应用，L2 配置 `wsPattern: /queue\/join/`
- WHEN PerformanceObserver 检测到 WebSocket 连接完成
- THEN `onRendered({level:'L2', reason:'ws_handshake'})` 被调用
- AND L3 的 MutationObserver 被 disconnect

#### Scenario: L3 DOM 探测触发
- GIVEN 黑盒 Streamlit 应用，L3 配置 `domSelector: '.stApp'`
- WHEN MutationObserver 检测到 `.stApp` 元素挂载且子节点数 ≥ 1
- THEN `onRendered({level:'L3', reason:'dom_ready'})` 被调用

### Requirement: L2 跨域降级
非同源且无 `Timing-Allow-Origin` 时，L2 SHALL 自动静默降级，不产生假阳性。

#### Scenario: 跨域且无 TAO 头 → 自动降级
- GIVEN 子应用 iframe 与 Host 不同源
- AND 子应用服务器未配置 `Timing-Allow-Origin` 响应头
- WHEN PerformanceObserver 触发
- THEN timing 数据不可用（duration=0, transferSize=0）
- AND L2 自动静默降级，不触发 `onRendered`
- AND 降级记录到 `sniffer_l2_degraded{cause:'cross_origin'}`

#### Scenario: 同源或配置 TAO → L2 正常运作
- GIVEN 子应用与 Host 同源 或 配置了 `Timing-Allow-Origin`
- AND PerformanceObserver 检测到匹配的 resource timing
- THEN L2 正常触发 `onRendered`

### Requirement: 超时强制兜底
所有层级超时后 SHALL 强制调用 `onRendered`，绝不永久阻塞。

#### Scenario: 全层级超时 → 强制完成
- GIVEN L1 无信号，L2 30s 超时，L3 15s 超时
- WHEN 所有层级均超时
- THEN 强制调用 `onRendered({level:'TIMEOUT', reason:'all_layers_exhausted'})`
- AND 上报 `sniffer_timeout{framework}` counter

#### Scenario: 部分层级超时但其他层级触发
- GIVEN L3 在 12s 时触发
- WHEN L2 的 30s 超时尚未到达
- THEN `onRendered` 立即被 L3 触发
- AND L2 的 timer 被清除

### Requirement: Observer 清理
`onRendered` 触发后 SHALL 立即 disconnect 所有 Observer，防止内存泄漏。

#### Scenario: onRendered 后 Observer 全部 disconnect
- GIVEN Sniffer 已启动 L2 和 L3 的 Observer
- WHEN `onRendered` 被任意层级触发
- THEN `PerformanceObserver.disconnect()` 被调用
- AND `MutationObserver.disconnect()` 被调用
- AND 所有 timer 被 `clearTimeout`

### Requirement: 框架特征配置
系统 SHALL 支持通过 `FrameworkProfile` 配置不同框架的探测参数。

#### Scenario: Gradio 框架配置
- GIVEN 子应用为 Gradio
- WHEN 创建 Sniffer
- THEN profile 包含 `{type:'gradio', wsPattern:/queue\/join/, domSelector:'.gradio-container', domMinChildren:1}`

#### Scenario: Streamlit 框架配置
- GIVEN 子应用为 Streamlit
- WHEN 创建 Sniffer
- THEN profile 包含 `{type:'streamlit', wsPattern:/_stcore\/stream/, domSelector:'.stApp', domMinChildren:1}`

#### Scenario: Custom 框架仅 L3
- GIVEN 子应用为自定义框架
- WHEN 创建 Sniffer
- THEN profile 中 `wsPattern` 为 undefined
- AND 仅 L1 和 L3 生效

### Requirement: 支持取消探测
系统 SHALL 提供 `abort()` 方法供外部取消探测。

#### Scenario: 用户切换页面时取消探测
- GIVEN Sniffer 正在等待 L2/L3 触发
- WHEN 用户切换到其他模型应用
- THEN 调用 `abort()` → 所有 Observer disconnect + 所有 timer 清除
- AND `onRendered` 不会被调用