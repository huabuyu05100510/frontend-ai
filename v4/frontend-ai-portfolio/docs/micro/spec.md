# Specification: 星轨 (Orbit) v2.0 — 异构微前端 iframe 沙箱架构

> **Spec v0.2** | 2026-06-12 | Status: Draft for Review
> **Motivation:** 原始 `tech.md` 缺少可验证的 spec，本文将意图转化为结构化需求。

---

## 1. Context & Constraints (上下文边界)

### 1.1 问题域边界 (Scope)

| In Scope | Out of Scope |
|---|---|
| iframe 沙箱运行时：通信、生命周期、布局同步 | 子应用（Streamlit/Gradio/WebGL）内部业务逻辑 |
| 基座侧：预热池、Token 代理、视觉交接 | 模型推理服务本身的部署与伸缩 |
| 三种框架类型：gradio / streamlit / custom | v3+ 新增框架（需另行 extension spec） |
| 同源 / 可配置 CORS 的子应用部署 | 完全跨域且不可控 origin 的场景 |

### 1.2 硬约束

| 约束 | 来源 | 应对 |
|---|---|---|
| **Cont-1:** 不可修改黑盒子应用源码 | 算法团队自主选型 | 全部适配逻辑在基座/Bridge 侧 |
| **Cont-2:** DOM/JS 物理隔离，任一子应用崩溃不影响基座 | 安全需求 | 纯 `iframe` 方案，禁用 `document.domain` 降级 |
| **Cont-3:** WebGL Context 不丢失 | GPU 加速模型（如 3D 点云） | iframe 卸载前确认无活跃 WebGL 上下文，预热池不共享 GL Context |
| **Cont-4:** Token 只存在于基座内存，不写入子应用 Cookie/localStorage | 安全审计要求 | Bridge 代理模式，CSRF token 经 Bridge 注入 HTTP Header |

### 1.3 非功能性约束 (NFR)

| ID | 约束 | Target | Measured By |
|---|---|---|---|
| **NFR-P1** | 首帧时间 (含冷启动) | P95 < 1s | `performance.now()` 从用户点击到 `APP_RENDERED` dispatch |
| **NFR-P2** | 预热池命中加载 | P95 < 300ms | 同上，但 `getSandbox()` 命中池 |
| **NFR-P3** | 布局抖动 | 0 次 > 5px 位移 | Layout Shift Observer / Chrome Performance录制 |
| **NFR-P4** | 子应用崩溃恢复 | 自动恢复 < 3s | 心跳超时 → 销毁 → 新实例加载 |
| **NFR-P5** | 主基座 frame budget | 长期 < 16ms/frame | 非 iframe 相关的 JS 执行时长 |
| **NFR-M1** | Token 泄露 | 0 | Code review + 渗透测试 |
| **NFR-M2** | 并发预热池内存 | < 150MB (3 实例) | Chrome Memory Profiler |

---

## 2. Feature Spec (功能规格)

### F1: 双向 RPC 通信总线 (Bridge SDK)

**Actor:** 基座 Host ↔ 子应用 Guest (iframe)

#### F1.1 协议
- **R1:** 通信必须遵从 JSON-RPC 2.0 语义：`{jsonrpc:"2.0", method, params, id}`。
- **R2:** 每条请求必须有唯一的 `id`（UUID v4），响应必须回传相同 `id`。
- **R3:** 支持三种消息类型：
  - `request` — 期望响应的异步调用
  - `response` — 对 request 的回复（成功 `{result}` 或错误 `{error:{code,message}}`）
  - `notification` — 单向广播，无 `id`，不期望回复

#### F1.2 调用模型
- **R4:** `Bridge.request(method, params, timeoutMs?)` 返回 `Promise<result>`。
- **R5:** 超时后 Promise reject `BridgeTimeoutError`，不会无限 pending。
- **R6:** `Bridge.on(method, handler)` 注册方法处理器。handler 返回 `Promise` 时自动 `await` 再回传结果。

#### F1.3 安全
- **R7:** 生产环境 `targetOrigin` 必须显式指定，不能为 `'*'`。
- **R8:** 收到未知 method 时，返回 JSON-RPC error `Method not found` (-32601)，不能静默吞掉。

#### F1.4 能力清单 (Host 侧暴露给 Guest 的 methods)

| Method | Direction | Description |
|---|---|---|
| `auth.getToken` | Guest → Host | 获取当前有效的 JWT/API Token |
| `api.fetch` | Guest → Host | 代理 HTTP 请求，Host 注入 Token |
| `ui.showModal` | Guest → Host | 突破 iframe 边界渲染全局弹窗 |
| `ui.showToast` | Guest → Host | 基座级 toast 通知 |

#### F1.5 能力清单 (Guest 侧暴露给 Host 的 methods)

| Method | Direction | Description |
|---|---|---|
| `app.health` | Host → Guest | 心跳检测 |
| `app.getState` | Host → Guest | 查询子应用内部路由/状态 |

