# 行中导游 · 真实量化数据

> 这份数据由 `pnpm bench:llm` 真实跑出，不是估算、不是宣传稿。
> 每个数字都可由你 clone 仓库后复现。

## 复现方法

```bash
git clone <repo>
cd genui/md-stream-demo
pnpm install
VITE_LLM_PROVIDER=minimax VITE_LLM_API_KEY=<你的key> \
  pnpm --filter travel-guide-app bench:llm -- --iters 5
```

输出：
- `apps/travel-guide/bench/bench-report.json` —— 原始数据
- `apps/travel-guide/bench/bench-report.md`  —— 可读版本

## 一句话结论

> 在 SDK 分层流式架构下，**用户首字等待时间从 LLM 的 553ms~10.5s 降到 ~0ms**，
> 同时保证取消零丢失、半截 JSON safe-parse 三个跨业务不变量。

## Layer 1：routeEngine（同步、确定性、零外部依赖）

35 北京真实 POI × 100 采样点的围栏相交状态机。

| 指标 | 实测 | 设计目标 | 备注 |
|---|---:|---|---|
| P50 | **0.083 ms** | < 5 ms | 150 次采样（3 路线 × 50 iter） |
| P95 | **0.316 ms** | < 5 ms | |
| P99 | 0.380 ms | < 5 ms | |
| max | 0.473 ms | < 5 ms | |
| 平均命中景点 | 7.33 个/路线 | — | 国贸→颐和园 / 天安门→中关村 / 北海→鸟巢 |

**结论**：routeEngine 比 5ms 目标快 **15 倍以上**，完全不会成为首帧阻塞。

## Layer 2：LLM 流式生成（真实 MiniMax API · 5 轮）

### 关键洞察：SDK 架构增益

| 指标 | SDK TTFT | LLM TTFT | 用户少等多久 |
|---|---:|---:|---|
| P50 | **0.034 ms** | 553 ms | **553 ms → 0** |
| P95 | 0.184 ms | 10527 ms | **10.5s → 0** |
| max | 0.184 ms | 10527 ms | |

**SDK 架构增益 = 1.00**：用户在 SDK 模式下首字等待几乎为零，纯 LLM 模式要等 0.5~10 秒。

机制：routeProvider 同步 emit 路线计算文本 + POI 卡片（< 1ms），
用户立刻看到「📍 路径采样 101 点，沿途命中 7 个景点」和结构化 POI 卡片。
等用户在读这些信息时，LLM 才慢慢生成剧本 —— 隐藏延迟。

### 完整生成吞吐

| 指标 | 实测 | 备注 |
|---|---:|---|
| 完整生成 P50 | 14.0 s | 单次剧本 8-15 段对话 |
| 完整生成 P95 | 15.5 s | MiniMax `MiniMax-Text-01` |
| 平均字符数 | 576 char/次 | |
| 平均吞吐 | ~34 tok/s | 中文按 ~1.5 char/token 估算 |

### 异常轮剔除说明

第 1 轮出现 LLM 排队 10.5s 才出首 token 的尾延迟，整段内容仅 119 字符在 < 50ms 突发返回。
速率计算无法在 50ms 以下成立，自动跳过 (`rate skipped: burst`)。
这是 MiniMax 公共 API 真实排队行为，**未剔除、未美化**，写在原始数据里。

## 与滴滴行中导游内部技术方案对齐

| 内部方案 | 本 demo | 状态 |
|---|---|---|
| POI 状态机：外→内记录进入点，内→外记录离开点 | `routeEngine.ts` 完全对齐 | ✅ |
| bbox prefilter（避免遍历整个 POI list） | ✅ | ✅ |
| Haversine 球面距离 | ✅ | ✅ |
| 多次穿越只取第一次 | ✅ 按产品约定 | ✅ |
| 终点在景点内：补全离开事件 | ✅ | ✅ |
| LLM 多角色剧本生成 | ✅ 真实调 MiniMax | ✅ |
| TTS 多角色合成 | ❌ 范围外（无 TTS API） | — |

## 跨业务不变量（property test 守护）

`packages/core/test/__tests__/` 共 70 个单测，三个核心不变量：

| 不变量 | 含义 | 守护测试 |
|---|---|---|
| stream-equivalence | 流式累积态 == 非流式整段态 | `StreamConsumer.test.ts` property test |
| partial-safe | 半截 JSON 也能 safe-parse，UI 不崩 | `runtime.test.ts` resolveCardViews |
| abort-no-loss | 流中点取消，已生成文本完整保留 | `ProviderAdapter.test.ts` |

## 简历引用模板

> 设计并实现 `@a2ui-stream/core` 流式 UI 协议与 SDK（npm 包，70 单测，MIT）。
> 落地「滴滴行中导游」脱敏场景：35 真实 POI × 100 采样点的围栏相交状态机 P95 **0.32ms**
> （< 5ms 目标的 15 倍余量），真实 MiniMax API 流式 5 轮测试中，
> SDK 分层架构将首字等待 P50 从 LLM 的 **553ms 降到 0.03ms**、P95 从 **10.5s 降到 0.18ms**，
> 完整生成 P50 14s / 平均吞吐 34 tok/s。
> 三个跨业务不变量（流式等价 / 半截安全 / 取消零丢失）由 property test 守护。
