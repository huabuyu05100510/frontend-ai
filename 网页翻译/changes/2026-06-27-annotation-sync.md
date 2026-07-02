# 变更记录 — 标注功能 Phase M3 后台同步层

> **日期**：2026-06-27
> **模型**：claude-sonnet-4-6（MiniMax-M3 路由）
> **类型**：新功能（落地 tech-plan §4.3 + §5）
> **对标**：百度翻译 / 沉浸式翻译 的离线优先 + 最佳努力同步
> **影响范围**：扩展 background 同步层 + IDB → NestJS 链路

---

## 1. 为什么这次

标注功能 M1/M2（schema + IDB + UI）已就绪，但**采集的数据还困在浏览器本地**。
没有同步层就无法进入训练数据闭环（Phase 8 alignment head 微调）。

本次实现扩展后台 → 后端 ingest 端点的端到端批量同步：
- MV3 兼容（Service Worker 休眠 → chrome.alarms）
- 离线优先（失败退避，下次自动重试）
- 幂等（后端 INSERT OR IGNORE + 前端 markSynced 事务）

---

## 2. 交付文件

| 文件 | 行数 | 说明 |
|---|---|---|
| `extension/src/background/sync.ts` | 437 | 后台同步模块：flushBatch + 退避 + 多触发源 |
| `extension/test/sync.test.ts` | 412 | vitest 单元测试（19 cases） |
| `test/sync.e2e.test.mjs` | 388 | playwright e2e（4 cases，真起 NestJS） |
| `extension/src/shared/types.ts` | +2 | ExtensionMessage 加 `XT_FORCE_SYNC` / `XT_TEST_SEED` |
| `extension/manifest.json` | +1 | permissions 加 `alarms` |
| `extension/vite.config.ts` | +15 | `copyLib` 插件：把 `lib/*.mjs` 拷到 `dist/lib/` 给 SW 用 |
| `extension/src/background/background.ts` | +1 | `import './sync'` 触发 sync 副作用 |

---

## 3. 关键决策

### 3.1 chrome.alarms（不是 setInterval）
MV3 Service Worker 会被 Chrome 主动休眠（30s 无活动），`setInterval` 不可靠。
`chrome.alarms` 是 Chrome 持久调度的唯一可靠方案。
- 最小周期 `periodInMinutes: 0.5`（30s，MV3 强制下限）
- 监听 `chrome.alarms.onAlarm.addListener` → flushBatch

### 3.2 指数退避：30s → 1m → 5m → 30m
失败时不无限重试轰炸后端。状态持久化到 `chrome.storage.local.xtAnnoSyncBackoff`：
```ts
{ attempt: number, nextRetryAt: number, lastError, lastFailedAt }
```
- `attempt=0`：无 backoff，立刻 flush
- `attempt=1`：30s 后允许重试
- `attempt=2`：1m
- `attempt=3`：5m
- `attempt≥4`：30m（封顶）

`forceFlush`（用户点 FAB 📊 或 online 事件）会清空 backoff 立即重试。

### 3.3 端口 3001 硬编码
NestJS 标注服务在 `server/annotation/`，端口 3001（FastAPI NMT 8000 不变）。
后端 URL：`http://localhost:3001/v1/annotations`（POST 批量 ingest）。
端口硬编码是为了简单起见；生产部署时改 env 注入即可。

### 3.4 静态 import（不是 dynamic import）annotation-store
关键发现：vite 的 dynamic import 走 `__vitePreload` helper，用 `document.head` + `window.dispatchEvent`，
**Service Worker 上下文无 window → ReferenceError**。
修复：把 `import * as _annoStore from '../../../lib/annotation-store.mjs'` 改为静态 import，
vite 直接把 annotation-store 一起 bundle 进 background bundle。
副作用：`lib/annotation-store.mjs` 不再需要单独 `dist/lib/annotation-store.mjs`，
但保留 `copyLib` 插件作为 fallback（其他 lib 文件仍可能用到）。

### 3.5 三个触发源
- `chrome.alarms.onAlarm`（30s 周期）— 默认路径
- `chrome.runtime.onMessage({ type: 'XT_FORCE_SYNC' })` — 用户点 FAB 📊
- `self.addEventListener('online')` — 浏览器从断网恢复

### 3.6 端到端可观测
每个步骤都有 `logger.info/warn`：
- `annotation.sync.batch.start` — 开始 flush
- `annotation.sync.batch` — 成功（count/success/durationMs）
- `annotation.sync.empty` — 无 unsynced
- `annotation.sync.failed` — 失败（err/attempt/retryInMs/durationMs）
- `annotation.sync.skipped` — 在 backoff 期跳过
- `annotation.sync.force` — 主动同步触发
- `annotation.sync.alarm.created` — alarm 注册成功