#### Acceptance Criteria
- [ ] AC-F1.1: Host 调用 `bridge.request('app.health')` 返回 `{status:'ok'}` 在 100ms 内
- [ ] AC-F1.2: 模拟网络延迟 2s → `api.fetch` 在 2.5s 内返回结果（非 timeout）
- [ ] AC-F1.3: 设置 timeout=500ms → 600ms 后 Promise rejected
- [ ] AC-F1.4: 发送 `request` 但 Guest 未注册该方法 → 收到 `-32601` error
- [ ] AC-F1.5: `targetOrigin` 设为非匹配 origin → 消息被浏览器静默丢弃（手动验证 console 无日志泄露）

---

### F2: LRU 预热池 (IframePoolManager)

#### F2.1 生命周期
- **R9:** 池最大容量 `maxSize` 可配置，默认 3。
- **R10:** 淘汰策略为 LRU（最近最少使用）——即每次 `getSandbox()` 会更新访问时间戳。
- **R11:** 预热实例必须挂载在 DOM 上（`left:-9999px; position:absolute`），不可 `display:none`。
- **R12:** 实例从池中取出后，池立即补充新实例（异步 `preload`）。
- **R13:** 实例提供 `reset()` 方法，归还池前调用以清理内部状态（清空 iframe.src 再恢复）。

#### F2.2 资源控制
- **R14:** 池中实例超过 5 分钟未被使用 → 自动销毁（`evictStaleNodes`）。
- **R15:** 销毁操作必须：`removeChild` + 清空事件监听 + `src='about:blank'` + 等待 GC。
- **R16:** 当 `document.hidden` 时，暂停预加载（避免后台消耗用户资源）。

#### Acceptance Criteria
- [ ] AC-F2.1: 池满（size=3）时第 4 个不同 URL 的 `getSandbox()` → 最久未使用的实例被淘汰
- [ ] AC-F2.2: 命中池 vs 冷启动 → 时间差 ≥ 2x（证明预热有效）
- [ ] AC-F2.3: 池中实例闲置 5min → 通过 Chrome Memory timeline 观察到释放
- [ ] AC-F2.4: `document.hidden` → `preload()` no-op，不产生网络请求

---

### F3: 布局同步与防崩溃机制 (LayoutSync)

#### F3.1 尺寸同步协议
- **R17:** Host → Guest: 通过 Bridge `notification` 下发 `layout.resize {width, height}`。
- **R18:** Guest → Host: 通过 Bridge `notification` 上报 `layout.contentHeight {height}`。

#### F3.2 防无限循环 (Anti-loop)
- **R19:** 每次 resize 事件必须在 `requestAnimationFrame` 回调内处理（合并同一帧内的多次触发）。
- **R20:** 新增/旧值的差值绝对值 < `5px`（可配置 `THRESHOLD_PX`）→ **放弃**同步，不发送通知。
- **R21:** 连续 3 次因阈值放弃后，第 4 次**强制**同步一次，防止长期微小漂移。

#### F3.3 CSS 隔离
- **R22:** 基座包裹容器必须有 `overflow:hidden; min-height:0; contain:layout style;`。
- **R23:** iframe 元素本身 `width:100%; height:100%; border:none;`。

#### Acceptance Criteria
- [ ] AC-F3.1: Host 容器从 800px resize 到 1200px → Guest 在下一帧收到 `layout.resize` 且 `width=1200`
- [ ] AC-F3.2: 在 iframe 内注入 JS 连续 100 次 `resizeTo(contentHeight+3px)` → CR 锁触发，实际通知 ≤ 3 次
- [ ] AC-F3.3: 缩小 Host 宽度使 iframe 内容超出 → iframe 出现滚动条但基座布局不变形

---

### F4: 渲染就绪探测 (HybridRenderSniffer)

#### F4.1 三层探测策略

| Level | 机制 | 适用 | 超时 |
|---|---|---|---|
| **L1: 主动信号** | Bridge 接收 `app.ready` notification | 白盒 SDK 集成 | 无（被动等待） |
| **L2: 网络嗅探** | `PerformanceObserver` 监听 resource timing 中特定 URL pattern | Streamlit `/stream`, Gradio `/queue/join` | 30s |
| **L3: DOM 探测** | `MutationObserver` 监听特定 CSS selector | 所有黑盒 | 15s |

#### F4.2 决策逻辑
- **R24:** L1 触发 → 立即 `onRendered()`，忽略 L2/L3。
- **R25:** L2/L3 任一触发 → `onRendered()`，不等待其他层级。
- **R26:** 所有层级超时 → **强制** `onRendered()`（降级兜底），附带 `{reason:'timeout'}` 元数据。

#### F4.3 框架特征配置

```typescript
interface FrameworkProfile {
  type: 'gradio' | 'streamlit' | 'custom';
  wsPattern?: string;        // L2: WebSocket URL 匹配正则
  domSelector?: string;      // L3: MutationObserver 监听的目标 DOM selector
  domMinChildren?: number;   // L3: selector 下最少子节点数才视为就绪
}
```

