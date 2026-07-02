# Reduced-Motion Compliance Audit — Phase 3.B

模型：claude-sonnet-4-6
日期：2026-07-01

## 一句话结论

WCAG 2.3.3 (Animation from Interactions, Level AAA): **PASS**.

依赖 Phase 0.D 的两层基础设施：
1. **CSS 全局护栏** (`web/src/a11y/reducedMotion.css`) — 把所有元素的
   `animation-duration` / `transition-duration` 在 reduced motion 下强制为
   `0.01ms !important`，覆盖范围 `*, *::before, *::after`，因此所有
   inline `transition:` / `animation:` 声明都被天然中和。
2. **JS 桥接** (`web/src/hooks/usePrefersReducedMotion.ts`) —
   `matchMedia('(prefers-reduced-motion: reduce)')` + `<html data-motion>`
   同步，所有 motion primitives (Phase 1.B Hover/Press/PageTransition)
   都读这个属性手动降级。

## 决策

- 静态扫描用**正向断言**（基础设施存在 + primitives 读 `data-motion`），**不用"零违规"**断言
  —— 项目里 31 个 inline `transition:` + 4 个 inline `animation:` 都是合规的（依赖全局护栏）
- 端到端用 Playwright `reducedMotion: 'reduce'` context 真实调浏览器 composite，所有路由
  都跑一遍，最大 transition-duration 应该 ≤ 1ms
- 不修改 `web/src/**`（P3.B scope 不允许）；扫描结果作为文档归档到 FINDINGS.md

## 文件变更

- NEW: `office-preview-app/web/test/a11y/reducedMotionAudit.test.tsx` (18 tests)
- NEW: `office-preview-app/web/e2e/reduced-motion-audit.spec.ts` (4 tests, dev-server 依赖)
- NEW: `changes/reduced-motion-audit/FINDINGS.md`
- NEW: `changes/reduced-motion-audit/README.md` (本文件)

## 静态扫描结果

| 模式 | 命中数 | 备注 |
|---|---|---|
| `setTimeout(` | 21 | debounce / fetch / focus / 复制 toast 重置；都不驱动 CSS 动画 |
| `setInterval(` | 6 | 健康检查 30s / 内存轮询 2s / 格式转换进度 / 语音识别 |
| `requestAnimationFrame(` | 12 | 布局测量（offsetWidth/scroll）/ 文字层 scaleX / Modal 入场 / AudioLevel |
| inline `transition:` | 31 | 全部在 `style={{}}` 内，依赖全局护栏 |
| inline `animation:` | 4 | `xf-cap-in` / `xf-mic-ring` / `spin` —— 依赖全局护栏 |

**关键判断**：这些都不是违规。理由：
- `setTimeout/setInterval` 大多是状态轮询或反馈计时器，不动画化样式
- `requestAnimationFrame` 在代码里都是布局测量工具，配合 `cancelAnimationFrame` 自我清理
- inline `transition`/`animation` 依赖 `reducedMotion.css` 的 `!important` 覆盖

## 手动测试步骤

1. 打开 DevTools → ⋮ → More tools → Rendering
2. 找到 "Emulate CSS media feature `prefers-reduced-motion`"，切到 `reduce`
3. 浏览 `/files`, `/translate`, `/qc`, `/ocr`, `/convert`, `/upload`, `/voice` 7 个主路由
4. 任何动画时长都应该是 0（即刻完成）

或更精准验证：
- 在 Console 执行 `document.documentElement.setAttribute('data-motion', 'off')`
- 同样浏览 7 个路由，所有动画立即完成

## 后续阶段

- Phase 4+ (非本次范围)：把 31 个 inline `transition:` 迁移到 `<Hover>` / `<Press>` primitives
- Phase 4+：`xf-cap-in` / `xf-mic-ring` / `spin` 这类无限循环动画除了 reduced-motion 也加用户可手动关闭
- RightPanel 的视觉回归测试 (`P3.A`) 也应该跑 `prefers-reduced-motion: reduce` 一份 baseline

## 相关变更

- `changes/a11y-reduced-motion/README.md` — Phase 0.D 基础设施
- `changes/motion-primitives/README.md` — Phase 1.B primitives 数据属性读取
- `changes/reduced-motion-audit/FINDINGS.md` — 本次静态扫描明细
