// 模型：claude-sonnet-4-6
// Navigation source — palette items that navigate to pages

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { registerPaletteItems, paletteRegistry, type PaletteItem } from '../registry'
import { MENU_KEYS, menuKeyToRoute, type MenuKey } from '../../routes'

const LABELS: Record<MenuKey, string> = {
  files: '文档预览',
  translate: '智能翻译',
  qc: '智检校对',
  ocr: 'OCR 识别',
  convert: '格式转换',
  upload: '上传中心',
  voice: '语音中心',
  bookmarks: '收藏夹',
  samples: '示例库',
  gallery: '图片画廊',
}

const SHORTCUTS: Record<MenuKey, string> = {
  files: '⌘1',
  translate: '⌘2',
  qc: '⌘3',
  ocr: '⌘4',
  convert: '⌘5',
  upload: '⌘6',
  voice: '⌘7',
  bookmarks: '⌘B',
  samples: '⌘S',
  gallery: '⌘G',
}

/** Hook to be called inside a component (uses useNavigate) */
export function useRegisterNavigationItems(): void {
  const navigate = useNavigate()
  useEffect(() => {
    const items: PaletteItem[] = MENU_KEYS.map(key => ({
      id: `nav-${key}`,
      title: LABELS[key],
      subtitle: `跳转到 ${LABELS[key]}`,
      group: '导航',
      shortcut: SHORTCUTS[key],
      keywords: [key, 'navigate', 'page', '页面'],
      action: () => navigate(menuKeyToRoute(key)),
    }))
    registerPaletteItems(items)
    return () => {
      for (const item of items) paletteRegistry.unregister(item.id)
    }
  }, [navigate])
}

/** Imperative registration for tests/non-React contexts */
export function registerNavigationItems(navigate: (path: string) => void): void {
  const items: PaletteItem[] = MENU_KEYS.map(key => ({
    id: `nav-${key}`,
    title: LABELS[key],
    subtitle: `跳转到 ${LABELS[key]}`,
    group: '导航',
    shortcut: SHORTCUTS[key],
    keywords: [key, 'navigate', 'page', '页面'],
    action: () => navigate(menuKeyToRoute(key)),
  }))
  registerPaletteItems(items)
}