#### F4.4 约束
- **R27:** L2（PerformanceObserver）仅在同源或 CORS 配置了 `Timing-Allow-Origin` 时有效。跨域且无配置时自动降级到 L3。
- **R28:** Observer 在 `onRendered()` 触发后立即 disconnect。

#### Acceptance Criteria
- [ ] AC-F4.1: 白盒 SDKBridge 发送 `app.ready` → Host 在 50ms 内收到并触发 Skeleton 渐隐
- [ ] AC-F4.2: Gradio 应用 WebSocket `/queue/join` 完成 → L2 触发，L1 无信号也正确 onRendered
- [ ] AC-F4.3: 黑盒 custom 应用 15s 内未出现目标 DOM → timeout 后强制 onRendered
- [ ] AC-F4.4: onRendered 后 → MutationObserver/PerformanceObserver 已 disconnect（验证无内存泄漏）

---

### F5: 视觉交接组件 (MicroAppContainer)

#### F5.1 组件状态机

```
IDLE → LOADING → SNIFFING → RENDERED
                  ↓ (error)
                ERROR

Session Persistence:
  BUSY → PAUSED → RESUMED → RENDERED (切换 tab 后恢复快照)
```

#### F5.2 骨架屏行为
- **R29:** `<iframe>` 挂载后立即覆盖绝对定位 Skeleton（z-index 高于 iframe）。
- **R30:** `onRendered` 触发 → Skeleton 执行 `opacity: 1→0` 渐变，duration `300ms`，easing `ease-out`。
- **R31:** 渐变完成后 `transitionend` 事件 → 移除 Skeleton DOM 节点。
- **R32:** 骨架屏展示超时（默认 10s → 兜底渐隐）+ 日志上报 `skeleton_timeout`。

#### F5.3 错误态
- **R33:** Bridge 收到 `api.fetch` error → 骨架屏停止动画，展示 Error 组件（含 "重试" 按钮）。
- **R34:** 重试时重置所有 Sniffer，重新走 `LOADING → SNIFFING → RENDERED`。

#### Acceptance Criteria
- [ ] AC-F5.1: 视觉 300ms 渐隐 → 人眼感知为平滑过渡，无闪烁
- [ ] AC-F5.2: 骨架屏 10s 超时 → opacity 渐隐，iframe 内容暴露（无论是否加载完）
- [ ] AC-F5.3: `api.fetch` 返回 401 → error 组件展示 "授权异常"，有重试按钮
- [ ] AC-F5.4: 重复点击重试 3 次均失败 → 不累积 DOM 节点，不内存泄漏

---

## 3. Traceability Matrix (需求追溯矩阵)

| Feature | Req IDs | 对应 `tech.md` 章节 | 状态 |
|---|---|---|---|
| Bridge SDK | R1–R8 | §5.1 + §3 核心1 | ✅ spec'ed |
| LRU Pool | R9–R16 | §5.2 + §3 核心2 | ✅ spec'ed |
| LayoutSync | R17–R23 | §3 核心3 + §6 | ✅ spec'ed |
| RenderSniffer | R24–R28 | §5.3 + §3 核心4 | ✅ spec'ed |
| MicroAppContainer | R29–R34 | §4 时序图 + §3 核心4 | ✅ spec'ed |

---

## 4. Explicit Non-Goals (明确不做)

1. **不做** Web Component / Module Federation 方案（已有明确 iframe 架构决策）
2. **不做** 子应用间的直接通信（Guest ↔ Guest — 统一走 Host 中转）
3. **不做** SSR/SSG 预渲染 iframe 内容
4. **不做** Safari ≤ 15 兼容（`contain: layout style` 不支持）
5. **不做** 离线/Service Worker 缓存策略（v3 考虑）

---

## 5. Changes from tech.md (主要变更记录)

| # | 变更 | 原因 |
|---|---|---|
| 1 | JSON-RPC 2.0 增加 `jsonrpc` 版本字段 & notification 类型 | 原协议缺版本号，RPC 客户端库无法做兼容判断 |
| 2 | `targetOrigin` 禁止 `'*'` 生产 | 安全审计要求 |
| 3 | 防死循环新增 "3次跳过强制同步" 兜底 | 原文档只有阈值，长时间微小漂移无解 |
| 4 | L2 嗅探降级自动检测（跨域 & Timing-Allow-Origin） | 原文档假设 `PerformanceObserver` 总能拿到 WS timing，实际非同源不可用 |
| 5 | 骨架屏 10s 超时 + 上报 | 原文档只有超时强制 resolve，缺监控埋点 |
| 6 | `left:-9999px` 替代 `visibility:hidden` | `visibility:hidden` 可能导致浏览器 deprioritize 解析，预热失去意义 |
| 7 | 移除附录 "交给大模型生成代码的 System Prompts" | 不是 spec 内容，LLM Prompts 应单独管理在 prompt 仓库 |