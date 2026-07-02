# primitives-foundation — Phase 0.A

模型: claude-sonnet-4-6

## 决策
- **单一 brand**: `#1677ff` 作为 `--blue-7` (Ant Blue, 中段第 7 阶, 最常用)
- **Scale 体系**: Radix Colors 12 阶 (lightness 单调递减)
- **包含 scales**: slate / blue / purple / indigo / red / green / amber / cyan / magenta / orange (10 个)
- **Indigo 引入**: Linear/Vercel 风格的 select/active 强调色 (#4f46e5 = indigo-7)
- **Phase 0 范围**: 仅添加 primitives 层, 不动 styles.css 现有 3 个 :root 块 (避免破坏 ~25 TSX 文件)
- **Phase 1 范围**: 删除 3 个 :root 块, 合并为 semantic alias 层 (`--color-*` → `--{scale}-N`)

## 删除清单 (Phase 1 才执行)
- styles.css 第 1-27 行 (slate palette)
- styles.css 第 1670-1772 行 (v5 Ant palette)
- styles.css 第 2553-2595 行 (iFlytek palette)

## 文件变更
- NEW: web/src/design/primitives.ts (single source of truth)
- NEW: web/src/design/primitives.css (CSS var injection)
- NEW: web/src/design/primitives-loader.ts (observability helper)
- NEW: web/test/design/primitives.test.ts (5 tests, all green)
- NEW: web/test/design/noDeadTokens.test.ts (2 tests, all green)
- MOD: web/src/design/tokens.ts (re-export primitives at bottom)
- MOD: web/src/styles.css (@import primitives.css at top; Phase 0 marker comment at bottom)

## 测试
- 7 new tests added; all 262 frontend tests + 405 server tests still green
- Coverage: scale continuity, brand validation, kebab-case format, completeness
