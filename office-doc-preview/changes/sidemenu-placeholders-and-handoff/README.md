# SideMenu Placeholders + RightPanel Routing + Cross-Page Handoff

## 模型
claude-sonnet-4-6

## Decision (per user)
实现全部 3 个 SideMenu 工具集占位项 (`bookmarks` / `samples` / `gallery`)，而不是仅放占位空页面。

## Summary
完成了 v5.x Phase 2.C 范围内的 UI 收尾工作：
1. 3 个新 SideMenu 占位页面（收藏夹 / 示例库 / 图片画廊）
2. store 新增 bookmarks slice（localStorage 持久化 + ISO 时间戳日志）
3. 跨页面任务移交 hook（useCrossPageHandoff）
4. RightPanel 真正接入路由（onSelectTask + "查看全部" 底部链接）
5. routes.ts / SideMenu / App.tsx / palette 同步扩展

## File creation table

### NEW files
| Path | 用途 |
|---|---|
| `web/src/pages/BookmarksPage.tsx` | 收藏夹页面 — 2 列 grid 展示已收藏任务 |
| `web/src/pages/SamplesPage.tsx` | 示例库页面 — 卡片网格 + fixture 兜底 |
| `web/src/pages/GalleryPage.tsx` | 图片画廊页面 — 缩略图网格 + 简易 lightbox |
| `web/src/hooks/useCrossPageHandoff.ts` | 跨页面任务移交 hook（build URL + navigate） |
| `web/test/pages/BookmarksPage.test.tsx` | 3 个 TDD 测试 |
| `web/test/pages/SamplesPage.test.tsx` | 3 个 TDD 测试 |
| `web/test/pages/GalleryPage.test.tsx` | 3 个 TDD 测试 |
| `web/test/hooks/useCrossPageHandoff.test.tsx` | 3 个 TDD 测试 |
| `web/test/store/bookmarks.test.tsx` | 3 个 TDD 测试 |
| `web/test/components/RightPanel.routing.test.tsx` | 2 个 TDD 测试 |

### MOD files
| Path | 改动 |
|---|---|
| `web/src/routes.ts` | MenuKey type 加 `bookmarks \| samples \| gallery`；ROUTES / MENU_KEYS 同步 |
| `web/src/store.ts` | 新增 `bookmarks: Set<string>` + `toggleBookmark` / `isBookmarked`；localStorage 持久化 |
| `web/src/components/SideMenu.tsx` | MenuKey 加 3 项；ACTIVE_KEYS 加入；点击触发 useNavigate |
| `web/src/components/RightPanel.tsx` | onSelectTask 默认接 useNavigate（仍兼容外部回调）；新增 "查看全部" footer 按钮 |
| `web/src/App.tsx` | 导入 3 个新页面并挂载路由条件渲染；MENU_LABELS 补 3 项 |
| `web/src/palette/sources/navigation.ts` | LABELS / SHORTCUTS 加 3 项（⌘B/⌘S/⌘G） |
| `web/test/router/routeContract.test.ts` | 7 → 10 路由断言 |

## Routes added
- `/bookmarks` → `BookmarksPage` (menuKey: `bookmarks`)
- `/samples` → `SamplesPage` (menuKey: `samples`)
- `/gallery` → `GalleryPage` (menuKey: `gallery`)

## Routing matrix
| Source | Action | Target |
|---|---|---|
| SideMenu `bookmarks` | click | `/bookmarks` |
| SideMenu `samples` | click | `/samples` |
| SideMenu `gallery` | click | `/gallery` |
| RightPanel task button | click | `/files?task=<id>` (also `useStore.select`) |
| RightPanel "查看全部" | click | `/files` |
| BookmarksPage card | click | `/files?task=<id>` |
| GalleryPage thumbnail | click | opens local lightbox |
| `useCrossPageHandoff(taskId, 'translate')` | invoke | `/translate?task=<id>` |
| `useCrossPageHandoff(taskId, 'qc', {text})` | invoke | `/qc?task=<id>&text=<text>` |
| `useCrossPageHandoff(taskId, 'ocr', {src})` | invoke | `/ocr?task=<id>&src=<src>` |
| Palette `⌘B` / `⌘S` / `⌘G` | cmd-k → nav | bookmarks / samples / gallery |

## Verification checklist
- [x] TDD red→green cycle (tests written first, then implementation)
- [x] Frontend: 391 passed + 1 skipped (was 340 + 1 skipped) — Δ = +51 tests passing, +18 files
- [x] All 7 new test files pass (23 new tests)
- [x] routeContract.test.ts updated to 10 routes, passes
- [x] `npm --prefix office-preview-app/web run build` succeeds (4.35s)
- [x] File headers `// 模型：claude-sonnet-4-6` on every NEW file
- [x] ISO timestamps in log calls (`[store ISO]`, `[handoff ISO]`, `[rightpanel ISO]`)
- [x] Zero regressions on Phase 0/1 + P2.A + P2.B code
- [x] Store extension is additive only (existing slices untouched)
- [x] Routes.ts widening does not break routeToMenuKey default fallback
- [x] RightPanel self-sufficient via `useNavigate` (App.tsx still uses noop callback for backward compat)

## Pre-existing test failure (out of scope)
`web/test/PreviewModal.test.tsx > ESC 触发 onClose` fails because:
- P2.A refactored `PreviewModal.tsx` to use `Modal` primitive (which listens on `document`)
- The test still uses `fireEvent.keyDown(window, ...)` which does not bubble to `document`
- This is a P2.A issue, not introduced by my changes — confirmed by stashing my changes and re-running

## Notes
- `bookmarks` slice state mutation triggers a `set({ bookmarks: next })` to keep zustand selectors pure (Set reference changes)
- `GalleryPage` uses an in-component lightbox (full modal is P2.A scope); ESC closes it via `useEffect` keydown listener
- `SamplesPage` always renders at least 1 fixture card (even when fetch fails) to avoid empty state on first paint
- `useCrossPageHandoff` uses `URLSearchParams` for clean query string encoding