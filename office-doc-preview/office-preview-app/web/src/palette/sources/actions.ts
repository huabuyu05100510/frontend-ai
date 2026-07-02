// 模型：claude-sonnet-4-6
// Actions source — palette items for global toggles (theme, motion)

import { useEffect } from 'react'
import { registerPaletteItems, paletteRegistry, type PaletteItem } from '../registry'
import { useTheme } from '../../hooks/useTheme'

const LS_KEY = 'motion'

/** Imperative registration — needs theme callbacks */
export function registerActionsItems(opts: {
  toggleTheme: () => void
  toggleMotion: () => void
}): PaletteItem[] {
  const items: PaletteItem[] = [
    {
      id: 'action-toggle-theme',
      title: '切换主题',
      subtitle: '深色 / 浅色',
      group: '操作',
      keywords: ['theme', 'dark', 'light', '主题', '深色', '浅色', 'toggle'],
      action: () => {
        opts.toggleTheme()
        const ts = new Date().toISOString()
        console.info(`[palette:actions ${ts}] toggle theme`)
      },
    },
    {
      id: 'action-toggle-motion',
      title: '切换动效',
      subtitle: '开启 / 关闭 Motion 动画',
      group: '操作',
      keywords: ['motion', 'animation', '动效', '动画', 'reduced', 'a11y'],
      action: () => {
        opts.toggleMotion()
        const ts = new Date().toISOString()
        console.info(`[palette:actions ${ts}] toggle motion`)
      },
    },
  ]
  registerPaletteItems(items)
  return items
}

/** Hook variant */
export function useRegisterActionsItems(): void {
  const { toggleTheme } = useTheme()
  useEffect(() => {
    const toggleMotion = () => {
      try {
        const cur = localStorage.getItem(LS_KEY)
        const next = cur === 'on' ? 'off' : 'on'
        localStorage.setItem(LS_KEY, next)
        // 触发 reload 以重新初始化 motion chunk（最简单可靠的方案）
        // 给个提示让用户知道要刷新
        window.dispatchEvent(new CustomEvent('palette:motion-toggled', { detail: { next } }))
      } catch {}
    }
    const items = registerActionsItems({ toggleTheme, toggleMotion })
    return () => {
      for (const item of items) paletteRegistry.unregister(item.id)
    }
  }, [toggleTheme])
}