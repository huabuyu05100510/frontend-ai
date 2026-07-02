// 模型：claude-sonnet-4-6
// Route table — single source of truth for menu key <-> URL mapping

export type MenuKey =
  | 'files'
  | 'translate'
  | 'qc'
  | 'ocr'
  | 'convert'
  | 'upload'
  | 'voice'
  | 'bookmarks'
  | 'samples'
  | 'gallery'

export const ROUTES: Record<MenuKey, string> = {
  files: '/files',
  translate: '/translate',
  qc: '/qc',
  ocr: '/ocr',
  convert: '/convert',
  upload: '/upload',
  voice: '/voice',
  bookmarks: '/bookmarks',
  samples: '/samples',
  gallery: '/gallery',
}

export const MENU_KEYS: readonly MenuKey[] = [
  'files', 'translate', 'qc', 'ocr', 'convert', 'upload', 'voice',
  'bookmarks', 'samples', 'gallery',
] as const

export function menuKeyToRoute(key: MenuKey): string {
  return ROUTES[key]
}

export function routeToMenuKey(pathname: string): MenuKey {
  // strip query string and hash so '/translate?q=foo' is treated as '/translate'
  const cleanPath = pathname.split(/[?#]/)[0]
  const segment = cleanPath.split('/').filter(Boolean)[0] ?? ''
  const found = MENU_KEYS.find(k => ROUTES[k] === `/${segment}`)
  return found ?? 'files'  // default fallback
}