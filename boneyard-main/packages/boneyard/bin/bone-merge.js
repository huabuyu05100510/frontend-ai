/**
 * Cross-run bone preservation.
 *
 * A capture pass only visits the routes reachable during that run. When a
 * user adds `auth.cookies` and re-runs, previously captured bones for
 * unauthenticated pages (e.g. /login) are no longer reachable, so those
 * skeletons never enter `collected`. Historically the registry was
 * regenerated from `collected` alone, silently dropping any skeleton whose
 * page wasn't visited this run (#81).
 *
 * This helper merges a run's freshly-captured bones with whatever was
 * already on disk: if a skeleton name only exists in the loaded set, keep
 * it. If it exists in both, the fresh data wins.
 *
 * Kept separate from the CLI so it can be unit-tested from `src/`.
 */

/**
 * Merge previously-captured bones into the current run's collected map.
 *
 * Mutates `collected` in place (matches how the CLI already uses a
 * long-lived `collected` object across breakpoints/routes) and also
 * returns it for convenience. Fresh captures always win over loaded data.
 *
 * @param {Record<string, any>} collected  - captured this run
 * @param {Record<string, any>} existing   - loaded from disk at startup
 * @returns {Record<string, any>} the merged `collected`
 */
export function mergePreservingExisting(collected, existing) {
  if (!collected || typeof collected !== 'object') return collected
  if (!existing || typeof existing !== 'object') return collected
  for (const [name, data] of Object.entries(existing)) {
    if (!(name in collected)) {
      collected[name] = data
    }
  }
  return collected
}
