# 自研沙箱引擎 Demo

按 `../面试突击-微前端务实版.md` 落地的可运行 demo：自研 12KB 沙箱引擎 + 多技术栈子应用 + 路由级灰度 + 边界场景测试集。

## 仓库结构

```
demo/
├─ packages/
│   ├─ micro-engine/          引擎本体（12KB gzip，size-limit 门禁）
│   ├─ shell/                 共享壳子（FCP 关键路径 <3KB）
│   ├─ sub-apps/              Vue2/jQuery/React/失效子应用
│   └─ ... (workspace)
└─ server/                    Express 灰度代理
```

## 启动

```bash
pnpm install
# 同时启动 4 个服务（用 7xxx 避开常见 dev 端口冲突）：
#   engine build:watch  （type-check + emit）
#   shell dev           http://localhost:7180
#   sub-apps static     http://localhost:7182
#   grayscale proxy     http://localhost:7183
pnpm dev
```

打开 `http://localhost:7180/` 看 SPA 壳子；想测灰度分流走 `http://localhost:7183/`。

> ⚠️ 端口被占的处理：`lsof -iTCP:7180 -sTCP:LISTEN` 看占用进程；或用环境变量 `SHELL_PORT=7181 pnpm dev`。

## 测试

```bash
pnpm test          # 28 个边界场景单测
pnpm size          # CI 门禁（engine <12KB / index.html <3KB gzip）
```

## 边界场景速查

按面试文档 5.4 + 8.x 落地的 10 个边界场景，每个都有对应单测或可手动触发。

| # | 场景 | 在哪演示 | 单测 |
|---|---|---|---|
| 1 | iframe src 与 Proxy location 时序竞争（坑#1） | 引擎 `nextMicrotask()` 串行化 | `SandboxCore.test.ts > nextMicrotask` |
| 2 | 老代码 `top.postMessage` 跨域（坑#2） | jquery 子应用「测试 top.postMessage」按钮 | `SandboxCore.test.ts > SdkInjector 注入 top 代理` |
| 3 | iframe 内 `position:fixed` 偏移（坑#3） | vue2 子应用 popover，容器 `transform: translateZ(0)` | （需肉眼验证） |
| 4 | history.pushState 双向同步死循环（坑#4） | vue2 子应用内 pushState → 主应用回切 | `RouterBridge.test.ts > 防回环` |
| 5 | SW 在 iframe 内不生效（坑#5） | 引擎 `installSandboxCore` 探测打 metric | （在面板的 metric 列表） |
| 6 | Pool 耗尽 → 现场新建 | 连点 4 个子应用 | `IframePool.test.ts > 池耗尽时现场新建` |
| 7 | LRU 淘汰（最多 5） | 激活第 6 个 app，看 dash panel `lru:evict` | `LifecycleManager.test.ts > LRU 淘汰` |
| 8 | 加载 404 → ErrorBoundary 跳 MPA | 点「失效子应用」菜单 | `ResourceLoader.test.ts > HTTP 404`、`ErrorBoundary.test.ts` |
| 9 | SDK 自动注入正确性 | 在子应用里读 `window.__USER__`/`__AB__` | `SandboxCore.test.ts > SdkInjector 注入` |
| 10 | hook 抛错不阻塞主流程 | beforeParse hook 异常 | `ResourceLoader.test.ts > beforeParse hook 抛错` |

## 灰度演示

```bash
# 默认全 MPA
curl http://localhost:7183/api/grayscale
# 灰度 50% 用户走 SPA
curl -X POST http://localhost:7183/api/grayscale -H 'Content-Type: application/json' -d '{"ratio":0.5}'
# 紧急回滚
curl -X POST http://localhost:7183/api/rollback
# 指定用户走 SPA（cookie 强制）
curl -b 'spa_rollout=1' http://localhost:7183/
curl -b 'spa_rollout=0' http://localhost:7183/

# 模拟 RUM LCP P95 超 2.5s 自动回滚
curl -X POST http://localhost:7183/api/rum/beacon \
  -H 'Content-Type: application/json' \
  -d '[{"name":"LCP","value":3000},{"name":"LCP","value":3100},{"name":"LCP","value":3500},{"name":"LCP","value":4000},{"name":"LCP","value":5000}]'
# 查看 RUM 分位
curl http://localhost:7183/api/rum/stats
```

## 性能预算（CI 门禁）

| 资产 | 上限 | 当前 |
|---|---|---|
| `@micro/engine` (gzip) | 12 KB | 2.83 KB |
| `shell/index.html` (gzip) | 3 KB | 1.64 KB |

`pnpm size` 超阈值会非 0 退出，CI 可阻断 PR。

## 关键文件速查

| 想看 | 文件 |
|---|---|
| iframe 池化 / 复用 / reset | `packages/micro-engine/src/IframePool.ts` |
| beforeParse/afterParse hooks | `packages/micro-engine/src/ResourceLoader.ts` |
| SDK 自动注入 + top 代理 | `packages/micro-engine/src/SdkInjector.ts` |
| Proxy 劫持 history + 容器修正 | `packages/micro-engine/src/SandboxCore.ts` |
| 主子路由同步 + isSyncing | `packages/micro-engine/src/RouterBridge.ts` |
| LRU keep-alive | `packages/micro-engine/src/LifecycleManager.ts` |
| ErrorBoundary | `packages/micro-engine/src/ErrorBoundary.ts` |
| idle prefetch | `packages/micro-engine/src/IdlePrefetch.ts` |
| FCP 关键路径铁律 | `packages/shell/index.html` |
| 路由级灰度（cookie + ratio + RUM 回滚） | `server/server.mjs` |
