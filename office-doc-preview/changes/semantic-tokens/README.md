# semantic-tokens — Phase 1.A

模型: claude-sonnet-4-6

## 决策
- **Semantic alias layer**: 36 个 role-based tokens (`--color-primary` 等), 引用 primitives
- **Dark mode**: `[data-theme="dark"]` 选择器覆盖 text/bg/border/brand/status
- **Brand in dark**: `--blue-5` (light blue) 替代 `--blue-7` (Ant Blue) 提升对比度
- **System preference**: 优先 localStorage, fallback `prefers-color-scheme`
- **未删除 3 个老 `:root` 块**: Phase 2.A 迁移 TSX 消费者时统一清理

## 文件变更
- NEW: web/src/design/semantic.ts (SEMANTIC_ALIASES + DARK_OVERRIDES + CSS generators)
- NEW: web/src/design/semantic.css (light mode defaults)
- NEW: web/src/design/dark.css (dark mode overrides)
- NEW: web/src/hooks/useTheme.ts (state hook + side-effects)
- NEW: web/src/components/ThemeToggle.tsx (Sun/Moon button)
- MOD: web/src/main.tsx (call useTheme in Bootstrap, import semantic.css + dark.css)
- MOD: web/src/components/TopBar.tsx (mount ThemeToggle in actions slot)
- MOD: web/src/styles.css (add .oa-theme-toggle styles at end)

## 测试 (18 new tests)
- semantic.test.ts (6 tests: alias count, mapping format, brand/bg/success validation, kebab-case)
- darkMode.test.ts (3 tests: dark override values, selector wrap, status colors)
- useTheme.test.tsx (6 tests: default, system pref, setTheme, persistence, hydration, toggle)
- ThemeToggle.test.tsx (3 tests: render with aria-label, click handler, integration)

## 测试结果
- Frontend: 340 passed | 1 skipped (53 test files) — 18 新增, 零回归
- Server: 405 passed (33 test files)
- Build: 成功 (tsc -b + vite build, 无类型错误)
