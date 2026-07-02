// 模型：claude-sonnet-4-6
// Visual regression test helpers — viewport/theme/page route matrices
// Exported as pure constants + utilities for use across multiple specs.

export type Theme = 'light' | 'dark'

export interface ViewportPreset {
  name: string
  width: number
  height: number
  /** Device pixel ratio for hi-DPI screenshots (defaults to 1) */
  deviceScaleFactor?: number
  /** Mark as mobile to apply device-specific CSS hooks (touch, scrollbar) */
  isMobile?: boolean
  /** Has touch capability */
  hasTouch?: boolean
}

/**
 * 9 viewport presets — chosen to cover the most common device classes:
 *  - 3 mobile (iPhone SE 375 / iPhone 14 390 / Pixel 7 412)
 *  - 2 tablet (iPad Mini 768 / iPad Air 820)
 *  - 4 desktop (HD 1366 / FHD 1920 / 2K 2560 / ultrawide 3440)
 *
 * Mobile + tablet mark isMobile=true so Playwright emulates touch + viewport meta.
 */
export const VIEWPORTS: readonly ViewportPreset[] = [
  // Mobile
  { name: 'iphone-se',   width: 375,  height: 667,  isMobile: true,  hasTouch: true,  deviceScaleFactor: 2 },
  { name: 'iphone-14',   width: 390,  height: 844,  isMobile: true,  hasTouch: true,  deviceScaleFactor: 3 },
  { name: 'pixel-7',     width: 412,  height: 915,  isMobile: true,  hasTouch: true,  deviceScaleFactor: 2.625 },
  // Tablet
  { name: 'ipad-mini',   width: 768,  height: 1024, isMobile: true,  hasTouch: true,  deviceScaleFactor: 2 },
  { name: 'ipad-air',    width: 820,  height: 1180, isMobile: true,  hasTouch: true,  deviceScaleFactor: 2 },
  // Desktop
  { name: 'hd-1366',     width: 1366, height: 768,  deviceScaleFactor: 1 },
  { name: 'fhd-1920',    width: 1920, height: 1080, deviceScaleFactor: 1 },
  { name: 'qhd-2560',    width: 2560, height: 1440, deviceScaleFactor: 1 },
  { name: 'ultrawide',   width: 3440, height: 1440, deviceScaleFactor: 1 },
] as const

export const THEMES: readonly Theme[] = ['light', 'dark'] as const

export interface PageRoute {
  /** Route key — used in snapshot filename */
  key: string
  /** URL path the test will navigate to */
  route: string
  /** Human-readable Chinese name (informational only) */
  label: string
}

/**
 * 7 production pages (excludes bookmarks/samples/gallery placeholders per
 * CLAUDE.md: only ship snapshots for routes backed by real features).
 */
export const PAGES_ROUTES: readonly PageRoute[] = [
  { key: 'files',    route: '/files',    label: '文档预览' },
  { key: 'translate', route: '/translate', label: '智能翻译' },
  { key: 'qc',       route: '/qc',       label: '智检校对' },
  { key: 'ocr',      route: '/ocr',      label: 'OCR 识别' },
  { key: 'convert',  route: '/convert',  label: '格式转换' },
  { key: 'upload',   route: '/upload',   label: '上传中心' },
  { key: 'voice',    route: '/voice',    label: '语音中心' },
] as const

/** Total snapshot matrix: 9 viewports × 2 themes × 7 pages = 126 */
export const TOTAL_SNAPSHOTS = VIEWPORTS.length * THEMES.length * PAGES_ROUTES.length

/**
 * Compose the snapshot filename so the matrix is readable in PR diffs.
 * Example: files-iphone-14-dark.png
 */
export function snapshotName(pageKey: string, viewportName: string, theme: Theme): string {
  return `${pageKey}-${viewportName}-${theme}.png`
}

/**
 * Inject test fixtures into the browser context before page load.
 * - seeds localStorage so the app boots into a deterministic state
 * - sets initial theme (so first paint matches the test theme)
 *
 * Caller must pass `theme` to make the test explicit.
 *
 * Implementation note: addInitScript runs before document is parsed, so we
 * must guard `document.documentElement` — it may be null until <html> exists.
 */
export async function seedAppState(
  page: import('@playwright/test').Page,
  theme: Theme,
): Promise<void> {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('theme', t)
    } catch {
      // localStorage may throw in private mode; non-fatal for visual test
    }
    // Use a tiny observer so we set data-theme as soon as <html> is parsed.
    // (Calling setAttribute on null would throw before DOMContentLoaded.)
    const apply = () => {
      const el = document.documentElement
      if (el) el.setAttribute('data-theme', t)
    }
    apply()
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', apply, { once: true })
    }
  }, theme)
}