// 模型：claude-sonnet-4-6
// Semantic alias layer — role-based token names referencing primitive scales
// Layer 2 of the design token system (primitive → semantic → component)

export type SemanticKey =
  // Brand
  | 'color-primary' | 'color-primary-hover' | 'color-primary-active' | 'color-primary-bg' | 'color-primary-bg-hover'
  // AI
  | 'color-ai' | 'color-ai-hover' | 'color-ai-bg'
  // Accent (Linear/Vercel)
  | 'color-accent' | 'color-accent-bg' | 'color-accent-border'
  // Text
  | 'color-text' | 'color-text-secondary' | 'color-text-tertiary' | 'color-text-placeholder' | 'color-text-inverse' | 'color-text-link'
  // Background
  | 'color-bg' | 'color-bg-canvas' | 'color-bg-subtle' | 'color-bg-hover' | 'color-bg-mask'
  // Border
  | 'color-border' | 'color-border-strong' | 'color-border-light'
  // Status
  | 'color-success' | 'color-success-bg' | 'color-warning' | 'color-warning-bg' | 'color-danger' | 'color-danger-bg' | 'color-info' | 'color-info-bg'
  // Diff
  | 'color-diff-delete' | 'color-diff-insert' | 'color-diff-active'
  // ============ Translation UX Overhaul (Phase A.1 Agent 1) ============
  | 'color-translate-stage-active' | 'color-translate-stage-done' | 'color-translate-stage-pending'
  | 'color-annotation-kind-align' | 'color-annotation-kind-seg' | 'color-annotation-kind-alt'
  | 'color-toast-success' | 'color-toast-error' | 'color-toast-info' | 'color-toast-warning'
  | 'color-toast-bg'

export const SEMANTIC_ALIASES: Record<SemanticKey, string> = {
  // Brand
  'color-primary':         'var(--blue-7)',
  'color-primary-hover':   'var(--blue-6)',
  'color-primary-active':  'var(--blue-8)',
  'color-primary-bg':      'var(--blue-2)',
  'color-primary-bg-hover':'var(--blue-3)',
  // AI
  'color-ai':              'var(--purple-7)',
  'color-ai-hover':        'var(--purple-5)',
  'color-ai-bg':           'var(--purple-3)',
  // Accent
  'color-accent':          'var(--indigo-7)',
  'color-accent-bg':       'var(--indigo-1)',
  'color-accent-border':   'var(--indigo-3)',
  // Text
  'color-text':            'var(--slate-12)',
  'color-text-secondary':  'var(--slate-11)',
  'color-text-tertiary':   'var(--slate-9)',
  'color-text-placeholder':'var(--slate-8)',
  'color-text-inverse':    '#ffffff',
  'color-text-link':       'var(--color-primary)',
  // Background
  'color-bg':              '#ffffff',
  'color-bg-canvas':       'var(--slate-3)',
  'color-bg-subtle':       'var(--slate-2)',
  'color-bg-hover':        'var(--slate-4)',
  'color-bg-mask':         'rgba(15, 23, 42, 0.55)',
  // Border
  'color-border':          'var(--slate-6)',
  'color-border-strong':   'var(--slate-7)',
  'color-border-light':    'var(--slate-4)',
  // Status
  'color-success':         'var(--green-6)',
  'color-success-bg':      'var(--green-2)',
  'color-warning':         'var(--amber-6)',
  'color-warning-bg':      'var(--amber-2)',
  'color-danger':          'var(--red-5)',
  'color-danger-bg':       'var(--red-1)',
  'color-info':            'var(--color-primary)',
  'color-info-bg':         'var(--color-primary-bg)',
  // Diff
  'color-diff-delete':     'var(--red-3)',
  'color-diff-insert':     'var(--blue-3)',
  'color-diff-active':     'var(--indigo-6)',
  // ============ Translation UX Overhaul (Phase A.1 Agent 1) ============
  // Stage indicator colors
  'color-translate-stage-active':  'var(--blue-7)',
  'color-translate-stage-done':    'var(--green-5)',
  'color-translate-stage-pending': 'var(--slate-3)',
  // Annotation kind colors (shared with Agent 3)
  'color-annotation-kind-align': 'var(--blue-6)',
  'color-annotation-kind-seg':   'var(--green-6)',
  'color-annotation-kind-alt':   'var(--purple-6)',
  // Toast semantic colors
  'color-toast-success': 'var(--green-6)',
  'color-toast-error':   'var(--red-6)',
  'color-toast-info':    'var(--blue-6)',
  'color-toast-warning': 'var(--amber-6)',
  'color-toast-bg':      'var(--color-bg)',
}

