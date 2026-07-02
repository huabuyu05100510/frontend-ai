// 模型：claude-sonnet-4-6
// Motion lib lazy loader — keeps initial bundle clean (motion is ~40 KB gz)
// Activation: URL query (?motion=on|off) takes precedence over localStorage

const URL_PARAM = 'motion'
const LS_KEY = 'motion'

export function shouldLoadMotion(): boolean {
  // URL param has highest precedence
  const params = new URLSearchParams(window.location.search)
  const urlVal = params.get(URL_PARAM)
  if (urlVal === 'on') return true
  if (urlVal === 'off') return false

  // Fall back to localStorage
  try {
    return localStorage.getItem(LS_KEY) === 'on'
  } catch {
    return false
  }
}

export async function loadMotion(): Promise<typeof import('./index') | null> {
  if (!shouldLoadMotion()) {
    const ts = new Date().toISOString()
    console.info(`[motion ${ts}] skipped: ?motion=on required to activate`)
    return null
  }

  const t0 = performance.now()
  const mod = await import('./index')
  const elapsed = Math.round(performance.now() - t0)
  const ts = new Date().toISOString()
  console.info(`[motion ${ts}] chunk loaded in ${elapsed}ms`)
  return mod
}
