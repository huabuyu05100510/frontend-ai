# Visual Regression Suite — 9 × 2 × 7 = 126 snapshots

模型：claude-sonnet-4-6
日期：2026-07-01
分支：feature/design-overhaul

## 摘要

为设计重塑建立端到端视觉回归防线。每次布局/主题/组件改动都会触发 126 张基线比对，0.5% 阈值捕捉视觉回归而忽略抗锯齿抖动。

## 交付物

| 文件 | 类型 | 说明 |
|---|---|---|
| `web/playwright.config.ts` | MOD | 新增 `design-regression` project（独立 60s timeout + 0.5% threshold） |
| `web/e2e/helpers.ts` | NEW | VIEWPORTS / THEMES / PAGES_ROUTES / seedAppState |
| `web/e2e/design-regression.spec.ts` | NEW | 126 toHaveScreenshot + 7 smoke + 1 matrix-size test |
| `web/e2e/design-regression.README.md` | NEW | 操作指南 |
| `web/e2e/design-regression.spec.ts-snapshots/` | NEW (git) | 126 基线 PNG，~10 MB |

## 矩阵

```
7 页面 × 9 视口 × 2 主题 = 126 快照
```

### 视口选择理由（9）

- **3 mobile**: iPhone SE (375×667) — 最窄主流屏 / iPhone 14 (390×844) — 现代基线 / Pixel 7 (412×915) — Android 参照
- **2 tablet**: iPad Mini (768×1024) / iPad Air (820×1180) — 横屏/竖屏边界
- **4 desktop**: HD 1366 (笔记本主流) / FHD 1920 (桌面主流) / QHD 2560 (高 DPI 设计师) / Ultrawide 3440 (21:9)

跳过 4K 3840+：视觉差异已收敛，且 4K 截图体积翻倍（~150 KB）。

### 主题选择理由（2）

- `light` — 默认 + 设计稿参考
- `dark` — 现代办公场景必备

跳过 `auto`/`system`：依赖 OS 偏好导致 CI 不可重现。

### 页面选择理由（7）

覆盖所有生产路由。排除 `/bookmarks`、`/samples`、`/gallery` 占位路由 — Phase 2 才实现。

## 阈值选择理由（0.5%）

CLAUDE.md 要求"极致体验"。0.5% 是经验阈值：
- 太严 (0.1%)：字体抗锯齿差异即失败 → 误报
- 太宽 (2%)：肉眼可见错位通过 → 漏报
- 0.5%：能捕捉布局漂移（卡片宽度变化、padding 偏移），忽略 sub-pixel 抖动

## TDD 流程

1. 写 spec（red）— spec 在没有 baseline 时全部失败
2. 生成 baseline（green）— `npx playwright test --update-snapshots`
3. 后续运行 — 任何 > 0.5% 偏差立即失败

## 观测

- 每个 spec 内置 `serial` 模式，避免 localStorage race
- `console.info` 输出 router 导航日志（`[router 2026-07-01T...] navigate: /files -> files`）
- 失败时自动保留 trace + video + screenshot 到 `test-results/`

## 性能

- 单 worker + serial → 126 测试串行，约 5–10 分钟
- 推荐在 PR 流水线中作为可选 job（标记 `[visual]`，仅主分支强制）
- 本地开发：仅在改动涉及样式/布局时运行

## 与其他 agent 的协作边界

- ✅ 修改：`web/playwright.config.ts`（仅追加 project）、`web/e2e/helpers.ts`、`web/e2e/design-regression.spec.ts`、`web/e2e/design-regression.README.md`
- ❌ 不触碰：`web/src/**`（应用代码）、`server/src/**`（生产代码）、其他 e2e 测试文件
- 与 P3.B (umbrella doc) 互补：本 agent 只管视觉回归基线，umbrella doc 管跨 agent 总览

## 后续

- 视觉重塑 Phase 1/2 完成后，新增路由/主题时按 README 步骤扩展矩阵
- 计划加入 `compare-on-diff` 模式：当 Git diff 命中 `*.css` / `*.tsx` 时自动触发此 project