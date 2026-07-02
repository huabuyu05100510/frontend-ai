# Preview Engine Demo — 通用文件预览引擎（TDD）

按 TDD 模式实现的「极致体验」文件预览内核：先写测试 → 再实现 → 跑绿。
对应方案见上级目录 `../spec.md`。

## 运行

```bash
npm install          # 安装依赖
npm run dev          # 启动 demo（三个交互页）
npm test             # 运行全部单元测试
npm run test:coverage
```

> 若离线/网络受限，可复用同仓库 `office-doc-engine/demo` 的依赖（同款 vite/vitest/react）。

## 已实现内核（均 TDD，测试全绿）

| 模块 | 路径 | 职责 | 测试要点 |
|------|------|------|----------|
| FormatProbe | `src/kernel/FormatProbe.ts` | 魔数 + 容器探测，归一 8 类 | 伪造拦截 / OOXML 区分 / 无魔数兜底 |
| CapabilityRouter | `src/kernel/CapabilityRouter.ts` | Native/WASM/Server 三态决策 | 设备能力 × 格式动态路由 |
| CumulativeIndex | `src/pipeline/CumulativeIndex.ts` | 前缀和 + 二分定位 | 百万行 O(log n) 定位 < 5ms |
| ViewportScheduler | `src/pipeline/ViewportScheduler.ts` | 可见集 / 预取 / 回收 | overscan 窗口 + 回收集正确性 |
| PagePool | `src/pipeline/PagePool.ts` | 对象池 + LRU | 恒定内存 / 对象复用 / 淘汰 dispose |
| ProgressiveLoader | `src/pipeline/ProgressiveLoader.ts` | 三段式渐进首屏 | 可见发生在 LQIP / 失败兜底 / 取消 |
| EditOp | `src/edit/EditOp.ts` | 编辑操作取反 + 应用 | 双取反还原 / undo 闭环 |
| CollabDoc | `src/collab/CollabDoc.ts` | LWW-Map CRDT | 收敛 / 幂等 / 交换律 / 离线合并 |
| RendererRegistry | `src/kernel/RendererRegistry.ts` | 插件 match 打分路由 | 选最高分 / 同分稳定 / 无命中 null |
| RendererPlugin | `src/kernel/RendererPlugin.ts` | 渲染插件协议（接口） | 真实渲染器接入契约 |

## Demo 四页

1. **极致首屏 · 探测/路由**：点任意文件 → 实时展示真实类型、可信度、渲染路径决策，以及「骨架→低清(可见)→高清」三段进度与 `首个内容可见 ms`。伪装成 `.jpg` 的 exe 会被拦截。
2. **真实分页 · Canvas 池**：500 页变高文档，PDF 经 `RendererRegistry` 路由到 `paged-canvas` 插件，用**真实 `<canvas>` 元素池化复用** + `ViewportScheduler` 调度 + 每页「低清即时 → 高清异步」绘制。PerfHUD 显示 DOM canvas 数 / 累计创建数恒定（端到端验证恒定内存）。
3. **百万行虚拟滚动**：100 万行，DOM 节点恒定，PerfHUD 实时显示 FPS / 可见行 / 对象池占用 / 累计创建对象数（体现复用）。
4. **协同批注（CRDT）**：Alice/Bob 双副本，支持在线实时同步与离线编辑后重连合并，状态收敛可视化。

## 设计取舍

- **解析与渲染分离**：内核全为纯逻辑（无 DOM 依赖），可在 Worker 复用、可单测。
- **端到端集成（第 2 页）**：用 `RendererPlugin` 接口 + 真实 canvas 池打通「探测 → 路由 → 调度 → 池化绘制」全链路；合成页面替代 PDF.js 解析产物，架构与真实接入完全一致。
- **真实格式解码器（PDF.js / ffmpeg.wasm / OOXML）** 替换合成 `paintUnit` 即可接入，属集成层，不在本 demo 单测范围内。
