# layout-sync Specification

## Purpose

基座与 iframe 子应用之间的双向尺寸同步机制。基座负责宽度下发，子应用负责高度上报。通过 RAF 合并、防抖、阈值锁和强制同步兜底，彻底切断 "容器互相撑开死循环 (Infinite Resize Loop)"。

## Requirements

### Requirement: 双向尺寸同步
系统 SHALL 实现 Host→Guest 宽度下发和 Guest→Host 高度上报。

#### Scenario: Host 宽度变化同步到 Guest
- GIVEN Host 包裹容器宽度从 800px 变为 1200px
- WHEN ResizeObserver 检测到变化
- THEN 通过 Bridge notification 发送 `layout.resize {width:1200, height:containerHeight}`
- AND Guest 收到后调整内部 Canvas/组件比例

#### Scenario: Guest 内容高度变化上报到 Host
- GIVEN Guest 内部 document.body 高度从 600px 变为 900px
- WHEN Guest 侧 ResizeObserver 检测到变化
- THEN 通过 Bridge notification 发送 `layout.contentHeight {height:900}`
- AND Host 收到后调整 iframe 容器高度

### Requirement: 同帧合并
系统 SHALL 使用 `requestAnimationFrame` 合并同一帧内的多次 resize 事件。

#### Scenario: 同一帧内多次 resize 仅处理一次
- GIVEN 浏览器在同一帧内触发 3 次 resize 事件
- WHEN `requestAnimationFrame` 回调执行
- THEN 只读取最新的尺寸值
- AND 只发送 1 次 Bridge 通知

### Requirement: 防抖
系统 SHALL 对 resize 事件应用 debounce 处理。

#### Scenario: 高频 resize 被 debounce 过滤
- GIVEN 用户在 100ms 内连续拖拽窗口导致 10 次 resize 事件
- WHEN debounce 延迟为 16ms
- THEN 实际 Bridge 通知次数 ≤ 2 次

### Requirement: 5px 容差阈值
尺寸变化小于 5px 时 SHALL 跳过同步通知。

#### Scenario: 微小变化被阈值过滤
- GIVEN 当前记录的高度为 600px
- WHEN 新高度为 603px（差值 3px < 5px）
- THEN 跳过本次同步通知
- AND skipCounter 自增 1

#### Scenario: 显著变化触发同步
- GIVEN 当前记录的宽度为 800px
- WHEN 新宽度为 810px（差值 10px ≥ 5px）
- THEN 触发同步通知
- AND skipCounter 归零

### Requirement: 连续跳过强制同步兜底
连续 3 次因阈值跳过时，第 4 次 SHALL 强制同步，防止微小漂移累积。

#### Scenario: 连续 3 次跳过 → 第 4 次强制同步
- GIVEN skipCounter 为 3（已连续跳过 3 次）
- WHEN 新一次 resize 事件到达，差值 2px < 5px
- THEN 强制触发同步通知
- AND skipCounter 归零

#### Scenario: 正常同步后 skipCounter 归零
- GIVEN skipCounter 为 2
- WHEN 新一次 resize 差值 10px ≥ 5px
- THEN 触发同步通知
- AND skipCounter 归零

### Requirement: CSS 隔离
Host 包裹容器 SHALL 应用 CSS 约束防止子应用内容撑破布局。

#### Scenario: 包裹容器 CSS 约束
- GIVEN MicroAppContainer 组件渲染
- WHEN 检查包裹容器的 CSS
- THEN 包含 `overflow:hidden`
- AND 包含 `min-height:0`
- AND 包含 `contain:layout style`

#### Scenario: iframe 元素 CSS 约束
- GIVEN iframe 在包裹容器内
- WHEN 检查 iframe 的 CSS
- THEN `width:100%`
- AND `height:100%`
- AND `border:none`