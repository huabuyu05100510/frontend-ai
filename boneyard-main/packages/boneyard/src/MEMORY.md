# Boneyard Project Memory

## Project Context
Working directory: /Users/didi/Downloads/前端AI面试题/boneyard-main/packages/boneyard/src
Multi-framework skeleton screen generator (React/Vue/Svelte/Angular/RN).

## Key Files
- `extract.ts` — DOM walker, `snapshotBones()` + `fromElement()`
- `react.tsx` — React `<Skeleton>` component
- `shared.ts` — global registry, animation constants (SHIMMER/PULSE/DEFAULTS)
- `types.ts` — BoneData, SnapshotConfig, CompactBone tuples
- `layout.ts` — descriptor-driven layout engine (Chinese comments)
- `vite.ts` — Vite plugin (HMR auto-capture via Playwright)
- `runtime.ts` — `renderBones()` 生成 HTML 字符串，SSR 可复用

## Architecture Decisions
- Build-time snapshot via CLI (not runtime)
- Mixed coordinates: x/w as %, y/h as absolute pixels (known limitation)
- CompactBone tuple: [x, y, w, h, r] or [x, y, w, h, r, true] for containers
- Container bones (c:true) are extracted but NOT rendered (prevents opacity overlap)
- Dark mode via .dark class only — NOT prefers-color-scheme directly

## 通用骨架架构（旗舰设计 / 代表作）
详见 `skeleton-architecture-design.md`（当前目录）—— 上位总纲：
- 跨模式（SSR / CSR / 接口态）× 跨平台（PC / H5 / RN / 小程序·Taro）× 指标（FP/CLS/LCP/INP）
- 核心：仿 React Scheduler 的 `BoneScheduler`（lane+expiration、MessageChannel 宏任务、shouldYield 时间分片、最小堆、跨平台 host 后端）——落实"骨架是障眼法，绝不阻塞页面渲染"
- 七层流水线 Capture/Model/Render/Schedule/Inject/Teardown/Bridge + `ReadySignal` 统一就绪信号抽象
- 指标定位：FP 改善 / CLS 改善 / LCP 中性（空 div 非 LCP 候选）/ INP·TBT 由调度器保护

## 构建与工作流（详细方案 / 工具链）
详见 `skeleton-build-pipeline-design.md`（当前目录）：
- 目标已固化为 Goals 验收表（G1~G8）
- 构建期自动生成 SSR 骨架 → `outDir.ssr`
- 接口态以「API ⇄ DOM 绑定图」为核心（不是组件级 pending 闸门）：`<Bound>`/Proxy 渲染期依赖追踪建立 dataKey⇄region，按区域写片段 + `bindings.json`，运行时区域级渐进揭示（progressive reveal）；数据层差异收敛到适配器
- `dev:ske` 模式下捕获（普通 dev 零开销），运行时 DevSave + Playwright 批量两通路
- 断点自动扫描：CSS @media / Tailwind screens / 运行时 styleSheets ∪ 默认 ∪ 开发者 extend
- SSR 脚本注入位置可降级 head|body（健壮 IIFE：DOMContentLoaded + rAF 重试 + 兜底）
- 异步接口自动扫描（静态 AST + 运行时 fetch/XHR 探针）→ 标记漏骨架组件
- CI `boneyard check` 对 ssr+api 两类做内容 hash 同步校验

## SSR 注入方案（已设计，作为架构总纲的 Web SSR 章附录）
详见 `ssr-injection-design.md`（当前目录）

核心思路：
- CLI 新增生成 `bones/manifest.json` + `bones/{name}.snippet.html`
- snippet.html = renderBones() HTML + CSS keyframes + MutationObserver IIFE（自包含）
- `@boneyard/middleware` 服务端注入到 `</body>` 前，同时 serve `/boneyard-bridge.js`
- `boneyard-bridge.js` 处理 SPA 路由切换（pushState/popstate 拦截 + rIC 预加载）
- 服务端团队一次性安装，永不维护骨架逻辑

## 竞品分析参考项目（/Users/didi/Documents/code）
- `smarty-skeleton-toolchain` — 最完整，含 SW FETCH_START/END 广播、Webpack plugin HTML 注入
- `smarty-skeleton-v1/v2` — rIC polyfill(40ms budget)、CSS-only fade-out(index.less)
- `visual-skeleton-plugin` — IIFE 幂等保护 `window.__FLAG__` 模式
- `trinity-chrome-extension` — Zero-CLS Anchoring（min-height/max-height 注入）

→ 详细研究笔记: memory/skeleton-design-research.md
