# micro-app-container Specification

## Purpose

MicroAppContainer 是整合 Bridge SDK、LRU 预热池、布局同步和渲染嗅探的顶层组件。负责管理 iframe 子应用的全生命周期：加载、骨架屏覆盖、渲染就绪检测、视觉平滑交接、错误恢复、心跳监控和崩溃恢复。

## Requirements

### Requirement: 组件状态机
系统 SHALL 维护 `IDLE → LOADING → SNIFFING → RENDERED` 状态流转，并支持 `ERROR` 和心跳恢复路径。

#### Scenario: 正常加载流程
- GIVEN 组件初始状态为 `IDLE`
- WHEN 用户选择模型应用
- THEN 状态流转：`IDLE → LOADING → SNIFFING → RENDERED`

#### Scenario: API 错误进入 ERROR 状态
- GIVEN 组件处于 `SNIFFING` 状态
- WHEN Bridge 收到 `BRIDGE_API_ERROR` 事件
- THEN 状态变为 `ERROR`
- AND 骨架屏停止动画
- AND 展示 Error 组件（含错误信息和重试按钮）

#### Scenario: 重试回到正常流程
- GIVEN 组件处于 `ERROR` 状态
- WHEN 用户点击重试按钮
- THEN 状态变为 `LOADING`
- AND 所有 Sniffer 被重置
- AND 重新走 `LOADING → SNIFFING → RENDERED` 流程

### Requirement: 骨架屏行为
系统 SHALL 在 iframe 上方覆盖绝对定位的 Skeleton 骨架屏。

#### Scenario: 骨架屏覆盖 iframe
- GIVEN 组件进入 `LOADING` 状态
- WHEN iframe 挂载到 DOM
- THEN 绝对定位的 Skeleton 覆盖在 iframe 上方（z-index 高于 iframe）

#### Scenario: 300ms 渐隐动画
- GIVEN Sniffer 触发 `onRendered`
- WHEN 组件收到 `APP_RENDERED` 信号
- THEN Skeleton 执行 `opacity: 1→0` 渐变
- AND duration 为 `300ms`
- AND easing 为 `ease-out`

#### Scenario: 渐隐完成后移除 DOM
- GIVEN Skeleton 正在执行渐隐动画
- WHEN `transitionend` 事件触发
- THEN Skeleton 从 DOM 中移除

#### Scenario: 骨架屏超时兜底
- GIVEN 骨架屏已展示 10s
- WHEN 尚未收到 `APP_RENDERED` 信号
- THEN 强制启动渐隐动画
- AND 上报 `skeleton_timeout` 事件
- AND iframe 内容暴露（无论是否加载完成）

### Requirement: 错误展示
系统 SHALL 在 ERROR 状态下展示错误信息并提供重试。

#### Scenario: 展示授权异常错误
- GIVEN Bridge 收到 `BRIDGE_API_ERROR {status:401}`
- WHEN 组件进入 ERROR 状态
- THEN 展示 "授权异常" 错误页
- AND 包含 "重试" 按钮

#### Scenario: 重试按钮功能
- GIVEN 错误页展示中
- WHEN 用户点击重试
- THEN 所有 Sniffer 重置
- AND 状态回到 `LOADING`
- AND 重新发起 API 请求

#### Scenario: 多次重试不累积 DOM
- GIVEN 用户已点击重试 3 次
- WHEN 检查 DOM 节点数
- THEN 不产生额外的 iframe / Skeleton DOM 节点
- AND 内存不会持续增长

### Requirement: 心跳与崩溃恢复
系统 SHALL 每 5s 向子应用发送 `app.health` 心跳，连续 2 次无响应触发崩溃恢复。

#### Scenario: 心跳正常响应
- GIVEN 子应用正常运行
- WHEN Host 每 5s 发送 `app.health` 请求
- THEN Guest 返回 `{status:"ok"}`
- AND 组件保持 `RENDERED` 状态

#### Scenario: 崩溃检测与恢复
- GIVEN 子应用因 WebGL OOM 崩溃
- WHEN 连续 2 次 `app.health` 无响应（共 10s）
- THEN 判定子应用崩溃
- AND 销毁当前 iframe 实例
- AND 从预热池获取新实例或冷启动
- AND 骨架屏重新覆盖
- AND 重新走 `LOADING → SNIFFING → RENDERED` 流程
- AND 上报 `app_crash{app_id}` counter

### Requirement: 生命周期管理
系统 SHALL 在组件卸载时清理所有资源。

#### Scenario: 组件卸载时清理
- GIVEN 组件处于 `RENDERED` 状态
- WHEN 组件卸载
- THEN Bridge 断开连接
- AND 所有 Sniffer Observer disconnect
- AND 心跳停止
- AND iframe 归还预热池或销毁