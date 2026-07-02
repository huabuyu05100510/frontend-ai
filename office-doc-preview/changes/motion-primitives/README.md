# motion-primitives — Phase 1.B

模型: claude-sonnet-4-6

## 决策
- **3 primitives**: Hover (scale 1.02, 200ms), Press (scale 0.97, 80ms), PageTransition (fade+slide, 200ms)
- **Reduced motion**: each primitive reads `<html data-motion="off">` from P0.D's hook; if "off", animation is killed (duration 0, no transform)
- **MotionConfig**: MotionProvider wraps tree with `reducedMotion="user"` (default) or `"always"` when data-motion="off"
- **Library**: `motion@12.42.2` from Phase 0.B (NOT framer-motion)
- **Data-attr forwarding**: primitives accept arbitrary `data-*` props (signature `[key: \`data-${string}\`]: unknown`) so test selectors like `data-testid` reach the underlying `motion.div`
- **Easing**: `[0.4, 0, 0.2, 1]` (Material standard) for consistent feel across primitives

## 文件变更
- NEW: web/src/motion/primitives/Hover.tsx
- NEW: web/src/motion/primitives/Press.tsx
- NEW: web/src/motion/primitives/PageTransition.tsx
- NEW: web/src/motion/primitives/index.ts (barrel)
- MOD: web/src/motion/MotionProvider.tsx (MotionConfig wrap)
- MOD: web/src/motion/index.ts (re-export primitives)

## 测试 (11 new tests)
- Hover.test.tsx (4): renders, onHover, onUnhover, reduced-motion bypass
- Press.test.tsx (4): renders, onPressStart, onPressEnd, reduced-motion bypass
- PageTransition.test.tsx (3): renders, routeKey changes, reduced-motion bypass

## 测试结果
- Frontend motion: 19 passed + 1 skipped (8 baseline + 11 new) — 0 regressions
- Frontend full suite: 322 passed + 1 skipped (excluding pre-existing palette failure which references non-existent `src/palette` module from another agent)
- Server: 405 passed (no change)
- Build: tsc -b + vite build clean, motion chunk under 60 KB budget

## 后续阶段
- Phase 2.A: 把 Press 套到所有 .oa-btn (~50 处)
- Phase 2.B: 把 PageTransition 套到 <Routes>; SideMenu shared-element pill 用 LayoutGroup
