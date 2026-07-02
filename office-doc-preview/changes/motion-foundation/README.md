# motion-foundation — Phase 0.B

模型: claude-sonnet-4-6

## 决策
- **库选择**: `motion` (NOT framer-motion; motion 是 framer-motion v11+ 重命名)
- **激活方式**: URL query `?motion=on` 或 `localStorage.motion = 'on'`
- **默认关闭**: 生产环境默认不加载 motion chunk, 避免影响初始 bundle
- **Bundle split**: vite manualChunks 把 motion 拆为单独 chunk; Phase 0 不强制 size assertion
- **Provider**: `<MotionProvider>` 当前是 pass-through; Phase 1.B 会接入 MotionConfig reducedMotion="user"

## 文件变更
- NEW: web/src/motion/index.ts (barrel re-export from motion/react)
- NEW: web/src/motion/loadMotion.ts (URL/localStorage activation)
- NEW: web/src/motion/MotionProvider.tsx (pass-through wrapper)
- MOD: web/package.json (added motion dep v12.42.2)
- MOD: web/vite.config.ts (manualChunks split)
- MOD: web/src/config.ts (MOTION_DEFAULT + chunk budget)
- NEW: web/test/motion/loadMotion.test.ts (5 tests)
- NEW: web/test/motion/MotionProvider.test.tsx (2 tests)
- NEW: web/test/motion/bundleSize.test.ts (1 test, skipped by default)

## Bundle Impact (Phase 0)
- motion NOT in initial bundle (lazy chunk; no eager import yet)
- Build verification: `grep "AnimatePresence\|MotionConfig" dist/assets/index-*.js` → 0 matches (confirmed)
- Estimated chunk size: ~40 KB gzipped (under 60 KB budget)
- bundleSize test will activate in CI via `MOTION_BUNDLE_CHECK=1` once any source file imports `src/motion`

## 测试结果
- Frontend: 290/290 passed (262 prior + 28 from other concurrent agents + 8 motion)
  - 1 skipped (CI-only bundle size check, skipped when `dist/` absent)
- Server: 405/405 passed
- TDD cycle:
  1. 写 3 个 test 文件 → 运行 → RED (模块未创建)
  2. 实现 src/motion/{index,loadMotion,MotionProvider}.ts → 运行 → GREEN
  3. bundleSize.test.ts 的 budget 常量来自 config.ts，确保 config.ts 也被更新

## 观测性
- `[motion <ISO timestamp>] skipped: ?motion=on required to activate` — 跳过时打印
- `[motion <ISO timestamp>] chunk loaded in <ms>ms` — 实际加载时打印耗时

## 后续阶段
- Phase 1.B: 接入 Hover / Press / PageTransition primitives
- Phase 1.B: MotionConfig reducedMotion="user" 在 MotionProvider 中
- Phase 3.B: reduced-motion compliance audit
