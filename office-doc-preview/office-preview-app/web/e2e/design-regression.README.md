# Visual Regression Suite — Design Overhaul Phase 0

模型：claude-sonnet-4-6

## What this is

A Playwright-driven visual regression suite covering **9 viewports × 2 themes × 7 pages = 126 snapshots**.
Every test produces one baseline PNG; subsequent runs diff against it.

- Spec file: `e2e/design-regression.spec.ts`
- Helpers: `e2e/helpers.ts` (VIEWPORTS, THEMES, PAGES_ROUTES, seedAppState)
- Baselines dir: `e2e/design-regression.spec.ts-snapshots/`
- Project name in `playwright.config.ts`: `design-regression`

## Threshold

`maxDiffPixelRatio: 0.005` (0.5%). Aligns with CLAUDE.md "极致体验" bar — strict enough to catch layout drift, lenient enough to absorb anti-aliasing variance and font subpixel shifts.

## How to run

### Generate baselines (one-time)
```bash
cd office-preview-app/web
npx playwright test --project=design-regression --update-snapshots
```
This creates `e2e/design-regression.spec.ts-snapshots/<page>-<viewport>-<theme>.png` for every (page, viewport, theme) tuple.

### Verify baselines (every PR)
```bash
cd office-preview-app/web
npx playwright test --project=design-regression
```
If a snapshot deviates > 0.5%, the test fails and a diff PNG is written under `test-results/`.

### Run a single test
```bash
npx playwright test --project=design-regression \
  -g "files @ fhd-1920 light"
```

### Just the smoke checks (fast feedback)
```bash
npx playwright test --project=design-regression -g "smoke"
```

## Viewport matrix (9)

| Class | Name | Size | DPR | Touch |
|---|---|---|---|---|
| Mobile | iphone-se | 375×667 | 2 | yes |
| Mobile | iphone-14 | 390×844 | 3 | yes |
| Mobile | pixel-7 | 412×915 | 2.625 | yes |
| Tablet | ipad-mini | 768×1024 | 2 | yes |
| Tablet | ipad-air | 820×1180 | 2 | yes |
| Desktop | hd-1366 | 1366×768 | 1 | no |
| Desktop | fhd-1920 | 1920×1080 | 1 | no |
| Desktop | qhd-2560 | 2560×1440 | 1 | no |
| Desktop | ultrawide | 3440×1440 | 1 | no |

## Theme matrix (2)

- `light` — `<html data-theme="light">`
- `dark` — `<html data-theme="dark">`

Theme is seeded via `localStorage.setItem('theme', ...)` in `addInitScript` so it survives the first paint.

## Pages (7)

`/files`, `/translate`, `/qc`, `/ocr`, `/convert`, `/upload`, `/voice`. These correspond to the 7 production menu items in `web/src/routes.ts`. Placeholder routes (`/bookmarks`, `/samples`, `/gallery`) are intentionally excluded — visual coverage belongs to features that exist.

## Disk usage

- ~80 KB avg per PNG (mostly large viewports at 2560×1440 = 14.75 MB raw → ~80 KB compressed)
- Total expected: **~10 MB**
- Git LFS recommended if the repo enforces large-file rules; otherwise commit directly.

## Adding new snapshots

1. Append the new viewport to `VIEWPORTS` in `helpers.ts`, OR
2. Append the new page to `PAGES_ROUTES` in `helpers.ts`, OR
3. Append the new theme to `THEMES` in `helpers.ts`.
4. Re-run `npx playwright test --project=design-regression --update-snapshots`.
5. Commit the new baselines.

The matrix-size test inside the spec will tell you when the count changes — update its expectations accordingly.

## Anti-flake measures

- `serial` mode (deterministic localStorage order)
- Per-test `browser.newContext()` (fresh viewport + theme)
- `reducedMotion: 'reduce'` in context options
- Wait for `.oa-shell` → `.oa-main` → page-specific selector → networkidle
- Re-assert `data-theme` after mount in case Bootstrap flipped it
- 300 ms post-networkidle settle for font + paint completion
- `animations: 'disabled'`, `caret: 'hide'`, `scale: 'css'` in toHaveScreenshot