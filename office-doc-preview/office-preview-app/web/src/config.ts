/**
 * 特征开关 / 全局配置
 * -------------------
 * 控制 MPA→SPA 架构升级中每一项新能力的启用/禁用。
 *
 * - 开发/生产默认全部启用
 * - 出问题时单开关即可回退到旧行为
 * - 支持通过 URL query (?features=xxx) 覆盖 (仅 dev)
 */

const DEFAULTS = {
  USE_ROUTER: true,
  USE_TANSTACK_QUERY: true,
  SSR_ENABLED: false,           // Phase 4 启用
  SW_ENABLED: false,            // Phase 5 启用
  VIEW_TRANSITIONS: false,      // Phase 5 启用
  SPECULATION_RULES: false,     // Phase 5 启用
  RUM_ENABLED: false,           // Phase 6 启用
  GRAYSCALE_ENABLED: false,     // Phase 7 启用
  PREFETCH_LINKS: false,        // Phase 5 启用
}

type Features = typeof DEFAULTS

function loadFeatures(): Features {
  const result = { ...DEFAULTS }

  // 允许 localStorage 覆盖 (持久开关)
  try {
    const stored = localStorage.getItem('mpa-spa-features')
    if (stored) {
      const parsed = JSON.parse(stored)
      Object.assign(result, parsed)
    }
  } catch { /* ignore */ }

  // 允许 URL query 覆盖 (仅 dev，临时调试)
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search)
    const feat = params.get('features')
    if (feat) {
      for (const f of feat.split(',')) {
        const negate = f.startsWith('!')
        const key = (negate ? f.slice(1) : f).toUpperCase()
        if (key in DEFAULTS) {
          (result as Record<string, boolean>)[key] = !negate
        }
      }
    }
  }

  return result
}

export const FEATURES = loadFeatures()

/** 运行时切换特征开关，持久化到 localStorage */
export function setFeature(key: keyof Features, value: boolean) {
  try {
    const stored = JSON.parse(localStorage.getItem('mpa-spa-features') || '{}')
    stored[key] = value
    localStorage.setItem('mpa-spa-features', JSON.stringify(stored))
    // 需要刷新页面生效 (重新加载 config)
  } catch { /* ignore */ }
}

// 模型：claude-sonnet-4-6
// Motion feature flag — opt-in via URL or localStorage
// Phase 0: defaults to false (production-safe)
// Phase 1+: flip default to true after primitives are stable
export const MOTION_DEFAULT = false

export const MOTION_CHUNK_BUDGET_KB = 60  // gzipped; build will warn if exceeded