### 3.7 幂等
- 后端：`INSERT OR IGNORE`（`server/annotation/src/annotations/annotations.service.ts:45`）
- 前端：`markSynced` 在 IDB 事务内，重复 id 不会重复扣减
- 网络重发同一 batch：后端 `accepted=0`（重复 id 全部 OR IGNORE），前端全部 markSynced

---

## 4. 测试覆盖

### 4.1 单元测试（vitest，19 cases）
- flushBatch 成功 / 失败 / 空批
- backoff skip / backoff 恢复
- forceFlush 绕过 backoff
- installSync 注册 alarm / message / online 三种 listener
- message handler 路由 XT_FORCE_SYNC / XT_TEST_SEED
- online 事件触发 forceFlush
- 纯函数退避计算（attempt 0..10 + 上限）
- isInBackoff 状态判断
- fetch 网络异常（非 HTTP error）→ 写 backoff

### 4.2 E2E 测试（playwright + 真 NestJS，4 cases）
- case 1：seed 3 条 → forceSync → NestJS DB 验证（total=3, byKind 正确）
- case 2：第二次 forceSync → count=0（验证 IDB 已 markSynced）
- case 3：chrome.alarms.getAll → 'xt-annotation-sync' (periodInMinutes=0.5) 存在
- case 4：后端幂等（重复 id POST → accepted=0）

### 4.3 关键修正记录
1. **vite dynamic import 走 preload helper → SW ReferenceError**
   → 改静态 import，vite 直接 bundle annotation-store
2. **chrome.storage.local.get 直接赋值丢 this**
   → 用 `localStorage.get.bind(localStorage)` 保留 this
3. **SW 内部 chrome.runtime.sendMessage 没接收端**
   → e2e 测试用 `globalThis.__xtSyncMessageHandler` 直接调 handler

---

## 5. 耗时

| 阶段 | 时间 |
|---|---|
| 读文档 + 理解接口 | ~3 min |
| 实现 sync.ts | ~12 min |
| 单元测试 + 修正 | ~5 min |
| vite 构建调整（lib 复制） | ~3 min |
| e2e 编写 + 调试（dynamic import、this binding、handler 暴露） | ~15 min |
| 文档 | ~3 min |
| **总** | ~41 min |

---

## 6. 运行验证

```bash
# 单元测试
cd extension && ./node_modules/.bin/vitest run test/sync.test.ts
# Test Files  1 passed (1)
# Tests       19 passed (19)

# 构建
cd extension && ./node_modules/.bin/vite build
# ✓ built in 64ms（background bundle 17.57 kB）

# e2e（真起 NestJS）
node test/sync.e2e.test.mjs
# ━━━ TOTAL ━━━ passed=4 failed=0

# 完整 ts 校验
cd extension && ./node_modules/.bin/tsc -b
# （无输出 = 0 errors）
```

---

## 7. 后续依赖

- **Agent 3 / Agent 4**（UI）：content script 标完一条后调
  `chrome.runtime.sendMessage({ type: 'XT_FORCE_SYNC' })` 可选触发（即时反馈）
- **Agent 6**（已完成 NestJS）：本端点已对齐 POST /v1/annotations 协议
- **Phase 8**（algorithm loop）：≥500 条 + 跨 ≥10 URL + ≥3 lang pair 触发训练

---

## 8. 已知限制 / 遗留

1. **SW 休眠**：即使有 alarms，30s 内 SW 可能不响应非 alarm 事件。当前消息路由走
   `chrome.runtime.onMessage` 唤醒 SW，可正常工作。
2. **port 3001 硬编码**：开发期够用；生产建议注入到 manifest 或 build env。
3. **markSynced 失败处理**：当前若 markSynced 失败，整批会进入下一轮重新上传。
   后端 INSERT OR IGNORE 保证幂等，但**短期可能重复扣费 / 占流量**。
   后续可加 maxRetry 字段到记录，> N 次直接 drop + log。
4. **离线判定**：仅在 flush 阶段 try/catch 捕获 `TypeError: Failed to fetch`，
   没有主动 `navigator.onLine` 检查。可加。
5. **`XT_TEST_SEED` 消息**：e2e-only 调试通道，应在 production manifest 加
   `if (process.env.NODE_ENV === 'development')` 守门，或干脆不放进 production bundle。
   当前未隔离（仅本地 dev 调）。
