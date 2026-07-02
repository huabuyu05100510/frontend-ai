# 技术方案: voice-kit 生产部署清单

## 背景

开发期与生产期的差异不仅在于代码，更在于**凭证管理、错误暴露、可观测性**。本文件给出最小可用生产部署指引，覆盖：

1. 凭证注入（避免明文提交、避免 SDK 直连 Volcengine）
2. Gateway 在凭证缺失时**显式拒绝**而不是 silently 接受
3. 失败码语义、客户端处理路径
4. 运行时健康检查

## 1. 架构边界

```
Browser ──(WSS)──► voice-kit gateway ──(WSS + 签名 header)──► Volcengine
                    ▲
                    │ 仅此一跳
                    │
              apiSecret / accessToken 留在此处，永不下发到客户端
```

- 客户端 SDK 只持有 `gatewayUrl` 与短期 JWT；
- Volcengine AK/SK、access token 仅在 gateway 进程环境变量中持有；
- gateway 复用 WebSocket 反向代理 + v3/sauc 二进制协议，**不解析音频内容**。

## 2. 最小凭证清单

| 环境变量 | 必需 | 说明 |
|---|---|---|
| `VK_DOUBAO_APP_ID` | ✅ | 火山引擎控制台分配的 appId |
| `VK_DOUBAO_API_KEY` + `VK_DOUBAO_API_SECRET` | 二选一 | AK/SK 签名（推荐生产） |
| `VK_DOUBAO_ACCESS_TOKEN` | 二选一 | 预签发的 access token（CI/测试） |
| `VK_DOUBAO_RESOURCE_ID` | 默认即可 | `volc.seedasr.sauc.duration` |
| `VK_GATEWAY_PORT` | 默认 8787 | 监听端口 |
| `VK_CORS_ORIGINS` | 生产必须收敛 | 逗号分隔的 origin 白名单 |
| `VK_TOKEN_TTL_SEC` | 默认 300 | 客户端 JWT TTL（秒） |

参考 `apps/gateway/.env.example`。

## 3. 凭证缺失的失败语义

**过去**：客户端发起 WSS 连接，gateway 接受、forward 到 Volcengine，被服务端以 401 关闭 → 客户端 `WebSocket is already in CLOSING` → UI 显示「录制中... 接收 0 帧」。

**现在**：gateway 在 `connection` 回调内立即检查凭证，缺失则用**应用层 close code 4401** 关闭：

```ts
// apps/gateway/src/asr-proxy.ts
if (!opts.config.doubao.apiKey && !opts.config.doubao.accessToken) {
  client.close(4401, 'Doubao credentials not configured');
  return;
}
```

客户端 `onclose` 把非 1000/1005 的关闭码翻译成 `ASRResult.kind === 'error'`：

```ts
// packages/provider-doubao/src/asr-session.ts
this.ws.onclose = (e: CloseEvent) => {
  if (e.code !== 1000 && e.code !== 1005) {
    this.pushResult({ kind: 'error', code: `WS_${e.code}`, message: describeClose(e) });
  }
  // ...
};
```

UI（playground TranscribeDemo）已支持 `kind === 'error'`，会渲染为红色错误条并附上**可执行的修复提示**（设置哪些环境变量）。

## 4. Close Code 字典

| Code | 来源 | 客户端展示 |
|---|---|---|
| 1000 | 正常关闭 | （静默） |
| 1005 | 无状态码 | （静默） |
| 4401 | gateway 凭证缺失 | "ASR gateway rejected the request: Doubao credentials are not configured. Set VK_DOUBAO_APP_ID..." |
| 4402 | gateway 无法连接上游 | "ASR gateway could not reach upstream Volcengine..." |
| 其他 4xx | 预留业务错误 | 透传 reason |

> 44xx 段保留给 voice-kit gateway 自定义错误，**不与 RFC 6455 标准码冲突**。

## 5. 启动与健康检查

```bash
# 启动
VK_DOUBAO_APP_ID=xxx \
VK_DOUBAO_API_KEY=xxx \
VK_GATEWAY_PORT=8787 \
pnpm --filter @voice-kit/gateway start
```

启动日志示例（凭证完整）：
```
[gateway] config loaded { port: 8787, doubao: true, doubaoMissing: [], zhipu: false, minimax: false }
[gateway] listening on http://localhost:8787
[gateway] ASR proxy mounted at ws://localhost:8787/api/asr/doubao
```

启动日志示例（凭证缺失）：
```
[gateway] Doubao misconfigured — missing env: VK_DOUBAO_APP_ID, VK_DOUBAO_API_KEY. ASR proxy will reject connections with code 4401 until these are set.
[gateway] config loaded { port: 8787, doubao: false, doubaoMissing: [ 'VK_DOUBAO_APP_ID', 'VK_DOUBAO_API_KEY' ], ... }
```

健康检查端点：
```bash
curl http://gateway:8787/health
# {"ok":true,"providers":{"doubao":true,"zhipu":false,"minimax":false}}
```

K8s readinessProbe 建议：
```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 8787
  initialDelaySeconds: 5
  periodSeconds: 10
```

## 6. 反向代理 / TLS

生产应在 gateway 前置 Nginx / Envoy：

```nginx
location /api/asr/ {
  proxy_pass http://voice-kit-gateway:8787;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 3600s;   # 长连接
  proxy_send_timeout 3600s;
}
```

WebSocket Idle 超时要大于 `VK_TOKEN_TTL_SEC`，否则会被中间链提前断开。

## 7. 不可上线的开发 Mock（已移除）

本仓库历史版本曾提供 `VK_DOUBAO_MOCK=1` 模式用于离线 E2E。生产仓库**已删除**该模式：

- `apps/gateway/src/asr-proxy.ts` 不再包含 `buildServerFrame` / `rmsOfPcm` / `startMockAsr`；
- `config.ts` 的 `hasDoubao()` 不再响应 `VK_DOUBAO_MOCK`；
- 缺失凭证会被 4401 立即拒绝，**不再出现「录制中... 接收 0 帧」的静默失败**。

> 本地开发若需要离线测试，请使用真实 Volcengine 试用账号 + 1 元体验包；mock 模式不再受支持。

## 8. 上线前 Checklist

- [ ] 凭证经密钥管理（Vault / SM / KMS）注入，绝不入 git
- [ ] `VK_CORS_ORIGINS` 收敛到业务域名（非 `*`）
- [ ] gateway 暴露 `/health`，readinessProbe 配置完毕
- [ ] 客户端 JWT TTL < WebSocket Idle 超时
- [ ] 网关日志包含 close code，便于排查 4401 / 4402
- [ ] 删除 `.env`、本地 `pnpm-lock.yaml` 之外的本地覆盖文件
- [ ] E2E 走真实 Volcengine 通道跑通（脚本：`scripts/e2e-smoke.mjs`，关闭 mock）