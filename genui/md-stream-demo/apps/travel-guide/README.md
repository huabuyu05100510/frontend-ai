# travel-guide-app · 行中导游真实场景

滴滴行中导游业务的脱敏复刻。**真实** 数据 + **真实** LLM 调用 + **真实** 可量化数据。

## 配置

复制 `.env.example` 为 `.env.local`（项目根，不进 git），填入 LLM API key：

```bash
VITE_LLM_PROVIDER=minimax      # minimax | deepseek | openai | qwen
VITE_LLM_API_KEY=sk-...
VITE_LLM_MODEL=                # 留空用默认
```

无 key 也能跑：UI 内关掉「调真实 LLM」，仅做路线计算 + POI 围栏检测（这部分零外部依赖）。

## 跑

```bash
pnpm install
pnpm --filter travel-guide-app dev
```

打开浏览器看真实流式生成。

## 测什么

| 指标 | 含义 | 期望范围 |
|---|---|---|
| 路线计算耗时 | 围栏相交状态机 35 POI × 100 点 | < 5 ms |
| TTFT（首字时间） | 用户点按钮 → 第一个 text-delta | LLM 主导，~300-800ms |
| 完整生成时间 | LLM 整段剧本 | 5-15 s |
| token/s | LLM 流式吞吐 | 各家不同，记录真实值 |
| 取消零丢失 | 流中点取消，已生成文本完整保留 | 100%（property test 守护） |
| CLS | 流式渲染视觉抖动 | < 0.05 |
| 主线程 long task | >50ms 任务 | 0（无重渲染热点） |

## 数据集

`src/poiDataset.ts` 是 35 个北京真实景点，含真实经纬度（高德/百度公开坐标）。

## 与原方案对齐

| 原方案（滴滴行中导游技术方案.md） | 本 demo |
|---|---|
| POI 库（小红书/抖音爬虫 → RAG） | 静态 35 个北京 POI |
| 状态机：外→内记录进入，内→外记录离开 | ✅ `routeEngine.ts` 完全对齐 |
| bbox prefilter 避免遍历整个 POI list | ✅ |
| Haversine 距离 | ✅ |
| 多次穿越只取第一次 | ✅ 按产品约定 |
| 终点在景点内：补全离开事件 | ✅ |
| LLM 多角色剧本生成 | ✅ 真实调 MiniMax/DeepSeek 等 |
| TTS 多角色合成 | ❌ 范围外（无 TTS API） |