export const SEMANTIC_KEYS = Object.keys(SEMANTIC_ALIASES) as SemanticKey[]

export function semanticToCSSVars(): string {
  const lines: string[] = []
  for (const key of SEMANTIC_KEYS) {
    lines.push(`  --${key}: ${SEMANTIC_ALIASES[key]};`)
  }
  return lines.join('\n')
}

/** Dark mode overrides — semantic aliases that flip for dark theme */
export const DARK_OVERRIDES: Partial<Record<SemanticKey, string>> = {
  // Text — flips to light scale for dark backgrounds
  'color-text':            'var(--slate-1)',
  'color-text-secondary':  'var(--slate-9)',
  'color-text-tertiary':   'var(--slate-8)',
  'color-text-placeholder':'var(--slate-7)',
  // Background — dark surfaces
  'color-bg':              'var(--slate-12)',
  'color-bg-canvas':       'var(--slate-11)',
  'color-bg-subtle':       'var(--slate-10)',
  'color-bg-hover':        'var(--slate-9)',
  'color-bg-mask':         'rgba(0, 0, 0, 0.65)',
  // Border — lighter for visibility on dark
  'color-border':          'var(--slate-8)',
  'color-border-strong':   'var(--slate-7)',
  'color-border-light':    'var(--slate-9)',
  // Brand — shift one step lighter for contrast
  'color-primary':         'var(--blue-5)',
  'color-primary-hover':   'var(--blue-4)',
  'color-primary-active':  'var(--blue-7)',
  'color-primary-bg':      'rgba(64, 150, 255, 0.15)',
  // AI
  'color-ai':              'var(--purple-5)',
  'color-ai-bg':           'rgba(114, 46, 209, 0.18)',
  // Accent
  'color-accent':          'var(--indigo-5)',
  'color-accent-bg':       'rgba(79, 70, 229, 0.18)',
  // Status — lighter for contrast on dark
  'color-success':         'var(--green-5)',
  'color-warning':         'var(--amber-5)',
  'color-danger':          'var(--red-5)',
  'color-success-bg':      'rgba(82, 196, 26, 0.15)',
  'color-warning-bg':      'rgba(250, 173, 20, 0.15)',
  'color-danger-bg':       'rgba(255, 77, 79, 0.15)',
  'color-info-bg':         'var(--color-primary-bg)',
  // ============ Translation UX Overhaul (Phase A.1 Agent 1) ============
  // Toast: keep semantic bg as solid color-bg in dark mode (slate-12), success/error/info/warning lighter for contrast
  'color-toast-success': 'var(--green-5)',
  'color-toast-error':   'var(--red-5)',
  'color-toast-info':    'var(--blue-5)',
  'color-toast-warning': 'var(--amber-5)',
  // Stage indicator colors: shift one step lighter for dark contrast
  'color-translate-stage-active':  'var(--blue-5)',
  'color-translate-stage-done':    'var(--green-5)',
  'color-translate-stage-pending': 'var(--slate-8)',
  // Annotation kind colors: shift one step lighter
  'color-annotation-kind-align': 'var(--blue-5)',
  'color-annotation-kind-seg':   'var(--green-5)',
  'color-annotation-kind-alt':   'var(--purple-5)',
}

export function darkToCSSVars(): string {
  const lines: string[] = [':root[data-theme="dark"] {']
  for (const [key, value] of Object.entries(DARK_OVERRIDES)) {
    lines.push(`  --${key}: ${value};`)
  }
  lines.push('}')
  return lines.join('\n')
}
