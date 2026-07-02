# Design Overhaul — INDEX

**模型：claude-sonnet-4-6**
**总览文档**：[README.md](./README.md) (3 大支柱 · 12 节)

## Phase 0 — Foundations

| Pillar | Doc | Summary |
|---|---|---|
| Primitives | [primitives-foundation](../primitives-foundation/README.md) | 10 scales × 12 steps, single brand `#1677ff` |
| Motion | [motion-foundation](../motion-foundation/README.md) | `motion@12.42.2`, lazy chunk, opt-in via `?motion=on` |
| Router | [router-foundation](../router-foundation/README.md) | react-router v7, 7 flat routes, browser back/forward |
| A11y | [a11y-reduced-motion](../a11y-reduced-motion/README.md) | `prefers-reduced-motion` + `<html data-motion>` bridge |

## Phase 1 — Pillars

| Pillar | Doc | Summary |
|---|---|---|
| Semantic Tokens | [semantic-tokens](../semantic-tokens/README.md) | 36 aliases, dark mode, system preference |
| Motion Primitives | [motion-primitives](../motion-primitives/README.md) | `<Hover>` / `<Press>` / `<PageTransition>`, data-motion aware |
| ⌘K Palette | [cmd-palette-skeleton](../cmd-palette-skeleton/README.md) | ⌘K modal, 7 nav items, ESC close |

## Phase 2 — Surface

| Phase | Doc | Summary |
|---|---|---|
| 2.A | [inline-hex-and-modal](../inline-hex-and-modal/README.md) | 352 hex → `var(--color-*)`, 2 modals migrated |
| 2.B | [workspace-timeline-and-palette-content](../workspace-timeline-and-palette-content/README.md) | `/api/workspace/timeline` + palette 4 sources (files/templates/voices/actions) |
| 2.C | [sidemenu-placeholders-and-handoff](../sidemenu-placeholders-and-handoff/README.md) | 3 new pages (bookmarks/samples/gallery), cross-page handoff hook |

## Phase 3 — Polish

| Phase | Doc | Summary |
|---|---|---|
| 3.B | [reduced-motion-audit](../reduced-motion-audit/README.md) | WCAG 2.3.3 PASS, 18 audit tests + 4 e2e tests |

Phase 3.A (visual regression baselines) — in flight, see [umbrella doc](./README.md#6-phase-3--polish-a11y--视觉回归).

## Quick stats

- **Tests**: 394 passed + 1 skipped (web) | 419 passed (server)
- **Initial JS**: 470 KB / 140 KB gz
- **Motion chunk** (opt-in): 135 KB / 45 KB gz
- **PDFium WASM**: 333 KB / 98 KB gz
- **Routes**: 10 (7 main + 3 placeholders)
- **Semantic tokens**: 36 + 36 dark overrides
- **Motion primitives**: 3 (Hover/Press/PageTransition)
- **Palette sources**: 5 (nav + files + templates + voices + actions)
- **Modals**: 1 primitive + 2 migrated
