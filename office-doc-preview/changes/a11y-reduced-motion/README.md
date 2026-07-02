# a11y-reduced-motion — Phase 0.D

模型: claude-sonnet-4-6

## 决策
- **触发**: 系统 `prefers-reduced-motion: reduce` OR 显式 `<html data-motion="off">`
- **效果**: 全局 animation / transition duration 强制 0.01ms (不删动画, 仅瞬间完成)
- **WCAG**: 符合 2.3.3 (Animation from Interactions, Level AAA)
- **观测**: media query 变化时 console.info `[a11y ${ts}] prefers-reduced-motion: ${matches}`
- **作用域**: 全局; Phase 1+ 的 motion primitives 会读 `data-motion` 来降级

## 文件变更
- NEW: web/src/hooks/usePrefersReducedMotion.ts (hook + side-effect)
- NEW: web/src/a11y/reducedMotion.css (CSS guard)
- MOD: web/src/main.tsx (Bootstrap wrapper 调用 hook)
- NEW: web/test/hooks/usePrefersReducedMotion.test.tsx (3 tests, matchMedia mock)
- NEW: web/test/a11y/reducedMotion.visual.test.tsx (4 tests, CSS guard presence)

## 测试
- 7 new tests added; 262 frontend + 405 server tests still green

## 后续阶段
- Phase 1.B: MotionConfig reducedMotion="user" 在 MotionProvider 中
- Phase 1.B: motion primitives 自动尊重 data-motion="off"
- Phase 3.B: reduced-motion compliance audit (Playwright emulate)
