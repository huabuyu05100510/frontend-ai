/**
 * URL classification helpers for the CLI.
 *
 * Kept in its own module (rather than inline in cli.js) so the logic can be
 * unit-tested from `src/` without spawning a real CLI subprocess. Imported by
 * `bin/cli.js` and `src/cli-url.test.ts`.
 */

/**
 * Returns true when the URL has a non-root path — anything after the origin
 * other than `/` or empty. Examples:
 *
 *   http://localhost:3000              → false  (bare origin)
 *   http://localhost:3000/             → false  (root path)
 *   http://localhost:3000/dashboard    → true
 *   http://localhost:3000/a/b?x=1#y    → true
 *
 * Returns false on parse errors so a malformed URL never silently activates
 * single-page mode.
 *
 * @param {string} u
 * @returns {boolean}
 */
export function hasNonRootPath(u) {
  try {
    const parsed = new URL(u)
    const p = parsed.pathname
    return p !== '' && p !== '/'
  } catch {
    return false
  }
}

/**
 * Single-page mode is active when the user explicitly passed at least one URL
 * with a non-root path. The CLI documents this as "Specific page" capture
 * (see apps/docs/src/app/cli/page.tsx) and the implementation must match —
 * skip link-following from the page, skip filesystem route discovery, skip
 * config.routes/skeletons augmentation. The given URLs ARE the queue.
 *
 * Bare origins (`http://localhost:3000`) and the empty list (auto-detect)
 * keep the legacy crawl-everything behaviour.
 *
 * @param {string[]} urls
 * @returns {boolean}
 */
export function isSinglePageMode(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return false
  return urls.some(hasNonRootPath)
}
